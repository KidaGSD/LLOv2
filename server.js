/**
 * Stable Audio API Proxy Server
 * 
 * This server proxies requests to the Stability AI API to generate audio from text prompts.
 * It avoids exposing your API key in client-side code and handles the proper authentication.
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');
const app = express();
const port = process.env.PORT || 3000;

const STABILITY_API_KEY = ""; 

// Enable CORS for all routes
app.use(cors());

// Parse JSON request bodies
app.use(express.json());

// Serve static files from the current directory
app.use(express.static('.'));

// Proxy endpoint for Stable Audio API
app.post('/api/generate-audio', async (req, res) => {
  try {
    const { text_prompt, bpm, duration_seconds } = req.body;
    const duration = duration_seconds || 12; // Default to 12 seconds if not specified

    console.log(`Generating audio for prompt: "${text_prompt}", BPM: ${bpm}, Duration: ${duration}s`);

    // Create form data for the Stability AI API
    const formData = new FormData();
    formData.append('prompt', text_prompt);
    formData.append('output_format', 'mp3');
    formData.append('duration', duration);
    formData.append('steps', 50); // Default steps (increase for better quality)
    formData.append('cfg_scale', 7); // Default adherence to prompt

    // Call the Stability AI API
    const response = await axios({
      method: 'post',
      url: 'https://api.stability.ai/v2beta/audio/stable-audio-2/text-to-audio',
      headers: {
        'Authorization': `Bearer ${STABILITY_API_KEY}`,
        'Accept': 'audio/*',
        ...formData.getHeaders()
      },
      data: formData,
      responseType: 'arraybuffer' // Get binary audio data
    });

    // Set appropriate headers for the audio response
    res.set('Content-Type', 'audio/mp3');
    res.set('X-Audio-BPM', bpm || 120);
    res.set('X-Audio-Key', 'Unknown'); // We don't get key info from the API
    res.set('X-Audio-Duration', duration);
    
    // Send the audio data back to the client
    res.send(response.data);

  } catch (error) {
    console.error('Error calling Stability AI API:', error.message);
    
    // Extract error message from Stability AI if available
    let errorMessage = 'Failed to generate audio';
    let errorDetails = error.message;
    let statusCode = 500;
    
    if (error.response) {
      // Check for payment required error (402)
      if (error.response.status === 402) {
        statusCode = 402;
        errorMessage = 'Stability AI API requires payment';
        errorDetails = 'Please add credits to your Stability AI account. Refer to the Stability AI dashboard.';
        console.error('Payment required error:', errorDetails);
      } else {
        statusCode = error.response.status;
        
        try {
          // If error response is JSON
          if (error.response.data && typeof error.response.data === 'object') {
            errorMessage = error.response.data.message || errorMessage;
            // Extract deeper error message if available
            if (error.response.data.error) {
              errorDetails = 
                typeof error.response.data.error === 'string' 
                ? error.response.data.error 
                : JSON.stringify(error.response.data.error);
            }
          } 
          // If error response is a string/buffer
          else if (error.response.data) {
            const dataStr = error.response.data.toString();
            errorMessage = `API Error (${statusCode}): ${dataStr.substring(0, 100)}...`;
          }
        } catch (e) {
          console.error('Error parsing error response:', e);
        }
      }
    }
    
    res.status(statusCode).json({ 
      error: errorMessage,
      details: errorDetails
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Stable Audio proxy server running at http://localhost:${port}`);
  console.log(`To test the API, visit http://localhost:${port} in your browser`);
});

// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log('Server shutting down...');
  process.exit(0);
});
