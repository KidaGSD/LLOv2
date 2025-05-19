/**
 * api.js - External API clients
 * 
 * Handles communication with GPT-4o Vision, Stable Audio, and Tonn APIs.
 * Uses a direct, minimal approach with clean error handling.
 */

import { buildVisionUserMessage, getVisionSystemMessage, parseCaptionFromResponse } from '../utils/promptBuilder.js';

// API endpoints
const VISION_URL = "https://api.openai.com/v1/chat/completions";
const AUDIO_URL = "https://api.stability.ai/v2beta/audio/stable-audio-2/text-to-audio";

// Store API base URL as a module variable to ensure consistency
let apiBaseUrl = null;

// Function to get the base URL for backend API calls
function getApiBaseUrl() {
  // If we've already computed the API base URL, return it
  if (apiBaseUrl) {
    return apiBaseUrl;
  }

  let serverUrl = 'http://localhost:5000'; // Default server base
  if (window.SERVER_CONFIG && window.SERVER_CONFIG.getServerUrl()) {
    serverUrl = window.SERVER_CONFIG.getServerUrl();
  }

  // Ensure serverUrl does not end with /api, then append /api once
  if (serverUrl.endsWith('/api')) {
    apiBaseUrl = serverUrl; // It already includes /api, good as is
  } else if (serverUrl.endsWith('/')) {
    apiBaseUrl = `${serverUrl}api`; // e.g. http://localhost:xxxx/ becomes http://localhost:xxxx/api
  } else {
    apiBaseUrl = `${serverUrl}/api`; // e.g. http://localhost:xxxx becomes http://localhost:xxxx/api
  }

  console.log(`[API] Using API base URL: ${apiBaseUrl}`);
  return apiBaseUrl;
}

// Function to convert relative API paths to absolute URLs
function resolveApiUrl(relativePath) {
  const base = getApiBaseUrl();
  
  // If the path is already an absolute URL, return it
  if (relativePath.startsWith('http')) {
    return relativePath;
  }
  
  // Special case for paths that include /api/ twice
  if (relativePath.includes('/api/api/')) {
    const pathParts = relativePath.split('/api/api/');
    return `${base}/${pathParts[1]}`;
  }
  
  // Check if the relativePath already has 'api' in it
  if (relativePath.includes('/api/')) {
    // Extract the part after /api/ and append it to the base URL
    const pathAfterApi = relativePath.split('/api/')[1];
    return `${base}/${pathAfterApi}`;
  }
  
  // Ensure the relativePath starts with / but the base URL doesn't end with /
  if (relativePath.startsWith('/')) {
    return `${base}${relativePath}`;
  } else {
    return `${base}/${relativePath}`;
  }
}

// API keys - placeholder values for development
// In production, these would be injected during build or fetched from a secure backend
const OPENAI_API_KEY = ""
// const STABILITY_API_KEY = "sk-iOwQLkiwWbth6ukfMR4EZqPsfYlC05711YylYHGpmNO4PXqX"; // NO LONGER USED: Stability AI calls are proxied via backend

// Centralized Stability AI API call function - THIS FUNCTION IS LIKELY NO LONGER USED AND CAN BE REMOVED
// if all Stability calls go through the Python backend proxy as intended.
// For now, I will leave it but comment out its direct use of STABILITY_API_KEY if any.
async function callStabilityAPI(endpoint, formData) {
  const url = endpoint.startsWith('http') ? endpoint : `https://api.stability.ai${endpoint}`;
  console.warn(`[callStabilityAPI DEPRECATED] Direct call to Stability API attempted for ${url}. All calls should use the backend proxy.`);
  // This function would need to be removed or refactored if it's still called elsewhere, 
  // as client-side STABILITY_API_KEY is removed.
  // For now, to prevent errors if it IS called, let's make it throw an error or return a mock failure.
  throw new Error("callStabilityAPI is deprecated. Use backend proxy.");

  /* Original code that would fail without STABILITY_API_KEY
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STABILITY_API_KEY}`,
        'Accept': 'audio/*' 
      },
      body: formData
    });
    // ... rest of original function ...
  } catch (error) {
    console.error("Fetch error in callStabilityAPI:", error);
    throw error;
  }
  */
}

