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
    
    // Use AI proxy domain if configured, otherwise use OpenAI directly
    const { AI_PROXY_DOMAIN, OPENAI_REVERSE_PROXY } = process.env;
    const baseUrl = AI_PROXY_DOMAIN || OPENAI_REVERSE_PROXY || 'https://api.openai.com';
    const apiUrl = baseUrl.replace(/\/v1\/?$/, '') + '/v1/realtime/sessions';
    
    console.log('Requesting realtime session from:', apiUrl);
    
    // For Shopify proxy, we might need a different format
    // Try with just the model parameter first
    const requestBody = {
      model: 'gpt-4o-realtime-preview-2024-12-17',
      voice: req.body.session?.audio?.output?.voice || 'alloy',
      instructions: req.body.session?.instructions || 'You are a helpful assistant'
    };
    
    console.log('Realtime API request to:', apiUrl);
    console.log('Request body:', JSON.stringify(requestBody, null, 2));
    
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
    
    // Log conversation start for tracking
    if (conversationId) {
      console.log(`Voice conversation started for conversation: ${conversationId}`);
    }
    
    // Return the client secret with proxy URL if configured
    const { AI_PROXY_DOMAIN: proxyDomain } = process.env;
    res.json({
      value: data.client_secret?.value || data.value,
      expires_at: data.expires_at,
      session_id: data.id || data.session_id,
      proxy_url: proxyDomain || null
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