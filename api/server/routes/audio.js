const express = require('express');
const router = express.Router();
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { getUserKeyValues } = require('~/server/services/UserService');
const { isUserProvided } = require('@librechat/api');
const { EModelEndpoint } = require('librechat-data-provider');
const FormData = require('form-data');
const fetch = require('node-fetch');

/**
 * Transcribe audio using OpenAI's Whisper API
 * @route POST /api/audio/transcribe
 * @param {string} req.body.audio - Base64 encoded audio data
 * @param {string} req.body.conversationId - Optional conversation ID
 * @returns {Object} Transcription response with text
 */
router.post('/transcribe', requireJwtAuth, async (req, res) => {
  try {
    const { audio, conversationId } = req.body;
    const userId = req.user.id;
    
    if (!audio) {
      return res.status(400).json({ error: 'No audio data provided' });
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
    
    // Convert base64 to buffer
    const base64Data = audio.split(',')[1] || audio;
    const audioBuffer = Buffer.from(base64Data, 'base64');
    
    // Create form data for Whisper API
    const formData = new FormData();
    formData.append('file', audioBuffer, {
      filename: 'audio.webm',
      contentType: 'audio/webm'
    });
    formData.append('model', 'whisper-1');
    
    // Call OpenAI Whisper API
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        ...formData.getHeaders()
      },
      body: formData
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI Whisper API error:', error);
      return res.status(response.status).json({ 
        error: 'Failed to transcribe audio', 
        details: error 
      });
    }
    
    const data = await response.json();
    
    // Log transcription for tracking
    if (conversationId) {
      console.log(`Audio transcribed for conversation: ${conversationId}, text: "${data.text}"`);
    }
    
    // Return the transcribed text
    res.json({
      text: data.text,
      conversationId
    });
    
  } catch (error) {
    console.error('Error transcribing audio:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;