/**
 * Caption an image using GPT-4o Vision
 * 
 * @param {string} imageData - Base64 encoded image data or URL
 * @returns {Promise<Object>} The parsed caption data
 */
export async function captionImage(imageData) {
  try {
    console.log("Sending image to GPT-4o Vision...");
    
    // Prepare the request
    const response = await fetch(VISION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o", // Using GPT-4o with vision capabilities
        messages: [
          getVisionSystemMessage(),
          buildVisionUserMessage(imageData)
        ],
        max_tokens: 150
      })
    });
    
    if (!response.ok) {
      const errorBody = await response.json();
      console.error("GPT-4o Vision API Error:", errorBody);
      throw new Error(`API request failed with status ${response.status}: ${errorBody.error?.message || 'Unknown error'}`);
    }
    
    const data = await response.json();
    console.log("GPT-4o Vision response received");
    
    // Parse the caption from the response
    const caption = parseCaptionFromResponse(data);
    if (!caption) {
      throw new Error("Failed to parse caption from GPT-4o Vision response");
    }
    
    return caption;
  } catch (error) {
    console.error("Error in captionImage:", error);
    // Return a default/error object
    return { 
      description: "API Error",
      objects: [],
      mood: "neutral",
      section: "verse",
      genre: "unknown",
      bpm: 120
    };
  }
}

/**
 * Generate audio using Stable Audio API (via our Python backend proxy)
 * 
 * @param {string} prompt - Text prompt for audio generation
 * @param {number} bpm - Beats per minute
 * @param {Object} options - Additional options (duration, etc.)
 * @returns {Promise<Object>} The generated audio data
 */
