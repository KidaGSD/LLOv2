/**
 * Audio Context management utility
 * Handles the creation and management of Web Audio API contexts
 */

// Singleton instance of the AudioContext
let audioContext = null;

/**
 * Get or create the main audio context
 * @returns {AudioContext} The audio context instance
 */
export function getAudioContext() {
  if (!audioContext) {
    // Create a new AudioContext
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    
    if (!AudioContextClass) {
      throw new Error('Web Audio API is not supported in this browser');
    }
    
    audioContext = new AudioContextClass({
      latencyHint: 'interactive',
      sampleRate: 44100
    });
    
    // Resume context if it's suspended (browsers require user interaction)
    if (audioContext.state === 'suspended') {
      const resumeOnInteraction = () => {
        audioContext.resume().then(() => {
          console.log('AudioContext resumed successfully');
          
          // Remove event listeners once resumed
          document.removeEventListener('click', resumeOnInteraction);
          document.removeEventListener('touchstart', resumeOnInteraction);
          document.removeEventListener('keydown', resumeOnInteraction);
        });
      };
      
      // Add event listeners for user interaction
      document.addEventListener('click', resumeOnInteraction);
      document.addEventListener('touchstart', resumeOnInteraction);
      document.addEventListener('keydown', resumeOnInteraction);
    }
  }
  
  return audioContext;
}

/**
 * Create an offline audio context for processing without playback
 * @param {number} duration - Duration in frames
 * @param {number} sampleRate - Sample rate to use (defaults to 44100)
 * @returns {OfflineAudioContext} The offline audio context
 */
export function createOfflineContext(duration, sampleRate = 44100) {
  // Check if OfflineAudioContext is supported
  if (!window.OfflineAudioContext) {
    throw new Error('Offline Audio Context is not supported in this browser');
  }
  
  return new OfflineAudioContext({
    numberOfChannels: 2,
    length: duration,
    sampleRate: sampleRate
  });
}

/**
 * Decode an audio file into an AudioBuffer
 * @param {ArrayBuffer} arrayBuffer - The audio file data as ArrayBuffer
 * @returns {Promise<AudioBuffer>} The decoded audio buffer
 */
export async function decodeAudioData(arrayBuffer) {
  const context = getAudioContext();
  
  try {
    return await context.decodeAudioData(arrayBuffer);
  } catch (error) {
    console.error('Error decoding audio data:', error);
    throw new Error('Could not decode audio file');
  }
}

/**
 * Create a buffer source node from an audio buffer
 * @param {AudioBuffer} buffer - The audio buffer to use
 * @returns {AudioBufferSourceNode} The buffer source node
 */
export function createBufferSource(buffer) {
  const context = getAudioContext();
  const source = context.createBufferSource();
  source.buffer = buffer;
  return source;
}

/**
 * Create a gain node for volume control
 * @param {number} initialGain - Initial gain value (0-1)
 * @returns {GainNode} The gain node
 */
export function createGainNode(initialGain = 1) {
  const context = getAudioContext();
  const gainNode = context.createGain();
  gainNode.gain.value = initialGain;
  return gainNode;
}

/**
 * Create an analyzer node for visualization
 * @param {Object} options - Analyzer options
 * @returns {AnalyserNode} The analyzer node
 */
export function createAnalyzer(options = {}) {
  const context = getAudioContext();
  const analyzer = context.createAnalyser();
  
  // Configure analyzer
  analyzer.fftSize = options.fftSize || 2048;
  analyzer.smoothingTimeConstant = options.smoothing || 0.8;
  
  return analyzer;
}

/**
 * Check if the audio context is running
 * @returns {boolean} True if the context is running
 */
export function isAudioContextRunning() {
  return audioContext && audioContext.state === 'running';
}

/**
 * Suspend the audio context to save resources
 * @returns {Promise<void>}
 */
export async function suspendAudioContext() {
  if (audioContext && audioContext.state === 'running') {
    await audioContext.suspend();
    console.log('AudioContext suspended');
  }
}

/**
 * Resume the audio context
 * @returns {Promise<void>}
 */
export async function resumeAudioContext() {
  if (audioContext && audioContext.state === 'suspended') {
    await audioContext.resume();
    console.log('AudioContext resumed');
  }
}

/**
 * Get current audio context time
 * @returns {number} Current time in seconds
 */
export function getCurrentTime() {
  return audioContext ? audioContext.currentTime : 0;
}

/**
 * Convert an AudioBuffer to a Blob (WAV format)
 * @param {AudioBuffer} buffer - The audio buffer to convert
 * @returns {Blob} The resulting WAV blob
 */
export function audioBufferToWav(buffer) {
  const numOfChannels = buffer.numberOfChannels;
  const L = buffer.length;
  const sampleRate = buffer.sampleRate;
  const WAV_HEADER_SIZE = 44;

  const header = new ArrayBuffer(WAV_HEADER_SIZE);
  const view = new DataView(header);
  let offset = 0;

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // RIFF identifier
  writeString(view, offset, 'RIFF'); offset += 4;
  // File length 
  view.setUint32(offset, WAV_HEADER_SIZE + L * numOfChannels * 2 - 8, true); offset += 4;
  // RIFF type
  writeString(view, offset, 'WAVE'); offset += 4;
  // Format Chunk identifier
  writeString(view, offset, 'fmt '); offset += 4;
  // Format Chunk length
  view.setUint32(offset, 16, true); offset += 4;
  // Audio Format (PCM)
  view.setUint16(offset, 1, true); offset += 2;
  // Number of Channels
  view.setUint16(offset, numOfChannels, true); offset += 2;
  // Sample Rate
  view.setUint32(offset, sampleRate, true); offset += 4;
  // Byte Rate
  view.setUint32(offset, sampleRate * numOfChannels * (16 / 8), true); offset += 4;
  // Block Align
  view.setUint16(offset, numOfChannels * (16 / 8), true); offset += 2;
  // Bits per Sample
  view.setUint16(offset, 16, true); offset += 2;
  // Data Chunk identifier
  writeString(view, offset, 'data'); offset += 4;
  // Data Chunk length
  view.setUint32(offset, L * numOfChannels * (16 / 8), true); offset += 4;

  // Write PCM data
  const pcmData = new ArrayBuffer(L * numOfChannels * 2);
  const pcmView = new DataView(pcmData);
  offset = 0; // Reset offset for pcmView

  for (let i = 0; i < L; i++) { // Iterate through samples
    for (let channel = 0; channel < numOfChannels; channel++) { // Iterate through channels for each sample (interleaving)
      const channelData = buffer.getChannelData(channel);
      let sample = channelData[i];
      sample = Math.max(-1, Math.min(1, sample)); // Clamp
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF; // Convert to 16-bit int
      pcmView.setInt16(offset, sample, true);
      offset += 2;
    }
  }

  const wavBytes = new Uint8Array(WAV_HEADER_SIZE + pcmData.byteLength);
  wavBytes.set(new Uint8Array(header), 0);
  wavBytes.set(new Uint8Array(pcmData), WAV_HEADER_SIZE);

  console.log(`[audioBufferToWav] IMPLEMENTED: Created WAV blob. Size: ${wavBytes.byteLength}, Channels: ${numOfChannels}, SampleRate: ${sampleRate}, Length: ${L}`);
  return new Blob([wavBytes], { type: 'audio/wav' });
}

/**
 * Clean up and release audio resources
 */
export function cleanupAudioContext() {
  if (audioContext) {
    // Close the audio context if we're done with it
    if ('close' in audioContext) {
      audioContext.close();
    }
    audioContext = null;
    console.log('AudioContext cleaned up');
  }
} 