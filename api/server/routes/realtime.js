const express = require('express');
const router = express.Router();
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { getUserKeyValues } = require('~/server/services/UserService');
const { isUserProvided } = require('@librechat/api');
const { EModelEndpoint } = require('librechat-data-provider');
const fetch = require('node-fetch');

/**
 * Generate client secret for OpenAI Realtime API
 * @route POST /api/realtime/client-secret
 * @param {Object} req.body.session - Session configuration
 * @param {string} req.body.conversationId - Optional conversation ID
 * @returns {Object} Client secret response
 */
router.post('/client-secret', requireJwtAuth, async (req, res) => {
  try {
    const { session, conversationId } = req.body;
    const userId = req.user.id;
    
    // Log tools count if present
    if (session?.tools?.length > 0) {
      console.log(`[Realtime API] Received request with ${session.tools.length} tools`);
    }
    
    // Get OpenAI API key
    const { OPENAI_API_KEY } = process.env;
    const userProvidesKey = isUserProvided(OPENAI_API_KEY);
    
    let openaiKey = OPENAI_API_KEY;
    if (userProvidesKey) {
      const userValues = await getUserKeyValues({ userId, name: EModelEndpoint.openAI });
      openaiKey = userValues?.apiKey;
    }
    
    if (!openaiKey) {
      return res.status(400).json({ error: 'OpenAI API key not configured' });
    }
    
    // Use specific realtime proxy if configured, otherwise fall back to regular proxies or OpenAI directly
    const { OPENAI_REALTIME_REVERSE_PROXY, AI_PROXY_DOMAIN, OPENAI_REVERSE_PROXY } = process.env;
    const baseUrl = OPENAI_REALTIME_REVERSE_PROXY || AI_PROXY_DOMAIN || OPENAI_REVERSE_PROXY || 'https://api.openai.com';
    const apiUrl = baseUrl.replace(/\/v1\/?$/, '') + '/v1/realtime/sessions';
    
    console.log('Requesting realtime session from:', apiUrl);
    
    // Build the request body for OpenAI Realtime API
    // Try matching the exact format that OpenAI expects
    const requestBody = {
      model: session?.model || 'gpt-4o-realtime-preview-2024-12-17',
      instructions: session?.instructions || 'You are a helpful assistant',
      voice: session?.audio?.output?.voice || 'alloy',
      input_audio_transcription: {
        model: 'whisper-1'
      },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 200
      }
    };
    
    // Add tools if provided - tools must be in the correct OpenAI format
    if (session?.tools && session.tools.length > 0) {
      requestBody.tools = session.tools;
      console.log(`[Realtime API] Adding ${session.tools.length} tools to OpenAI request`);
      // Log first tool to verify format
      if (session.tools[0]) {
        console.log('[Realtime API] First tool format:', JSON.stringify(session.tools[0], null, 2));
      }
    }
    
    console.log('[Realtime API] Full request body:', JSON.stringify(requestBody, null, 2));
    
    // Request to OpenAI Realtime API
    
    // Request a client secret from OpenAI's Realtime API
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI Realtime API error:', error);
      return res.status(response.status).json({ 
        error: 'Failed to get ephemeral token', 
        details: error 
      });
    }
    
    const data = await response.json();
    // Response received from OpenAI
    
    // Log the session response to check if tools are included
    console.log('[Realtime API] Session response received from proxy');
    console.log('[Realtime API] Response data:', JSON.stringify(data, null, 2));
    
    // Note: The ephemeral token response doesn't include session details
    // The session details come from the WebRTC connection later
    if (data.client_secret || data.value) {
      console.log('[Realtime API] ✅ Ephemeral token received');
    }
    
    // Log conversation start for tracking
    if (conversationId) {
      console.log(`Voice conversation started for conversation: ${conversationId}`);
    }
    
    // Return the client secret with proxy URL if configured
    // Use the realtime proxy if available, otherwise fall back to AI_PROXY_DOMAIN
    const proxyUrl = process.env.OPENAI_REALTIME_REVERSE_PROXY || process.env.AI_PROXY_DOMAIN || null;
    res.json({
      value: data.client_secret?.value || data.value,
      expires_at: data.expires_at,
      session_id: data.id || data.session_id,
      proxy_url: proxyUrl,
      // Include tools count for debugging
      tools_count: data.tools?.length || 0
    });
    
  } catch (error) {
    console.error('Error generating client secret:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Save voice conversation transcript
 * @route POST /api/realtime/transcript
 * @param {string} req.body.conversationId - Conversation ID
 * @param {Array} req.body.messages - Transcript messages
 */
router.post('/transcript', requireJwtAuth, async (req, res) => {
  try {
    const { conversationId, messages } = req.body;
    const userId = req.user.id;
    
    // TODO: Save transcript to database
    // This would integrate with the existing message storage system
    
    console.log(`Saving transcript for conversation ${conversationId}:`, messages.length, 'messages');
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving transcript:', error);
    res.status(500).json({ error: 'Failed to save transcript' });
  }
});

module.exports = router;