export async function generateAudio(prompt, bpm, options = {}) {
  const MOCK_MODE = false; // Set to false to use real API
  
  if (MOCK_MODE) {
    console.log("Using mock Stable Audio API response");
    console.log("Prompt:", prompt);
    console.log("BPM:", bpm);
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Create a simple oscillator audio buffer (sine wave at the specified BPM)
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const duration = options.duration || 15; // Default to 15 seconds
    
    const sampleRate = audioContext.sampleRate;
    const buffer = audioContext.createBuffer(
      2, // stereo
      sampleRate * duration,
      sampleRate
    );
    
    const bpmFreq = bpm / 60; // beats per second
    const leftChannel = buffer.getChannelData(0);
    const rightChannel = buffer.getChannelData(1);
    
    for (let i = 0; i < buffer.length; i++) {
      const sample = Math.sin(2 * Math.PI * bpmFreq * i / sampleRate) * 0.5;
      leftChannel[i] = sample;
      rightChannel[i] = Math.sin(2 * Math.PI * (bpmFreq * 1.01) * i / sampleRate) * 0.5;
    }
    
    const wav = audioBufferToWav(buffer);
    
    return {
      audioBlob: wav,
      bpm: bpm,
      key: 'C Major', // Mock key
      duration: duration,
      serverFileId: 'mock-file-id-' + Date.now() // Mock server file ID
    };
  } else {
    try {
      console.log("[MAIN generateAudio] Using Python backend proxy with prompt:", prompt);
      
      // Use our backend proxy instead of calling Stability API directly
      const apiBaseUrl = getApiBaseUrl();
      const proxyUrl = `${apiBaseUrl}/generate-audio`;
      
      // Prepare request data as JSON (not FormData)
      const requestData = {
        prompt: prompt,
        bpm: bpm,
        duration: options.duration || 15,
        seed: Math.floor(Math.random() * 2147483647),
        output_format: 'wav'
      };
      
      console.log("[MAIN generateAudio] Sending request to backend proxy:", requestData);
      
      // Make the request to our backend proxy
      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData),
        credentials: 'same-origin' // Add credentials to ensure headers are included
      });
      
      // Handle errors
      if (!response.ok) {
        let errorMessage = `${response.status} ${response.statusText}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorMessage;
        } catch (e) {
          // If response is not JSON, use status text
        }
        throw new Error(`Audio generation failed: ${errorMessage}`);
      }
      
      // Get audio blob from response
      const audioBlob = await response.blob();
      
      // Log the raw headers directly from response
      console.log("[MAIN generateAudio] Raw response headers:");
      response.headers.forEach((value, key) => {
        console.log(`- ${key}: ${value}`);
      });
      
      // Extract metadata from response headers
      const returnedBpm = response.headers.get('x-stability-bpm') || bpm;
      const returnedKey = response.headers.get('x-stability-key') || 'unknown';
      const returnedDuration = response.headers.get('x-stability-duration') || options.duration || 15;
      const serverFileId = response.headers.get('x-file-id');
      
      // Get all headers for debugging
      const allHeaders = {};
      response.headers.forEach((value, key) => {
        allHeaders[key] = value;
      });
      console.log("[MAIN generateAudio] Response headers:", allHeaders);
      
      // Special debug for the server file ID
      if (serverFileId) {
        console.log("[MAIN generateAudio] SERVER FILE ID FOUND:", serverFileId);
      } else {
        console.warn("[MAIN generateAudio] No server file ID in headers. Headers received:", 
          Array.from(response.headers.entries()).map(([k,v]) => `${k}: ${v}`).join(", "));
      }
      
      console.log("[MAIN generateAudio] Audio generation successful:", {
        bpm: returnedBpm,
        key: returnedKey,
        duration: returnedDuration,
        serverFileId: serverFileId,
        blobSize: audioBlob.size
      });
      
      return {
        audioBlob,
        bpm: parseInt(returnedBpm, 10),
        key: returnedKey,
        duration: parseFloat(returnedDuration),
        serverFileId: serverFileId, // Include server file ID in the result
        headers: allHeaders // Include all headers for reference/debugging
      };
    } catch (error) {
      console.error("[MAIN generateAudio] Error generating audio with Stable Audio via proxy:", error);
      alert(`Error generating audio: ${error.message}`);
      return generateMockAudio(prompt, bpm, options.duration || 15);
    }
  }
}

// Helper function to convert an AudioBuffer to a WAV blob
function audioBufferToWav(buffer) {
  const numOfChannels = buffer.numberOfChannels;
  const length = buffer.length * numOfChannels * 2;
  const sampleRate = buffer.sampleRate;
  
  // Create the WAV file in memory
  const wav = new ArrayBuffer(44 + length);
  const view = new DataView(wav);
  
  // RIFF identifier
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(view, 8, 'WAVE');
  
  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // size of fmt chunk
  view.setUint16(20, 1, true); // PCM format (1)
  view.setUint16(22, numOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numOfChannels * 2, true); // byte rate
  view.setUint16(32, numOfChannels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  
  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, length, true);
  
  // Write audio data
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numOfChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      const int16Sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, int16Sample, true);
      offset += 2;
    }
  }
  
  return new Blob([wav], { type: 'audio/wav' });
}

// Helper to write strings to DataView
function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Upload sections to the backend for mixing
 * 
 * @param {Array} sectionFiles - Array of section WAV files
 * @param {Array} instruments - Array of instrument names for each section
 * @returns {Promise<Object>} Upload result with section IDs
 */
export async function uploadSections(sectionFiles, instruments) {
  try {
    const formData = new FormData();
    
    // Add each section file to the form data
    sectionFiles.forEach((file, index) => {
      formData.append('sections', file, `section_${index}.wav`);
    });
    
    // Add instrument information
    formData.append('instruments', JSON.stringify(instruments));
    
    // Call our backend proxy
    const response = await fetch(`${getApiBaseUrl()}/upload-sections`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Section upload failed: ${errorData.message || response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error("Error in uploadSections:", error);
    throw error;
  }
}

/**
 * Create a preview mix using Tonn API (via our backend proxy)
 * Enhanced to support both individual sections and stitched audio input
 * 
 * @param {Array<Object>} sectionsWithDetails - Array of section detail objects [{id: string, instruments: string[]}]
 * @param {string} genre - The overall genre for the mix
 * @param {Object} options - Additional options
 * @param {string} options.stitchedAudioPath - Optional path to already stitched audio (for direct final mix)
 * @param {boolean} options.skipPreview - If true and stitchedAudioPath provided, will request final mix directly
 * @returns {Promise<Object>} Preview mix result with task ID
 */
export async function createPreviewMix(sectionsWithDetails, genre, options = {}) {
  const baseUrl = getApiBaseUrl();
  console.log(`[API] Creating preview mix with ${sectionsWithDetails.length} sections, genre: ${genre}`);
  
  try {
    // Add timing information for debugging
    const startTime = performance.now();
    
    // Check if we should skip preview and go directly to final mix
    const skipPreview = options.skipPreview && options.stitchedAudioPath;
    
    // Log the full request payload for debugging
    const requestPayload = { 
      sections: sectionsWithDetails, 
      genre: genre
    };
    
    // Add options directly to the top level of the request payload for the server
    if (options.stitchedAudioPath) {
      requestPayload.stitchedAudioPath = options.stitchedAudioPath;
    }
    requestPayload.skipPreview = !!skipPreview;
    
    console.log('[API] Mix request payload:', requestPayload);
    
    // Determine the endpoint based on whether we're skipping preview
    const endpoint = skipPreview ? `${baseUrl}/create-direct-mix` : `${baseUrl}/create-preview-mix`;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestPayload),
    });
    
    const endTime = performance.now();
    console.log(`[API] Mix request completed in ${(endTime - startTime).toFixed(1)}ms`);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: response.statusText }));
      console.error(`[API] Error creating ${skipPreview ? 'direct' : 'preview'} mix:`, errorData);
      throw new Error(errorData.detail || `HTTP error ${response.status}`);
    }
    
    const responseData = await response.json();
    console.log(`[API] ${skipPreview ? 'Direct' : 'Preview'} mix creation successful:`, responseData);
    
    return responseData;
  } catch (error) {
    console.error('[API] Network or other error in createPreviewMix:', error);
    throw error;
  }
}

/**
 * Create a stitched song using Tonn API (via our backend proxy)
 * Enhanced with fallback and retry logic for invalid overlap values
 * 
 * @param {Array<Object>} uploadedSectionDetails - Array of section detail objects [{id: string, instruments: string[]}]
 * @param {number} overlapMs - The overlap duration in milliseconds
 * @param {Object} options - Additional options
 * @param {number} options.retryCount - Current retry attempt (used internally)
 * @returns {Promise<Object>} Stitched song result with download URL
 */
export async function createStitchedSong(uploadedSectionDetails, overlapMs, options = {}) {
  const baseUrl = getApiBaseUrl();
  const retryCount = options.retryCount || 0;
  const maxRetries = 2; // Maximum number of retries
  
  try {
    console.log(`[API] Creating stitched song with ${uploadedSectionDetails.length} sections and ${overlapMs}ms overlap${retryCount > 0 ? ` (retry ${retryCount}/${maxRetries})` : ''}`);
    
    // Validate input to prevent 422 errors
    if (!uploadedSectionDetails || !Array.isArray(uploadedSectionDetails) || uploadedSectionDetails.length < 2) {
      throw new Error(`Invalid section details: Need at least 2 sections to stitch, got ${uploadedSectionDetails ? uploadedSectionDetails.length : 0}`);
    }
    
    // Validate each section has required fields
    const invalidSections = uploadedSectionDetails.filter(section => !section.id || !section.path);
    if (invalidSections.length > 0) {
      throw new Error(`Invalid section details: ${invalidSections.length} sections missing required id or path fields`);
    }
    
    // Check overlap value is valid
    if (typeof overlapMs !== 'number' || overlapMs < 0 || isNaN(overlapMs)) {
      console.warn(`[API] Invalid overlap value: ${overlapMs}, defaulting to 200ms`);
      overlapMs = 200; // Default to 200ms if invalid
    }
    
    // Ensure overlap is reasonable to avoid 422 errors
    if (overlapMs > 5000 && retryCount === 0) {
      console.warn(`[API] Very large overlap value (${overlapMs}ms), might cause issues`);
    }
    
    const requestPayload = {
      uploaded_section_details: uploadedSectionDetails,
      overlap_ms: overlapMs
    };
    
    console.log(`[API] Sending stitching request: ${JSON.stringify(requestPayload, null, 2)}`);
    
    const response = await fetch(`${baseUrl}/create-stitched-song`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestPayload),
    });
    
    if (!response.ok) {
      // Try to extract detailed error message
      let errorDetail;
      let errorData;
      
      try {
        errorData = await response.json();
        console.error("[API] Error creating stitched song:", errorData);
        
        // Properly extract the error message from the response
        if (errorData.detail) {
          errorDetail = typeof errorData.detail === 'string' 
            ? errorData.detail 
            : JSON.stringify(errorData.detail);
        } else {
          errorDetail = `HTTP error ${response.status}: ${response.statusText}`;
        }
      } catch (parseError) {
        errorDetail = `HTTP error ${response.status}: ${response.statusText}`;
        console.error(`[API] Error parsing error response: ${parseError.message}`);
      }
      
      // Check if this is a 422 error and we haven't exceeded max retries
      if (response.status === 422 && retryCount < maxRetries) {
        // Try again with a more conservative overlap value
        console.warn(`[API] Server rejected request with 422 error, retrying with smaller overlap value`);
        
        // Use a smaller overlap value for retry
        const reducedOverlap = Math.max(50, Math.floor(overlapMs * 0.5));
        console.log(`[API] Reducing overlap from ${overlapMs}ms to ${reducedOverlap}ms for retry`);
        
        // Recursive call with reduced overlap and incremented retry count
        return createStitchedSong(uploadedSectionDetails, reducedOverlap, { 
          retryCount: retryCount + 1 
        });
      }
      
      throw new Error(errorDetail);
    }
    
    const responseData = await response.json();
    
    // Ensure download_url is an absolute URL
    if (responseData.download_url && responseData.download_url.startsWith('/')) {
      responseData.download_url = resolveApiUrl(responseData.download_url);
      console.log(`[API] Resolved download URL: ${responseData.download_url}`);
    }
    
    return responseData;
  } catch (error) {
    console.error('[API] Network or other error in createStitchedSong:', error);
    throw error;
  }
}

/**
 * Check the status of a mix task
 * Enhanced with better error handling and retry logic
 * 
 * @param {string} taskId - The task ID from createPreviewMix
 * @param {number} maxRetries - Maximum number of retries for transient errors (default: 3)
 * @returns {Promise<Object>} Mix status data
 */
export async function checkMixStatus(taskId, maxRetries = 3) {
  let retries = 0;
  
  while (retries <= maxRetries) {
    try {
      console.log(`[API] Checking mix status for task ${taskId}, attempt ${retries + 1}/${maxRetries + 1}`);
      
      // Call our backend proxy
      const response = await fetch(`${getApiBaseUrl()}/mix-status/${taskId}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          console.warn(`[API] Mix task ${taskId} not found`);
          throw new Error(`Mix task ${taskId} not found`);
        } else if (response.status >= 500 && retries < maxRetries) {
          // Retry on server errors
          retries++;
          console.warn(`[API] Server error (${response.status}) checking mix status, retrying in 2s...`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
          continue;
        } else {
          const errorData = await response.json().catch(() => ({ message: response.statusText }));
          throw new Error(`Mix status check failed: ${errorData.message || response.statusText}`);
        }
      }
      
      const statusData = await response.json();
      console.log(`[API] Mix status for task ${taskId}:`, statusData);
      
      return statusData;
    } catch (error) {
      if (retries >= maxRetries) {
        console.error(`[API] Error checking mix status after ${maxRetries + 1} attempts:`, error);
        throw error;
      }
      
      // For network errors, retry
      if (error instanceof TypeError && error.message.includes('fetch')) {
        retries++;
        console.warn(`[API] Network error checking mix status, retrying in 2s...`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
      } else {
        // For other errors, just throw
        throw error;
      }
    }
  }
  
  // Should never reach here due to throws above
  throw new Error(`Unexpected error checking mix status for task ${taskId}`);
}

/**
 * Utility to poll for mix status until completion
 * @param {string} taskId - Task ID to poll
 * @param {Object} options - Poll options
 * @param {number} options.interval - Polling interval in ms (default: 2000)
 * @param {number} options.timeout - Maximum time to poll in ms (default: 5 minutes)
 * @param {Function} options.onProgress - Called with status updates
 * @returns {Promise<Object>} Final mix status
 */
export async function pollMixStatusUntilComplete(taskId, options = {}) {
  const interval = options.interval || 2000;
  const timeout = options.timeout || 300000; // 5 minutes
  const onProgress = options.onProgress || (() => {});
  
  const startTime = Date.now();
  
  console.log(`[API] Starting mix status polling for task ${taskId}, timeout: ${timeout}ms`);
  
  while (Date.now() - startTime < timeout) {
    try {
      const status = await checkMixStatus(taskId);
      
      // Calculate progress percentage (if not provided)
      if (!status.progress && status.status === 'processing') {
        const elapsedTime = Date.now() - startTime;
        const estimatedProgress = Math.min(95, Math.floor((elapsedTime / 60000) * 20)); // ~20% per minute, max 95%
        status.progress = estimatedProgress;
      }
      
      // Call progress callback
      onProgress(status);
      
      // If mix is complete or failed, return
      if (status.status === 'COMPLETED' || status.status === 'completed') {
        console.log(`[API] Mix task ${taskId} completed successfully`);
        return status;
      } else if (status.status === 'FAILED' || status.status === 'ERROR' || status.status === 'error') {
        console.error(`[API] Mix task ${taskId} failed:`, status);
        throw new Error(`Mix task failed: ${status.error || 'Unknown error'}`);
      }
      
      // Wait for next poll
      await new Promise(resolve => setTimeout(resolve, interval));
    } catch (error) {
      console.error(`[API] Error polling mix status for task ${taskId}:`, error);
      throw error;
    }
  }
  
  // If we get here, we've timed out
  throw new Error(`Mix task ${taskId} timed out after ${timeout}ms`);
}

/**
 * Create a final mix using Tonn API (via our backend proxy)
 * Enhanced to directly accept stitched audio paths
 * 
 * @param {string} previewTaskId - The task ID from a successful preview mix
 * @param {Object} options - Additional options
 * @param {string} options.stitchedAudioPath - Optional path to already stitched audio
 * @returns {Promise<Object>} Final mix result with download URL
 */
export async function createFinalMix(previewTaskId, options = {}) {
  try {
    const baseUrl = getApiBaseUrl();
    console.log(`[API] Creating final mix for preview task ID: ${previewTaskId}`);
    
    // Add timing information for debugging
    const startTime = performance.now();
    
    // Check if a stitched audio path was provided
    const hasStitchedPath = !!options.stitchedAudioPath;
    
    // Call our backend proxy
    const response = await fetch(`${baseUrl}/create-final-mix`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        previewTaskId,
        // Include stitched audio path if provided
        stitchedAudioPath: options.stitchedAudioPath,
        // Add a timestamp to help with debugging
        clientTimestamp: new Date().toISOString()
      })
    });
    
    const endTime = performance.now();
    console.log(`[API] Final mix request completed in ${(endTime - startTime).toFixed(1)}ms`);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: response.statusText }));
      console.error("[API] Error creating final mix:", errorData);
      throw new Error(errorData.detail || `HTTP error ${response.status}`);
    }
    
    const responseData = await response.json();
    console.log(`[API] Final mix creation successful:`, responseData);
    
    if (!responseData.task_id) {
      console.warn("[API] Final mix response missing task_id:", responseData);
      // Try to extract task ID from the response if possible
      responseData.task_id = responseData.task_id || responseData.multitrack_task_id || previewTaskId;
    }
    
    return responseData;
  } catch (error) {
    console.error("[API] Error in createFinalMix:", error);
    throw error;
  }
}

/**
 * Generate a mock audio blob for development and testing
 * @private
 */
function generateMockAudio(prompt, bpm, duration) {
  try {
    // Create a proper WAV audio blob
    const sampleRate = 44100;
    const numChannels = 1; // Mono is simpler and more reliable
    const bitsPerSample = 16;
    const actualBpm = bpm || 120; // Default to 120 if null
    
    // Create WAV header
    const blockAlign = numChannels * bitsPerSample / 8;
    const byteRate = sampleRate * blockAlign;
    const dataSize = sampleRate * duration * blockAlign;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;
    
    // Create a buffer for the WAV file
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    
    // Write WAV header
    // "RIFF" chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, totalSize - 8, true);
    writeString(view, 8, 'WAVE');
    
    // "fmt " sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // audio format (1 = PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    
    // "data" sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Write audio data - simple sine wave based on BPM
    const frequency = actualBpm / 60; // Base frequency on BPM
    for (let i = 0; i < sampleRate * duration; i++) {
      // Create a simple sine wave at the BPM frequency
      const sampleValue = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.5;
      
      // Convert to 16-bit and write to buffer
      const sampleInt = Math.floor(sampleValue * 32767);
      view.setInt16(headerSize + i * 2, sampleInt, true);
    }
    
    // Create blob from buffer
    const audioBlob = new Blob([buffer], { type: 'audio/wav' });
    
    console.log("Generated valid mock audio WAV blob:", audioBlob);
    
    // Return mock data
    return {
      audioBlob: audioBlob,
      bpm: actualBpm,
      key: 'C Major', // Mock key
      duration: duration
    };
  } catch (error) {
    console.error("Error generating mock audio:", error);
    
    // Very minimal fallback WAV
    const fallbackWav = createFallbackWav();
    return {
      audioBlob: fallbackWav,
      bpm: bpm || 120,
      key: 'C Major',
      duration: duration
    };
  }
}

// Create a minimal valid WAV file as fallback
function createFallbackWav() {
  // Create a minimal valid WAV file (44.1kHz, mono, 16-bit)
  const buffer = new ArrayBuffer(44 + 4410 * 2); // 44 byte header + 0.1s of silence
  const view = new DataView(buffer);
  
  // Write WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + 4410 * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);  // Mono
  view.setUint32(24, 44100, true);  // Sample rate
  view.setUint32(28, 44100 * 2, true);  // Byte rate
  view.setUint16(32, 2, true);  // Block align
  view.setUint16(34, 16, true);  // Bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, 4410 * 2, true);
  
  // Fill with silence (all zeros)
  for (let i = 0; i < 4410; i++) {
    view.setInt16(44 + i * 2, 0, true);
  }
  
  return new Blob([buffer], { type: 'audio/wav' });
}

// Add function to process images with GPT-4o Vision
export async function processImageWithGPT4o(imageData) {
  // In a real implementation, this would call the OpenAI API
  // For testing purposes, we'll return a mock response
  
  const MOCK_MODE = false; // Set to false to use real API
  
  if (MOCK_MODE) {
    console.log("Using mock GPT-4o Vision API response");
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Return mock caption data
    return {
      description: "Colorful sunset over mountains",
      objects: ["mountains", "sun", "sky"],
      mood: "peaceful, serene",
      section: "intro",
      genre: "ambient",
      bpm: 80
    };
  } else {
    // Real API implementation would go here
    try {
      console.log("Sending image to GPT-4o Vision for analysis...");
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: "You are Scene-Music Captioner v2, with great music taste and creative ideas for how to transfrom real world scene to a sample of audio. Return **valid JSON only** with these keys: description (≤40 chars vivid summary), objects (up to 3 salient nouns), mood (2-3 adjectives), section (one of [intro, verse, chorus, bridge, outro]), genre (1-3 words), bpm (integer 60-180 or null)."
            },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { 
                    url: imageData 
                  }
                },
                {
                  type: "text",
                  text: "Analyze this image with sense of color, object, and relationships and return a JSON caption for music generation."
                }
              ]
            }
          ],
          max_tokens: 150
        })
      });
      
      // Handle non-200 responses
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
        console.error("GPT-4o Vision API Error:", errorBody);
        throw new Error(`GPT-4o API Error: ${response.status} - ${errorBody.error?.message || 'Unknown error'}`);
      }
      
      const data = await response.json();
      
      if (!data.choices || data.choices.length === 0) {
        throw new Error("No response content from GPT-4o Vision");
      }
      
      // Parse the response content as JSON
      try {
        const contentText = data.choices[0].message.content;
        console.log("GPT-4o Vision response:", contentText);
        
        // Clean up any markdown code blocks
        let jsonText = contentText;
        if (contentText.includes("```json")) {
          jsonText = contentText.split("```json")[1].split("```")[0].trim();
        } else if (contentText.includes("```")) {
          jsonText = contentText.split("```")[1].split("```")[0].trim();
        }
        
        const result = JSON.parse(jsonText);
        
        // Validate required fields
        const requiredFields = ['description', 'mood', 'section', 'genre'];
        for (const field of requiredFields) {
          if (!result[field]) {
            console.warn(`Missing required field in GPT-4o response: ${field}`);
            // Set defaults for missing fields
            if (field === 'section') result.section = 'verse';
            if (field === 'genre') result.genre = 'pop';
            if (field === 'mood') result.mood = 'neutral';
            if (field === 'description') result.description = 'Generated music';
          }
        }
        
        // Ensure objects is an array
        if (!Array.isArray(result.objects)) {
          result.objects = [];
        }
        
        // Ensure BPM is a number or null
        if (result.bpm && isNaN(parseInt(result.bpm))) {
          result.bpm = null;
        } else if (result.bpm) {
          result.bpm = parseInt(result.bpm);
        }
        
        return result;
      } catch (parseError) {
        console.error("Failed to parse GPT-4o response as JSON:", parseError, "Content:", data.choices[0].message.content);
        
        // Fall back to a default object with values extracted from text
        const content = data.choices[0].message.content;
        const fallbackResult = {
          description: extractTextBetween(content, "description", 40) || "Generated music",
          objects: [],
          mood: extractTextBetween(content, "mood") || "neutral",
          section: extractTextBetween(content, "section") || "verse",
          genre: extractTextBetween(content, "genre") || "pop",
          bpm: extractNumber(content, "bpm") || 120
        };
        
        return fallbackResult;
      }
    } catch (error) {
      console.error("Error processing image with GPT-4o:", error);
      alert(`Error analyzing image: ${error.message}`);
      
      // Return a default caption
      return {
        description: "Error analyzing image",
        objects: [],
        mood: "neutral",
        section: "verse",
        genre: "pop",
        bpm: 120
      };
    }
  }
}

// Helper function to extract text from GPT-4o response
function extractTextBetween(text, key, maxLength = 0) {
  const regex = new RegExp(`${key}[^a-zA-Z0-9]*([^,"\n]+)`, 'i');
  const match = text.match(regex);
  if (match && match[1]) {
    const extracted = match[1].trim();
    return maxLength > 0 ? extracted.substring(0, maxLength) : extracted;
  }
  return null;
}

// Helper function to extract a number from text
function extractNumber(text, key) {
  const regex = new RegExp(`${key}[^a-zA-Z0-9]*([0-9]+)`, 'i');
  const match = text.match(regex);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return null;
}

// Direct test function for debugging
async function testStabilityApiDirectly() {
  try {
    // Instead of calling Stability API directly, use our backend proxy
    const apiBaseUrl = getApiBaseUrl();
    const proxyUrl = `${apiBaseUrl}/generate-audio`;
    
    const testPrompt = 'epic cinematic music with orchestral strings and choir';
    
    // Prepare request data as JSON (not FormData)
    const requestData = {
      prompt: testPrompt,
      bpm: 100,
      duration: 7,
      seed: 42,
      output_format: 'wav'
    };
    
    console.log("Running test through backend proxy. Prompt:", testPrompt);
    console.log("Sending request to backend proxy:", requestData);
    
    // Make the request to our backend proxy
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });
    
    if (!response.ok) {
      let errorMessage = `${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.detail || errorMessage;
      } catch (e) {
        // If response is not JSON, use status text
      }
      throw new Error(`Audio generation failed: ${errorMessage}`);
    }
    
    // Get audio blob from response
    const blob = await response.blob();
    console.log("Test successful! Received blob size:", blob.size, "type:", blob.type);
    
    // Create a URL for the audio blob
    const audioUrl = URL.createObjectURL(blob);
    console.log("Test audio URL (try opening in a new tab to play/download):", audioUrl);
    
    // Return test results
    return { 
      status: response.status, 
      blob, 
      audioUrl, 
      headers: Object.fromEntries(response.headers.entries()) 
    };
  } catch (error) {
    console.error("Proxy API test FAILED:", error.message);
    alert(`Proxy API Test Failed: ${error.message}`);
    return { error: error.message };
  }
}

// Export key functions
export { getApiBaseUrl, resolveApiUrl };

// --- Make sure all necessary functions are exported ---
// (captionImage, uploadSections, createPreviewMix, checkMixStatus, createFinalMix were here)
// (audioBufferToWav, writeString, generateMockAudio, createFallbackWav were helper functions)
// (processImageWithGPT4o, extractTextBetween, extractNumber were also here)

// All previously defined utility functions and API interaction functions should be here if they were not part of the edit.
// For brevity, I am assuming they exist as per the previous state of the file.

// --- Correctly expose testStabilityApiDirectly to the window object ---
// This must be at the top level of the module, after the function is defined.
if (typeof window !== 'undefined') {
  window.testStabilityApi = testStabilityApiDirectly;
  console.log("testStabilityApi function has been exposed to window. Call await window.testStabilityApi() in console.");
}
