import { store } from './store.js';
import { getSectionTypes } from '../utils/sectionUtils.js';
import { buildPrompt } from '../utils/promptBuilder.js';
import * as api from './api.js';
import { getAudioContext, createOfflineContext, audioBufferToWav } from '../audio/audioContext.js';
import { createVisualizer } from '../components/visualizer.js';
import { continuousPlaybackEngine } from './audio.js';

/**
 * SectionManager class handles section-based audio creation, playback, and mixing
 * It manages section data including instruments, audio buffers, and exports
 */
class SectionManager {
  constructor() {
    // Track player state
    this.isPlaying = false;
    this.startTime = 0;
    this.currentSection = null;
    this.audioBuffers = new Map(); // section ID -> audio buffer
    this.audioNodes = new Map(); // section ID -> audio node
    this.visualizers = new Map(); // section ID -> visualizer
    
    // For VU Meter
    this.analyserNode = null;
    this.analyserDataArray = null;
    
    // Section buffer references for faster access
    this.bufferCache = new Map(); // section ID -> ArrayBuffer (raw data)
    
    // Mixing state
    this.mixingInProgress = false;
    this.mixData = null;
    this.autoMixEnabled = true;
    this.lastMixTriggeredAt = 0;
    this.mixCooldownPeriod = 5000; // 5 seconds between automatic mix triggers
    
    // Continuous playback state
    this.continuousPlaybackActive = false;
    
    // References to HTML elements
    this.playerElement = null;
    this.progressBarElement = null;
    
    // Bind methods
    this.addSection = this.addSection.bind(this);
    this.removeSection = this.removeSection.bind(this);
    this.playSection = this.playSection.bind(this);
    this.stopPlayback = this.stopPlayback.bind(this);
    this.createSectionMix = this.createSectionMix.bind(this);
    this.setSectionAudio = this.setSectionAudio.bind(this);
    this.updateSection = this.updateSection.bind(this);
    this.setInstruments = this.setInstruments.bind(this);
    this.audioUrls = new Map(); // Optional: if sectionManager needs direct URL access
    this.getAudioLevel = this.getAudioLevel.bind(this);
    
    // New methods for continuous playback
    this.startContinuousPlayback = this.startContinuousPlayback.bind(this);
    this.stopContinuousPlayback = this.stopContinuousPlayback.bind(this);
    this.checkAndTriggerAutoMix = this.checkAndTriggerAutoMix.bind(this);
    this.handleLoopComplete = this.handleLoopComplete.bind(this);
    this.handleSectionChange = this.handleSectionChange.bind(this);
    
    // Track section additions for mastering
    this.appendedSections = [];
    this.lastMasteredSectionCount = 0;
    this.pendingMasterTask = null;
  }
  
  /**
   * Initialize the section manager with required references
   * @param {Object} options - Configuration options
   */
  initialize(options = {}) {
    this.playerElement = options.playerElement || document.getElementById('audio-player');
    this.progressBarElement = options.progressBarElement || document.getElementById('progress-bar');
    
    // Set up event listeners
    if (this.playerElement) {
      this.playerElement.addEventListener('ended', this.stopPlayback);
    }
    
    // Initialize audio context if not already done
    const audioContext = getAudioContext(); 
    if (audioContext) {
        this.analyserNode = audioContext.createAnalyser();
        this.analyserNode.fftSize = 256;
        this.analyserDataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
        this.analyserNode.connect(audioContext.destination); // Connect main analyser to destination once
        console.log("Main analyser node created and connected to destination.");
    }
    
    // Check for sections that need audio restoration from localStorage
    this.checkForRestoredSections();
    
    console.log('SectionManager initialized');
  }
  
  /**
   * Check if there are sections in the store that were loaded from localStorage
   * and need their audio to be regenerated
   */
  checkForRestoredSections() {
    const sections = store.get('sections');
    if (!sections || sections.length === 0) return;
    
    console.log(`[SectionManager] Checking ${sections.length} sections for restoration needs`);
    
    // Check for sections with serverFileId that could be loaded instead of regenerated
    const sectionsWithServerFiles = sections.filter(s => s.serverFileId);
    console.log(`[SectionManager] Found ${sectionsWithServerFiles.length} sections with server file references:`, 
      sectionsWithServerFiles.map(s => ({ id: s.id, serverFileId: s.serverFileId })));
    
    if (sectionsWithServerFiles.length > 0) {
      console.log(`[SectionManager] Will attempt to load ${sectionsWithServerFiles.length} server audio files`);
      
      // Try to load these server files
      this.loadServerAudioFiles(sectionsWithServerFiles);
    }
    
    // Check for sections that need regular regeneration (no server file reference)
    const restoredSections = sections.filter(s => (s.status === 'selected' || s.audioNeedsRegeneration) && !s.serverFileId);
    if (restoredSections.length > 0) {
      console.log(`[SectionManager] Found ${restoredSections.length} sections that need audio regeneration`);
      
      // We'll inform the user about this, but won't regenerate automatically
      // since that would trigger a lot of API calls
      setTimeout(() => {
        alert(`${restoredSections.length} section(s) have been restored from storage but need audio regeneration. Please click 'Generate Audio' on each section to restore its audio.`);
      }, 1000);
    }
  }
  
  /**
   * Try to load audio files from the server for restored sections
   * @param {Array} sections - Sections with serverFileId references
   */
  async loadServerAudioFiles(sections) {
    if (!sections || sections.length === 0) return;
    
    console.log(`[SectionManager] Attempting to load ${sections.length} audio files from server:`, 
      sections.map(s => ({ id: s.id, serverFileId: s.serverFileId })));
    
    // Get API base URL
    const apiBaseUrl = window.SERVER_CONFIG && window.SERVER_CONFIG.getServerUrl
      ? `${window.SERVER_CONFIG.getServerUrl()}/api`
      : 'http://localhost:5000/api';
    
    console.log(`[SectionManager] Using API base URL: ${apiBaseUrl}`);
    
    // Check if we can directly access the server for a smoke test
    try {
      const healthResponse = await fetch(`${apiBaseUrl}/health`, { method: 'HEAD' });
      if (healthResponse.ok) {
        console.log(`[SectionManager] Server health check OK: ${healthResponse.status}`);
      } else {
        console.warn(`[SectionManager] Server health check failed: ${healthResponse.status}`);
      }
    } catch (error) {
      console.error(`[SectionManager] Server health check error:`, error);
    }
    
    // Process each section with a serverFileId
    let loadedCount = 0;
    const failedSections = [];
    
    for (const section of sections) {
      try {
        // Build the URL to the server-side audio file
        const fileId = section.serverFileId;
        if (!fileId) {
          console.warn(`[SectionManager] Section ${section.id} has no serverFileId, skipping.`);
          failedSections.push(section);
          continue;
        }
        
        const audioUrl = `${apiBaseUrl}/sections/${fileId}`;
        
        console.log(`[SectionManager] Loading audio for section ${section.id} from ${audioUrl}`);
        
        // Fetch the audio file
        const response = await fetch(audioUrl);
        
        if (!response.ok) {
          console.warn(`[SectionManager] Failed to load audio for section ${section.id}: ${response.status} ${response.statusText}`);
          failedSections.push(section);
          continue;
        }
        
        // Get the audio blob
        const audioBlob = await response.blob();
        
        if (!audioBlob || audioBlob.size < 1000) {
          console.warn(`[SectionManager] Retrieved empty or too small audio blob for section ${section.id}: ${audioBlob.size} bytes`);
          failedSections.push(section);
          continue;
        }
        
        console.log(`[SectionManager] Successfully fetched audio blob: ${audioBlob.size} bytes`);
        
        // Create an object URL
        const objectUrl = URL.createObjectURL(audioBlob);
        
        // Decode the audio data
        try {
          const arrayBuffer = await audioBlob.arrayBuffer();
          const audioContext = getAudioContext();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          
          console.log(`[SectionManager] Successfully decoded audio for section ${section.id}: duration=${audioBuffer.duration}s, channels=${audioBuffer.numberOfChannels}`);
          
          // Store the audio data
          this.audioBuffers.set(section.id, audioBuffer);
          this.audioUrls.set(section.id, objectUrl);
          
          // Update the section in the store
          const updatedSection = {
            ...section,
            audioUrl: objectUrl,
            status: 'ready',
            audioNeedsRegeneration: false
          };
          
          // Update the section in the store
          const sections = store.get('sections');
          const index = sections.findIndex(s => s.id === section.id);
          if (index !== -1) {
            const updatedSections = [...sections];
            updatedSections[index] = updatedSection;
            store.set('sections', updatedSections);
          }
          
          loadedCount++;
          console.log(`[SectionManager] Successfully loaded audio for section ${section.id}`);
        } catch (decodeError) {
          console.error(`[SectionManager] Error decoding audio for section ${section.id}:`, decodeError);
          failedSections.push(section);
        }
      } catch (error) {
        console.error(`[SectionManager] Error loading audio for section ${section.id}:`, error);
        failedSections.push(section);
      }
    }
    
    console.log(`[SectionManager] Audio loading complete. Loaded: ${loadedCount}, Failed: ${failedSections.length}`);
    
    // If we have sections that failed to load, mark them for regeneration
    if (failedSections.length > 0) {
      const storeSectons = store.get('sections');
      
      for (const failedSection of failedSections) {
        const index = storeSectons.findIndex(s => s.id === failedSection.id);
        if (index !== -1) {
          const updatedSections = [...storeSectons];
          updatedSections[index] = {
            ...updatedSections[index],
            audioNeedsRegeneration: true,
            status: 'selected'
          };
          store.set('sections', updatedSections);
          console.log(`[SectionManager] Marked section ${failedSection.id} for audio regeneration`);
        }
      }
      
      setTimeout(() => {
        alert(`${failedSections.length} section(s) could not load audio from the server. Please click 'Generate Audio' to regenerate them.`);
      }, 1500);
    }
  }
  
  /**
   * Check if a server-side audio file exists for a section
   * @param {string} fileId - Server-side file ID to check
   * @returns {Promise<boolean>} True if file exists, false otherwise
   */
  async checkServerFileExists(fileId) {
    try {
      const apiBaseUrl = api.getApiBaseUrl ? api.getApiBaseUrl() : 'http://localhost:5000/api';
      const audioUrl = `${apiBaseUrl}/sections/${fileId}`;
      
      // Attempt a HEAD request to check if the file exists
      const response = await fetch(audioUrl, { method: 'HEAD' });
      return response.ok;
    } catch (error) {
      console.error(`[SectionManager] Error checking server file ${fileId}:`, error);
      return false;
    }
  }
  
  /**
   * Reset all audio buffers and URLs
   * Used when clearing all sections
   */
  clearAudioData() {
    this.audioBuffers.clear();
    this.audioUrls.clear();
    this.visualizers.clear();
    this.bufferCache.clear();
    
    // Reset any playing audio
    this.stopPlayback();
    
    console.log('[SectionManager] All audio data cleared');
  }
  
  /**
   * Add a new section to the session
   * @param {string} type - Section type (intro, verse, chorus, etc.)
   * @param {number} index - Position where to add the section (optional)
   * @returns {Object} The newly created section
   */
  addSection(type, index = null) {
    // Generate a unique ID for the section
    const sectionId = 'section_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    
    // Create the new section object
    const newSection = {
      id: sectionId,
      type: type,
      instruments: [], // Will be populated when user selects instruments
      status: 'empty', // empty, selected, generating, ready
      audioBuffer: null,
      visualData: null,
      prompt: '',
      caption: null
    };
    
    // Add to the store
    store.addSection(newSection, index);
    
    // Return the new section
    return newSection;
  }
  
  /**
   * Remove a section from the session
   * @param {string} sectionId - ID of the section to remove
   */
  removeSection(sectionId) {
    // Clean up resources associated with this section
    if (this.audioBuffers.has(sectionId)) {
      this.audioBuffers.delete(sectionId);
    }
    
    if (this.audioNodes.has(sectionId)) {
      const node = this.audioNodes.get(sectionId);
      if (node && node.disconnect) {
        node.disconnect();
      }
      this.audioNodes.delete(sectionId);
    }
    
    if (this.visualizers.has(sectionId)) {
      this.visualizers.delete(sectionId);
    }
    
    if (this.bufferCache.has(sectionId)) {
      this.bufferCache.delete(sectionId);
    }
    
    // Remove from store
    store.removeSection(sectionId);
  }
  
  /**
   * Update section properties
   * @param {string} sectionId - ID of the section to update
   * @param {Object} updates - Properties to update
   */
  updateSection(sectionId, updates) {
    const sections = store.get('sections');
    const sectionIndex = sections.findIndex(section => section.id === sectionId);
    
    if (sectionIndex === -1) {
      console.error(`Section with ID ${sectionId} not found`);
      return;
    }
    
    // Update the section in the store
    const updatedSections = [...sections];
    updatedSections[sectionIndex] = {
      ...updatedSections[sectionIndex],
      ...updates
    };
    
    store.set('sections', updatedSections);
  }
  
  /**
   * Set instruments for a section
   * @param {string} sectionId - ID of the section
   * @param {Array} instruments - Array of instrument names
   */
  setInstruments(sectionId, instruments) {
    this.updateSection(sectionId, {
      instruments,
      status: instruments.length > 0 ? 'selected' : 'empty'
    });
  }
  
  /**
   * Sets the decoded AudioBuffer and optionally the Audio URL for a section.
   * This method is called by app.js after audio is generated and decoded.
   * Enhanced to automatically add new sections to playback queue and support mastered audio
   * @param {string} sectionId - ID of the section.
   * @param {AudioBuffer} audioBuffer - The decoded AudioBuffer.
   * @param {string} audioUrl - The object URL for the audio blob.
   */
  setSectionAudio(sectionId, audioBuffer, audioUrl) {
    if (!sectionId || !audioBuffer) {
      console.error("[SectionManager] sectionId and audioBuffer are required for setSectionAudio.");
      return;
    }
    this.audioBuffers.set(sectionId, audioBuffer);
    if (audioUrl) {
      this.audioUrls.set(sectionId, audioUrl); // Store URL if provided
    }
    console.log(`[SectionManager] AudioBuffer set for section ${sectionId}`, { duration: audioBuffer.duration });

    // If continuous playback is active, add this new section to the queue
    if (this.continuousPlaybackActive) {
      // Check if we're currently playing mastered audio
      const playingMastered = continuousPlaybackEngine.sections.length === 1 && 
                            (continuousPlaybackEngine.sections[0].type === 'mastered' ||
                             continuousPlaybackEngine.sections[0].type === 'mastered-with-appendage');
      
      // Determine if we should append to mastered audio
      if (playingMastered && this.autoMixEnabled) {
        console.log(`[SectionManager] Appending newly generated section ${sectionId} to mastered audio`);
        this.addSectionToPlaybackQueue(sectionId, { appendToMastered: true });
        
        // The appendSection method will handle scheduling remastering if needed
      } else {
        // Regular addition to queue
        this.addSectionToPlaybackQueue(sectionId);
        
        // Check if auto-mixing should be triggered
        if (this.autoMixEnabled) {
          // Use setTimeout to avoid blocking the main thread
          setTimeout(() => this.checkAndTriggerAutoMix(), 100);
        }
      }
    }
    // If not in continuous playback but we have >= 2 ready sections, auto-start playback
    else {
      const sections = store.get('sections');
      const readySections = sections.filter(s => s.status === 'ready');
      
      if (readySections.length >= 2) {
        console.log(`[SectionManager] Auto-starting continuous playback with ${readySections.length} sections`);
        // Start continuous playback with a short delay
        setTimeout(() => {
          this.startContinuousPlayback();
          // Check if auto-mixing should be triggered
          if (this.autoMixEnabled) {
            setTimeout(() => this.checkAndTriggerAutoMix(), 500);
          }
        }, 100);
      }
    }
    
    // Also dispatch an event to update the UI for the newly added section
    window.dispatchEvent(new CustomEvent('section-audio-ready', {
      detail: {
        sectionId,
        duration: audioBuffer.duration
      }
    }));
  }
  
  /**
   * Play a specific section
   * @param {string} sectionId - ID of the section to play
   */
  playSection(sectionId) {
    const audioContext = getAudioContext();
    
    // Stop any currently playing audio
    this.stopPlayback();
    
    // Get the audio buffer
    const buffer = this.audioBuffers.get(sectionId);
    if (!buffer) {
      console.error(`No audio buffer found for section ${sectionId}`);
      return;
    }
    
    // Create a source node
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    
    // Create a gain node for volume control
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0;
    
    // Create an analyzer for visualization
    const analyzer = audioContext.createAnalyser();
    analyzer.fftSize = 256;
    
    // Connect nodes
    source.connect(gainNode);
    gainNode.connect(analyzer);
    if (this.analyserNode) {
        gainNode.connect(this.analyserNode);
        this.analyserNode.connect(audioContext.destination);
    } else {
        gainNode.connect(audioContext.destination);
    }
    
    // Store the source node for later cleanup
    this.audioNodes.set(sectionId, source);
    
    // Set up visualizer if we have a canvas element
    const section = store.get('sections').find(s => s.id === sectionId);
    const visualElement = document.getElementById(`visualizer-${sectionId}`);
    if (visualElement && section.visualData) {
      const localAnalyzer = audioContext.createAnalyser(); // Create a local analyser for this specific visualizer
      localAnalyzer.fftSize = 256;
      gainNode.connect(localAnalyzer); // Connect gainNode to this localAnalyzer as well

      const visualizer = createVisualizer({
        canvas: visualElement,
        analyzer: localAnalyzer, // Use the local one
        mode: 'waveform'
      });
      this.visualizers.set(sectionId, visualizer);
      visualizer.start();
    }
    
    // Play the source
    source.start(0);
    
    // Update state
    this.isPlaying = true;
    this.currentSection = sectionId;
    this.startTime = audioContext.currentTime;
    
    // Set up cleanup when playback ends
    source.onended = () => {
      this.stopPlayback();
    };
  }
  
  /**
   * Stop current playback
   */
  stopPlayback() {
    // Stop all playing audio nodes
    this.audioNodes.forEach((node, id) => {
      if (node) {
        try {
          node.stop();
          node.disconnect();
        } catch (error) {
          // Node might already be stopped
        }
      }
    });
    
    // Clear the audio nodes map
    this.audioNodes.clear();
    
    // Stop all visualizers
    this.visualizers.forEach(visualizer => {
      if (visualizer && visualizer.stop) {
        visualizer.stop();
      }
    });
    
    // Clear visualizers
    this.visualizers.clear();
    
    // Reset playback state
    this.isPlaying = false;
    this.currentSection = null;
    
    // Dispatch event for UI components to listen for
    window.dispatchEvent(new CustomEvent('playback-stopped'));
  }
  
  /**
   * Export sections as WAV files for mixing
   * @returns {Promise<Array>} Array of section files with metadata
   */
  async exportSectionsForMixing() {
    console.log("[SectionManager.export] Starting export for mixing...");
    const sections = store.get('sections');
    const sectionFiles = [];
    
    if (!sections || sections.length === 0) {
      console.error("[SectionManager.export] No sections in store to export.");
      throw new Error('No sections to export');
    }
    
    const readySections = sections.filter(section => 
      section.status === 'ready' && this.audioBuffers.has(section.id)
    );
    console.log("[SectionManager.export] Filtered ready sections for export:", readySections.map(s => s.id));
    
    if (readySections.length === 0) {
        console.error("[SectionManager.export] No ready sections with audio found to export for mixing.");
        throw new Error('No ready sections with audio to export for mixing.');
    }
    
    for (const section of readySections) {
      console.log(`[SectionManager.export] Processing section ${section.id} for export.`);
      const audioBuffer = this.audioBuffers.get(section.id);
      if (!audioBuffer) {
        console.warn(`[SectionManager.export] Missing audio buffer for ready section ${section.id}, skipping export for this section.`);
        continue; 
      }
      
      console.log(`[SectionManager.export] Calling audioBufferToWav for section ${section.id}`);
      const sectionBlob = audioBufferToWav(audioBuffer); 
      console.log(`[SectionManager.export] Blob created for section ${section.id}, size: ${sectionBlob.size}`);
      
      const fileName = `section_${section.type}_${section.id}.wav`;
      const file = new File([sectionBlob], fileName, { type: 'audio/wav' });
      console.log(`[SectionManager.export] File object created: ${fileName}`);
      
      sectionFiles.push({
        file,
        id: section.id,
        type: section.type,
        instruments: section.instruments,
        duration: audioBuffer.duration
      });
    }
    
    if (sectionFiles.length === 0) {
        console.error("[SectionManager.export] No section files could be prepared. Check audio buffers and section statuses.");
        throw new Error("No section files could be prepared for export. Check audio buffers.");
    }
    console.log("[SectionManager.export] Successfully prepared section files:", sectionFiles.map(sf => sf.file.name));
    return sectionFiles;
  }
  
  /**
   * Request a direct final mix from the Tonn API using stitched audio
   * @param {Array<Object>} sectionsWithDetails - Array of section detail objects (for metadata)
   * @param {string} genre - The genre for the mix
   * @param {string} stitchedAudioPath - Path to the stitched audio file on the server
   * @returns {Promise<Object>} Final mix result
   */
  async requestDirectFinalMix(sectionsWithDetails, genre, stitchedAudioPath) {
    console.log("[SectionManager] Requesting direct final master with stitched audio:", stitchedAudioPath);
    
    // Validate input - make sure we have a path
    if (!stitchedAudioPath) {
      console.error("[SectionManager] Missing stitched audio path for mastering");
      throw new Error("Stitched audio path is required for direct mastering");
    }
    
    // Generate a unique request ID for tracking this request in logs
    const requestId = `master-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    try {
      // Start timing the request
      const startTime = performance.now();
      
      // Create payload including the stitched audio path
      const payload = { 
        sections: sectionsWithDetails, 
        genre: genre,
        stitchedAudioPath: stitchedAudioPath,
        skipPreview: true,
        requestId: requestId
      };
      
      console.log(`[SectionManager] Mastering request ${requestId} payload:`, payload);
      
      // Call the API to create a direct master
      const apiBaseUrl = api.getApiBaseUrl ? api.getApiBaseUrl() : null;
      if (!apiBaseUrl) {
        throw new Error("API base URL unavailable, cannot request professional mastering");
      }
      
      // Set up a timeout in case the request takes too long
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      try {
        const response = await fetch(`${apiBaseUrl}/create-direct-mix`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        const endTime = performance.now();
        console.log(`[SectionManager] Mastering request ${requestId} completed in ${(endTime - startTime).toFixed(1)}ms with status ${response.status}`);
        
        // Store timing data for analytics
        this.lastMasteringRequestTime = endTime - startTime;
        this.lastMasteringRequestStatus = response.status;
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ detail: response.statusText }));
          console.error(`[SectionManager] Error creating mastering task (${requestId}):`, errorData);
          
          // Check for specific error types
          const errorDetail = errorData.detail || '';
          const isWebhookError = errorDetail.includes('429') || errorDetail.includes('webhook');
          
          if (isWebhookError) {
            console.log(`[SectionManager] Webhook error detected. Server should retry without webhooks.`);
          }
          
          throw new Error(errorData.detail || `HTTP error ${response.status}`);
        }
        
        const responseData = await response.json();
        console.log(`[SectionManager] Mastering task ${requestId} initiated successfully:`, responseData);
        
        // Dispatch UI update event
        window.dispatchEvent(new CustomEvent('mastering-requested', {
          detail: {
            requestId: requestId,
            taskId: responseData.task_id,
            status: responseData.status
          }
        }));
        
        return responseData;
      } catch (fetchError) {
        clearTimeout(timeoutId);
        
        // Check if it was a timeout
        if (fetchError.name === 'AbortError') {
          console.error(`[SectionManager] Mastering request ${requestId} timed out after 30 seconds`);
          throw new Error(`Mastering request timed out after 30 seconds`);
        }
        
        throw fetchError;
      }
    } catch (error) {
      console.error(`[SectionManager] Error requesting mastering (${requestId}):`, error);
      
      // Important: don't throw here to allow playback to continue even if professional mastering fails
      return { 
        error: error.message, 
        status: 'ERROR',
        requestId: requestId,
        message: "Mastering request failed, but continuous playback will continue with locally stitched audio."
      };
    }
  }
  
  /**
   * Request a preview mix from the Tonn API
   * @param {Array<Object>} sectionsWithDetails - Array of section detail objects
   * @param {string} genre - The genre for the mix
   * @returns {Promise<Object>} Preview mix result
   */
  async requestTonnPreviewMix(sectionsWithDetails, genre) {
    console.log("[SectionManager] Requesting Tonn preview mix with sections:", sectionsWithDetails);
    
    try {
      // Call the API to create a preview mix
      const previewResult = await api.createPreviewMix(sectionsWithDetails, genre);
      
      if (!previewResult || !previewResult.task_id) {
        throw new Error("Invalid response from Tonn API preview mix request");
      }
      
      console.log("[SectionManager] Tonn preview mix requested successfully:", previewResult);
      
      return previewResult;
    } catch (error) {
      console.error("[SectionManager] Error requesting Tonn preview mix:", error);
      throw error;
    }
  }
  
  /**
   * Load mixed audio from URL and schedule it for playback at the next loop boundary
   * Enhanced to support better transitions between audio sources
   * @param {string} url - The URL to download the mixed audio
   * @param {string} taskId - The Tonn task ID
   * @param {Object} options - Additional options
   * @param {string} options.mixType - Type of mix ('preview', 'final', 'direct', 'mastered')
   * @param {boolean} options.immediate - Whether to transition immediately
   */
  async loadMixedAudio(url, taskId, options = {}) {
    console.log(`[SectionManager] Loading audio from ${url} (type: ${options.mixType || 'unknown'}, taskId: ${taskId})`);
    
    // For mastered audio, always force transition at loop boundaries
    if (options.mixType === 'mastered') {
      options.immediate = false;
    }
    
    // Ensure URL is properly resolved if it's a relative path
    let resolvedUrl = url;
    
    // Determine if this is an external URL that might have CORS issues
    const isExternalUrl = url.startsWith('https://storage.googleapis.com/') || 
                         url.startsWith('https://tonn.roexaudio.com/') ||
                         (url.startsWith('http') && !url.includes(window.location.hostname));
    
    // For mastered audio or other external URLs, use the proxy endpoint to avoid CORS issues
    if (isExternalUrl && options.mixType === 'mastered') {
      const apiBaseUrl = api.getApiBaseUrl();
      resolvedUrl = `${apiBaseUrl}/proxy-audio?url=${encodeURIComponent(url)}`;
      console.log(`[SectionManager] Using proxy for external URL to avoid CORS: ${resolvedUrl}`);
    } else if (api.resolveApiUrl && !url.startsWith('http')) {
      resolvedUrl = api.resolveApiUrl(url);
      console.log(`[SectionManager] Resolved URL: ${resolvedUrl}`);
    }
    
    try {
      // Implement retry logic for more resilient audio fetching
      let retries = 0;
      const maxRetries = 3;
      let response;
      
      while (retries < maxRetries) {
        try {
          response = await fetch(resolvedUrl, {
            // Avoid cache for mastered files
            cache: options.mixType === 'mastered' ? 'no-cache' : 'default',
            headers: {
              'Cache-Control': options.mixType === 'mastered' ? 'no-cache' : 'default'
            }
          });
          
          if (response.ok) break;
          
          console.warn(`[SectionManager] Failed to fetch audio (attempt ${retries + 1}/${maxRetries}): ${response.status} ${response.statusText}`);
          
          // If we got a 404 or 500+ error on the proxy and we're not already using it, try the proxy
          if ((response.status === 404 || response.status >= 500) && 
              !resolvedUrl.includes('/proxy-audio') && 
              isExternalUrl) {
            console.log(`[SectionManager] Error with direct fetch, trying proxy as fallback`);
            const apiBaseUrl = api.getApiBaseUrl();
            resolvedUrl = `${apiBaseUrl}/proxy-audio?url=${encodeURIComponent(url)}`;
            retries++; // Still count this as a retry
            continue; // Try again with proxy
          }
          
          retries++;
          await new Promise(resolve => setTimeout(resolve, 1000 * retries)); // Exponential backoff
        } catch (fetchError) {
          console.warn(`[SectionManager] Network error fetching audio (attempt ${retries + 1}/${maxRetries}): ${fetchError.message}`);
          
          // If fetch failed completely and we're not already using proxy, try it
          if (!resolvedUrl.includes('/proxy-audio') && isExternalUrl) {
            console.log(`[SectionManager] Fetch failed, trying proxy as fallback`);
            const apiBaseUrl = api.getApiBaseUrl();
            resolvedUrl = `${apiBaseUrl}/proxy-audio?url=${encodeURIComponent(url)}`;
            retries++; // Still count this as a retry
            continue; // Try again with proxy
          }
          
          retries++;
          if (retries >= maxRetries) throw fetchError;
          await new Promise(resolve => setTimeout(resolve, 1000 * retries)); // Exponential backoff
        }
      }
      
      if (!response || !response.ok) {
        throw new Error(`Failed to fetch audio: ${response ? `${response.status} ${response.statusText}` : 'No response'}`);
      }
      
      const audioData = await response.arrayBuffer();
      if (!audioData || audioData.byteLength < 1000) {
        throw new Error(`Received empty or too small audio data: ${audioData ? audioData.byteLength : 0} bytes`);
      }
      
      console.log(`[SectionManager] Successfully fetched audio data: ${audioData.byteLength} bytes`);
      
      const audioContext = getAudioContext();
      const audioBuffer = await audioContext.decodeAudioData(audioData);
      
      console.log(`[SectionManager] Successfully decoded audio: ${audioBuffer.duration}s, type: ${options.mixType || 'unknown'}`);
      
      // Determine if this is from mastering workflow
      const isMastered = options.mixType === 'mastered';
      
      // Store the audio buffer based on its type
      if (isMastered) {
        this.masteredBuffer = audioBuffer;
      this.mixData = {
          ...this.mixData,
          masteredBuffer: audioBuffer,
          downloadUrl: url,
          mixType: 'mastered',
          taskId: taskId // Store the task ID
        };
      } else {
        // Regular mixing workflow
        this.tonnMixedBuffer = audioBuffer;
        this.mixData = {
          ...this.mixData,
          tonnMixedBuffer: audioBuffer,
          downloadUrl: url,
          mixType: options.mixType || 'unknown',
          taskId: taskId // Store the task ID
        };
      }
      
      // If continuous playback is active, schedule transition to mixed version
      if (this.continuousPlaybackActive && continuousPlaybackEngine) {
        // Determine if we should transition immediately
        const immediate = options.immediate === true || 
                          options.mixType === 'final' || 
                          options.mixType === 'mastered';
        
        // Schedule the mixed buffer to play at the next appropriate point
        continuousPlaybackEngine.scheduleMixTransition(audioBuffer, {
          type: options.mixType || 'unknown',
          immediate: immediate,
          taskId: taskId // Pass the task ID for tracking
        });
        
        console.log(`[SectionManager] Scheduled transition to audio (${options.mixType || 'unknown'}) with immediate=${immediate}, taskId=${taskId}`);
      } else {
        // Make mixed audio available for immediate playback if not in continuous mode
        console.log("[SectionManager] Audio ready for direct playback (not in continuous mode)");
      }
      
      // Update UI with final mix data
      window.dispatchEvent(new CustomEvent('mix-status-update', {
        detail: {
          status: isMastered ? 'tonn_mastering_completed' : 'tonn_mix_ready',
          progress: 100, 
          tonnTaskId: taskId,
          downloadUrl: url,
          mixType: options.mixType || 'unknown'
        }
      }));
      
      return audioBuffer;
    } catch (error) {
      console.error("[SectionManager] Error loading audio:", error);
      
      // Don't throw - this allows continuous playback to continue even if professional audio fails
      window.dispatchEvent(new CustomEvent('mix-status-update', { 
        detail: {
          status: 'tonn_error',
          progress: 0,
          error: error.message,
          message: `Error loading professional audio: ${error.message}. Continuing with local audio.`
        }
      }));
      
      return null;
    }
  }
  
  /**
   * Poll for Tonn mix status until complete
   * Enhanced to handle mastered audio transitions properly
   * @param {string} taskId - The Tonn task ID
   */
  async pollTonnMixStatus(taskId) {
    console.log(`[SectionManager] Starting to poll Tonn task status for task ${taskId}`);
    
    try {
      const result = await api.pollMixStatusUntilComplete(taskId, {
        onProgress: (status) => {
          console.log(`[SectionManager] Tonn task progress update:`, status);
          
          // Update the UI with task status
          store.set('currentMixStatus', {
            status: status.type === 'mastering' ? 'tonn_mastering' : 'tonn_mixing',
            progress: status.progress || 85,
            message: `Professional audio processing in progress: ${status.status}`,
            tonnTaskId: taskId
          });
          
      // Dispatch event for UI update
          window.dispatchEvent(new CustomEvent('mix-status-update', {
            detail: { 
              status: status.type === 'mastering' ? 'tonn_mastering' : 'tonn_mixing',
              progress: status.progress || 85,
              tonnTaskId: taskId,
              tonnStatus: status.status
            }
          }));
        }
      });
      
      console.log(`[SectionManager] Tonn task completed for task ${taskId}:`, result);
      
      if (result.status === 'COMPLETED' || result.status === 'completed') {
        // Check if this task is still relevant - but don't skip UI updates even if not
        const isCurrentPendingTask = this.pendingMasterTask === taskId;
        
        if (!isCurrentPendingTask) {
          console.log(`[SectionManager] Task ${taskId} completed but is no longer the pending task`);
          // Instead of skipping, we'll still update UI but might skip audio transitions
        }
        
        // Determine if this is a mixing or mastering task
        const isMastering = result.download_url && 
                           (result.download_url.includes('mastered') || 
                            result.type === 'mastering');
        
        const isPreviewMix = result.download_url && result.download_url.includes('preview') && !isMastering;
        const isDirectFinalMix = result.type === 'direct_final' && !isMastering;
        
        if (isMastering) {
          console.log(`[SectionManager] Mastering task completed. Download URL: ${result.download_url}`);
          
          // Update UI even if this isn't the current pending task
          store.set('currentMixStatus', {
            status: 'tonn_mastering_completed',
            progress: 100,
            message: 'Professional mastering completed successfully!',
            tonnTaskId: taskId,
            downloadUrl: result.download_url
          });
          
          // Dispatch completed event for UI update
          window.dispatchEvent(new CustomEvent('mix-status-update', { 
            detail: {
              status: 'tonn_mastering_completed',
              progress: 100,
              tonnTaskId: taskId,
              downloadUrl: result.download_url,
              mixType: 'mastered'
            }
          }));
          
          // Only proceed with audio transition if this is still the pending task
          // or if we don't have a pending task (fall back to this one)
          if (isCurrentPendingTask || !this.pendingMasterTask) {
            // Reset remastering state
            this.remasteringInProgress = false;
            
            // If we have an audio player currently playing the same audio, don't interrupt it
            if (this.elements && this.elements.audioPlayer && 
                this.elements.audioPlayer.src && 
                this.elements.audioPlayer.src.includes(taskId)) {
              console.log(`[SectionManager] Audio player already playing this mastered audio, not loading again`);
              return;
            }
            
            // Load and transition to mastered audio with immediate flag for faster transition
            await this.loadMixedAudio(
              result.download_url, 
              taskId, 
              { 
                mixType: 'mastered',
                immediate: false  // Set to false to ensure transition at loop boundary
              }
            );
          }
        } else if (isPreviewMix) {
          // Preview mix completed - similar to existing code
          console.log(`[SectionManager] Preview mix completed. Creating final mix with task ID: ${taskId}`);
          
          // (existing preview mix handling code...)
        } else {
          // Final mix is complete - similar to existing code 
          // (existing final mix handling code...)
        }
      }
      
      // If the task is still in progress, we'll let the polling continue
    } catch (error) {
      console.error(`[SectionManager] Error polling Tonn task status for task ${taskId}:`, error);
      
      // Reset remastering state on error
      if (this.pendingMasterTask === taskId) {
        this.remasteringInProgress = false;
      }
      
      // If we fail polling, try one more direct check for mastering task
      try {
        console.log(`[SectionManager] Attempting direct mastering status check for task ${taskId}`);
        await this.checkMasteringStatusDirectly(taskId);
      } catch (masteringCheckError) {
        console.error(`[SectionManager] Error in direct mastering check:`, masteringCheckError);
      }
    }
  }
  
  /**
   * Special method to check mastering status directly using extended API techniques
   * This is used as a fallback when normal polling fails
   * @param {string} taskId - The mastering task ID
   */
  async checkMasteringStatusDirectly(taskId) {
    if (!taskId) return;
    
    console.log(`[SectionManager] Performing direct mastering status check for task ${taskId}`);
    
    try {
      // First try to directly check the status via our own api endpoint
      const statusResponse = await fetch(`${api.getApiBaseUrl()}/mix-status/${taskId}`, {
        headers: {
          'Cache-Control': 'no-cache', // Bypass cache for fresh result
          'X-Request-Source': 'client-fallback' // Custom header to identify this request
        }
      });
      
      if (!statusResponse.ok) {
        console.warn(`[SectionManager] Direct status check failed: ${statusResponse.status}`);
        return this.handleMasteringFallback(taskId);
      }
      
      const statusData = await statusResponse.json();
      console.log(`[SectionManager] Direct status check response:`, statusData);
      
      if (statusData.status === 'COMPLETED' && statusData.download_url) {
        console.log(`[SectionManager] Found completed mastering task via direct check: ${statusData.download_url}`);
        
        try {
          // Try to get the audio via proxy to avoid CORS issues
          const apiBaseUrl = api.getApiBaseUrl();
          const proxiedUrl = `${apiBaseUrl}/proxy-audio?url=${encodeURIComponent(statusData.download_url)}`;
          
          // Update UI to show we're trying to fetch the mastered audio
          store.set('currentMixStatus', {
            status: 'tonn_mastering_completed',
            progress: 95,
            message: 'Professional mastering completed! Retrieving audio...',
            tonnTaskId: taskId,
            downloadUrl: statusData.download_url
          });
          
          console.log(`[SectionManager] Attempting to load mastered audio via proxy: ${proxiedUrl}`);
          
          // Attempt to load the audio
          const audioResponse = await fetch(proxiedUrl);
          
          if (!audioResponse.ok) {
            console.warn(`[SectionManager] Failed to load mastered audio via proxy: ${audioResponse.status}`);
            return this.handleMasteringFallback(taskId);
          }
          
          const audioData = await audioResponse.arrayBuffer();
          
          if (!audioData || audioData.byteLength < 1000) {
            console.warn(`[SectionManager] Received empty or too small audio data: ${audioData ? audioData.byteLength : 0} bytes`);
            return this.handleMasteringFallback(taskId);
          }
          
          const audioContext = getAudioContext();
          const audioBuffer = await audioContext.decodeAudioData(audioData);
          
          console.log(`[SectionManager] Successfully loaded mastered audio: ${audioBuffer.duration}s`);
          
          // Update UI
          store.set('currentMixStatus', {
            status: 'tonn_mastering_completed',
            progress: 100,
            message: 'Professional mastering completed! (found via direct check)',
            tonnTaskId: taskId,
            downloadUrl: statusData.download_url
          });
          
          // Dispatch an event
      window.dispatchEvent(new CustomEvent('mix-status-update', { 
            detail: {
              status: 'tonn_mastering_completed',
              progress: 100,
              tonnTaskId: taskId,
              downloadUrl: statusData.download_url,
              mixType: 'mastered'
            }
          }));
          
          // Load and transition to mastered audio
          if (this.continuousPlaybackActive && continuousPlaybackEngine) {
            continuousPlaybackEngine.scheduleMixTransition(audioBuffer, {
              type: 'mastered',
              immediate: true,
              taskId: taskId
            });
            
            console.log(`[SectionManager] Scheduled transition to mastered audio via direct check`);
          }
          
          return true;
        } catch (audioError) {
          console.error(`[SectionManager] Error loading mastered audio:`, audioError);
          return this.handleMasteringFallback(taskId);
        }
      }
      
      return this.handleMasteringFallback(taskId);
    } catch (error) {
      console.error(`[SectionManager] Error in direct mastering status check:`, error);
      return this.handleMasteringFallback(taskId);
    }
  }
  
  /**
   * Handle fallback when mastered audio can't be loaded
   * Ensures continuous playback continues with the best available audio
   * @param {string} taskId - The mastering task ID
   */
  async handleMasteringFallback(taskId) {
    console.log(`[SectionManager] Using fallback for mastering task ${taskId}`);
    
    // Update UI to show mastering issue but continue with local audio
    store.set('currentMixStatus', {
      status: 'tonn_error', 
      progress: 100,
      message: 'Mastered audio unavailable, continuing with local stitched mix.',
      tonnTaskId: taskId
    });
    
    // Dispatch event for UI update
    window.dispatchEvent(new CustomEvent('mix-status-update', {
      detail: {
        status: 'tonn_error',
        progress: 100,
        tonnTaskId: taskId,
        error: 'Could not load mastered audio due to CORS or network issues',
        message: 'Mastered audio unavailable, continuing with local mix.'
      }
    }));
    
    // If we have a stitched mix already, ensure it's playing
    if (this.stitchedMixBuffer && this.continuousPlaybackActive) {
      console.log(`[SectionManager] Ensuring stitched mix continues playing as fallback`);
      
      // Continue with the stitched mix instead
      const continuingWithLocal = true;
      
      // No need to swap buffers if we're already playing it, but ensure it's noted
      if (continuingWithLocal) {
        // Let's trigger another UI update to show we're continuing
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('continuous-playback-info', {
            detail: {
              message: 'Continuing with local stitched mix',
              type: 'info'
            }
          }));
        }, 2000);
      }
    }
    
    return false;
  }
  
  /**
   * Check if auto-mixing should be triggered and do so if conditions are met
   * Updated to use streamlined mixing approach
   */
  checkAndTriggerAutoMix() {
    if (!this.autoMixEnabled) {
      console.log("[SectionManager] Auto-mixing is disabled, skipping");
      return;
    }
    
    if (this.mixingInProgress) {
      console.log("[SectionManager] Mix already in progress, skipping auto-mix");
      return;
    }
    
    const now = Date.now();
    if (now - this.lastMixTriggeredAt < this.mixCooldownPeriod) {
      console.log("[SectionManager] Auto-mix cooldown period not elapsed, skipping");
      return;
    }
    
    const sections = store.get('sections');
    const readySections = sections.filter(section => 
      section.status === 'ready' && this.audioBuffers.has(section.id)
    );
    
    if (readySections.length < 2) {
      console.log("[SectionManager] Not enough ready sections for auto-mixing");
      return;
    }
    
    console.log("[SectionManager] Auto-triggering mix creation");
    this.lastMixTriggeredAt = now;
    
    // Also dispatch an event to update the UI about auto-mixing
    window.dispatchEvent(new CustomEvent('auto-mix-triggered', {
      detail: {
        timestamp: now,
        sectionCount: readySections.length
      }
    }));
    
    // Create the mix in background using the streamlined approach
    // Use a promise with timeout to ensure it doesn't block
    const mixPromise = new Promise((resolve, reject) => {
      // Set a timeout to abort if it takes too long
      const timeoutId = setTimeout(() => {
        console.log("[SectionManager] Auto-mix creation timed out, continuing with playback");
        resolve({ status: 'timeout', message: 'Mix creation timed out' });
      }, 30000); // 30 second timeout
      
      // Start the mix creation
      this.createSectionMix({ skipPreviewStep: true })
        .then(mixData => {
          clearTimeout(timeoutId);
          console.log("[SectionManager] Auto-mix completed successfully:", mixData);
          resolve(mixData);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          console.error("[SectionManager] Auto-mix creation failed:", error);
          // Resolve with error rather than rejecting to keep the promise chain going
          resolve({ status: 'error', error: error.message });
        });
    });
    
    // Don't await the promise - let it run in the background
    mixPromise.then(() => {
      // Playback will be handled by the createSectionMix method
    }).catch(error => {
      // This should never occur since we resolve with error above
      console.error("[SectionManager] Unexpected error in auto-mix promise:", error);
    });
    
    return mixPromise;
  }
  
  /**
   * Calculates the crossfade duration in milliseconds.
   * Enhanced to create smoother transitions with more overlap
   * @returns {number} Crossfade duration in milliseconds.
   */
  getCrossfadeDurationMs() {
    const sessionBPM = store.get('bpm') || 120;
    const beatsToOverlap = 2; // Increased from 1 to 2 beats for smoother transitions
    
    // Duration of one beat in milliseconds: (60 / BPM) * 1000
    const beatDurationMs = (60 / sessionBPM) * 1000;
    const overlapMs = beatsToOverlap * beatDurationMs; // BPM-dependent overlap
    
    console.log(`[SectionManager] BPM: ${sessionBPM}, Beat Duration: ${beatDurationMs.toFixed(0)}ms, Overlap: ${overlapMs.toFixed(0)}ms for ${beatsToOverlap} beats`);
    
    // Ensure a minimum of 300ms regardless of BPM for better transitions
    return Math.max(300, overlapMs);
  }
  
  /**
   * Organize and connect sections for a coherent mix
   * @param {Array} sectionFiles - Array of section files to be organized
   */
  organizeAndConnectSections(sectionFiles) {
    console.log("Organizing and connecting sections...");
    
    // Sort sections by their natural order in the composition
    const sections = store.get('sections');
    sectionFiles.sort((a, b) => {
      const aIndex = sections.findIndex(s => s.id === a.id);
      const bIndex = sections.findIndex(s => s.id === b.id);
      return aIndex - bIndex;
    });
    
    // Log the section order to help with debugging
    console.log("Section order for mixing:", 
      sectionFiles.map(sf => {
        const section = sections.find(s => s.id === sf.id);
        return `${section.type} (${sf.instruments.join(', ')})`;
      })
    );
    
    // Add metadata about connections for the mixer
    sectionFiles.forEach((sectionFile, index) => {
      // Add connection metadata
      sectionFile.isFirst = index === 0;
      sectionFile.isLast = index === sectionFiles.length - 1;
      
      // Find the original section
      const section = sections.find(s => s.id === sectionFile.id);
      
      // Add transition metadata based on section type
      if (section) {
        sectionFile.role = section.type;
        
        // Determine transition type
        if (section.type === 'intro') {
          sectionFile.transitionIn = 'fade-in';
          sectionFile.transitionOut = 'crossfade';
        } else if (section.type === 'outro') {
          sectionFile.transitionIn = 'crossfade';
          sectionFile.transitionOut = 'fade-out';
        } else if (section.type === 'chorus') {
          sectionFile.transitionIn = 'build-up';
          sectionFile.transitionOut = 'drop-down';
        } else {
          sectionFile.transitionIn = 'crossfade';
          sectionFile.transitionOut = 'crossfade';
        }
        
        // Set crossfade duration based on BPM
        const bpm = section.bpm || store.get('bpm') || 120;
        const beatsPerSecond = bpm / 60;
        // Calculate a 2-beat crossfade by default
        sectionFile.crossfadeDuration = 2 / beatsPerSecond;
      }
    });
    
    return sectionFiles;
  }
  
  /**
   * Poll for mix status until complete
   * @param {string} taskId - The task ID to check
   * @returns {Promise<Object>} The final mix status
   */
  async pollMixStatus(taskId) {
    try {
      const status = await api.checkMixStatus(taskId);
      
      // Update the mix data
      this.mixData = {
        ...this.mixData,
        status: status.status,
        progress: status.progress,
        downloadUrl: status.download_url
      };
      
      // Event for UI updates
      const event = new CustomEvent('mix-status-update', {
        detail: this.mixData
      });
      window.dispatchEvent(event);
      
      // If mix is still processing, poll again
      if (status.status === 'processing' || status.status === 'starting') {
        setTimeout(() => this.pollMixStatus(taskId), 2000);
        return null;
      }
      
      // Mix is done (either completed or failed)
      this.mixingInProgress = false;
      
      return this.mixData;
    } catch (error) {
      console.error('Error polling mix status:', error);
      this.mixingInProgress = false;
      
      this.mixData = {
        ...this.mixData,
        status: 'error',
        error: error.message
      };
      
      // Event for UI updates
      const event = new CustomEvent('mix-status-update', {
        detail: this.mixData
      });
      window.dispatchEvent(event);
      
      return this.mixData;
    }
  }
  
  /**
   * Get all available section types
   * @returns {Array} Array of section types
   */
  getSectionTypes() {
    return getSectionTypes();
  }
  
  /**
   * Play multiple sections in sequence
   * @param {Array} sectionIds - Array of section IDs to play in sequence
   */
  async playSequence(sectionIds, eventCallback) {
    if (!sectionIds || sectionIds.length === 0) {
      console.error('[SectionManager.playSequence] No sections to play');
      if(eventCallback) eventCallback('error', { message: 'No sections to play' });
      return;
    }

    this.stopPlayback(); // Stop any current playback
    
    const audioContext = getAudioContext();
    if (!audioContext) {
        console.error("[SectionManager.playSequence] AudioContext not available.");
        if(eventCallback) eventCallback('error', { message: 'AudioContext not available' });
        return;
    }
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }
    
    let currentTime = audioContext.currentTime + 0.1; // Add a small delay to ensure context is ready
    const masterGain = audioContext.createGain();
    if (this.analyserNode) {
        masterGain.connect(this.analyserNode);
    } else {
        masterGain.connect(audioContext.destination);
    }
    
    console.log(`[SectionManager.playSequence] Preparing to play ${sectionIds.length} sections sequentially.`);
    if(eventCallback) eventCallback('playback_started');

    let playingSourcesCount = 0;
    const totalSectionsToAttempt = sectionIds.length;
    let sectionsSuccessfullyScheduled = 0;

    const crossfadeMs = this.getCrossfadeDurationMs(); // Use the consistent method
    const crossfadeSecs = crossfadeMs / 1000;
    console.log(`[SectionManager.playSequence] Crossfade duration: ${crossfadeSecs.toFixed(2)}s (${crossfadeMs}ms)`);

    for (let i = 0; i < sectionIds.length; i++) {
      const sectionId = sectionIds[i];
      const buffer = this.audioBuffers.get(sectionId);
      
      if (!buffer) {
        console.warn(`[SectionManager.playSequence] No audio buffer for section ${sectionId}, skipping.`);
        if (i === totalSectionsToAttempt - 1 && playingSourcesCount === 0 && sectionsSuccessfullyScheduled === 0) {
             // If this was the last one and nothing else was scheduled or is playing
            if(eventCallback) eventCallback('playback_ended');
        }
        continue;
      }
      
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      
      const gainNode = audioContext.createGain();
      gainNode.connect(masterGain);

      const duration = buffer.duration;
      const startTimeInSequence = currentTime;

      // Fade logic
      gainNode.gain.setValueAtTime(0, startTimeInSequence); // Start silent
      // Fade in over `crossfadeSecs` or half duration if section is too short.
      const fadeInDuration = Math.min(crossfadeSecs, duration / 2);
      gainNode.gain.linearRampToValueAtTime(1, startTimeInSequence + fadeInDuration);

      // Schedule fade out
      // Ensure fade-out starts `crossfadeSecs` before the end of the sound, but not before fade-in completes.
      const fadeOutStartTime = Math.max(startTimeInSequence + fadeInDuration, startTimeInSequence + duration - crossfadeSecs);
      
      // If the section is shorter than the crossfade, it will effectively just fade in and out quickly.
      // Or if it's shorter than twice the crossfade, the fade out might start very early.
      gainNode.gain.setValueAtTime(1, fadeOutStartTime); // Hold full volume until fade out
      gainNode.gain.linearRampToValueAtTime(0, startTimeInSequence + duration); // Fade out completely by the end of the buffer duration

      source.connect(gainNode);
      source.start(startTimeInSequence);
      playingSourcesCount++;
      sectionsSuccessfullyScheduled++;
      console.log(`[SectionManager.playSequence] Scheduled section ${i+1} (${sectionId}) to start at ${startTimeInSequence.toFixed(2)}s, duration ${duration.toFixed(2)}s`);

      source.onended = () => {
        playingSourcesCount--;
        console.log(`[SectionManager.playSequence] Section ${sectionId} ended. Remaining sources: ${playingSourcesCount}`);
        source.disconnect();
        gainNode.disconnect();
        if (playingSourcesCount === 0) {
          console.log("[SectionManager.playSequence] All scheduled sections have finished playing.");
          if(eventCallback) eventCallback('playback_ended');
          this.isPlaying = false; // Update internal playing state
          this.currentSection = null;
        }
      };
      
      // Advance currentTime for the next section, considering overlap for crossfade
      if (i < sectionIds.length - 1) {
          currentTime += (duration - crossfadeSecs); // Start next section `crossfadeSecs` before current one ends
      } else {
          currentTime += duration; // Last section plays out fully
      }
      // Ensure currentTime doesn't go backward if duration is shorter than crossfade
      if (duration < crossfadeSecs && i < sectionIds.length -1) {
          currentTime = startTimeInSequence + crossfadeSecs; // at least ensure next starts after this one's fade in completes
      }

      if(eventCallback && typeof eventCallback === 'function') eventCallback('section_changed', { currentSectionId: sectionId, currentIndex: i, nextStartTime: currentTime });

    }
    
    if (sectionsSuccessfullyScheduled > 0) {
        this.isPlaying = true; // Update internal playing state
    } else {
        console.warn("[SectionManager.playSequence] No sections were successfully scheduled.");
        if(eventCallback) eventCallback('playback_ended'); // Nothing to play
    }
  }

  /**
   * Start continuous playback of all ready sections
   * @param {Object} options - Configuration options
   * @param {Function} eventCallback - Optional callback for playback events
   */
  startContinuousPlayback(options = {}, eventCallback) {
    console.log("[SectionManager] Starting continuous playback");
    
    const sections = store.get('sections');
    const readySections = sections.filter(section => 
      section.status === 'ready' && this.audioBuffers.has(section.id)
    );
    
    if (readySections.length === 0) {
      console.warn("[SectionManager] No ready sections with audio buffers found for continuous playback");
      if (eventCallback) eventCallback('error', { message: 'No ready sections available' });
      return false;
    }
    
    // Prepare sections for the continuous playback engine
    const sectionData = readySections.map(section => ({
      id: section.id,
      buffer: this.audioBuffers.get(section.id),
      type: section.type
    }));
    
    // Get session BPM for crossfade timing
    const bpm = store.get('bpm') || 120;
    
    // Configure the continuous playback engine
    continuousPlaybackEngine
      .setSections(sectionData)
      .setCrossfadeDuration(bpm)
      .onLoop(loopCount => this.handleLoopComplete(loopCount, eventCallback))
      .onSectionChange((index, id) => this.handleSectionChange(index, id, eventCallback))
      .start();
    
    this.isPlaying = true;
    this.continuousPlaybackActive = true;
    
    if (eventCallback) eventCallback('continuous_playback_started');
    
    return true;
  }
  
  /**
   * Stop continuous playback
   */
  stopContinuousPlayback() {
    if (!this.continuousPlaybackActive) return;
    
    console.log("[SectionManager] Stopping continuous playback");
    
    continuousPlaybackEngine.stop();
    
    this.isPlaying = false;
    this.continuousPlaybackActive = false;
    
    // Dispatch event for UI components to listen for
    window.dispatchEvent(new CustomEvent('playback-stopped'));
  }
  
  /**
   * Handle loop completion event
   * @param {number} loopCount - Number of completed loops
   * @param {Function} eventCallback - Optional callback for events
   */
  handleLoopComplete(loopCount, eventCallback) {
    console.log(`[SectionManager] Loop ${loopCount} completed`);
    
    if (eventCallback) eventCallback('loop_completed', { loopCount });
    
    // Check if a mix should be triggered at loop boundary
    if (this.autoMixEnabled && loopCount > 0 && loopCount % 2 === 0) {
      this.checkAndTriggerAutoMix();
    }
  }
  
  /**
   * Handle section change event
   * @param {number} index - Index of the current section
   * @param {string} id - ID of the current section
   * @param {Function} eventCallback - Optional callback for events
   */
  handleSectionChange(index, id, eventCallback) {
    console.log(`[SectionManager] Section changed to index ${index}, id ${id}`);
    
    this.currentSection = id;
    
    if (eventCallback) eventCallback('section_changed', { 
      currentSectionId: id,
      currentIndex: index
    });
  }
  
  /**
   * Toggle continuous playback on/off
   * @param {Object} options - Configuration options
   * @param {Function} eventCallback - Optional callback for playback events
   * @returns {boolean} New playback state
   */
  toggleContinuousPlayback(options = {}, eventCallback) {
    if (this.continuousPlaybackActive) {
      this.stopContinuousPlayback();
      return false;
    } else {
      return this.startContinuousPlayback(options, eventCallback);
    }
  }
  
  /**
   * Add a section to the continuous playback queue if it's already running
   * @param {string} sectionId - ID of the section to add
   */
  addSectionToPlaybackQueue(sectionId) {
    if (!this.continuousPlaybackActive || !sectionId) return;
    
    const section = store.get('sections').find(s => s.id === sectionId);
    if (!section || section.status !== 'ready' || !this.audioBuffers.has(sectionId)) {
      console.warn(`[SectionManager] Cannot add section ${sectionId} to playback: not ready or no audio buffer`);
      return;
    }
    
    // Get current sections from engine
    const currentSections = continuousPlaybackEngine.sections;
    
    // Add the new section
    const updatedSections = [
      ...currentSections,
      {
        id: sectionId,
        buffer: this.audioBuffers.get(sectionId),
        type: section.type
      }
    ];
    
    // Hot swap content at next loop boundary
    continuousPlaybackEngine.hotSwapContent(updatedSections);
    console.log(`[SectionManager] Added section ${sectionId} to continuous playback queue`);
  }
  
  /**
   * Get the current audio level from continuous playback engine if active,
   * otherwise from the regular analyser
   * @returns {number} Audio level from 0-100, or 0 if not available.
   */
  getAudioLevel() {
    if (this.continuousPlaybackActive) {
      return continuousPlaybackEngine.getAudioLevel();
    }
    
    if (!this.analyserNode || !this.analyserDataArray || !this.isPlaying) {
      return 0;
    }
    
    this.analyserNode.getByteFrequencyData(this.analyserDataArray);
    
    let sum = 0;
    for (let i = 0; i < this.analyserDataArray.length; i++) {
      sum += this.analyserDataArray[i];
    }
    const average = sum / this.analyserDataArray.length;
    // Scale average (0-255) to 0-100
    const scaledLevel = Math.min(100, Math.max(0, (average / 255) * 100 * 1.5)); // Boost a bit for visibility
    return Math.round(scaledLevel);
  }

  /**
   * Create a mix from all sections
   * Enhanced to directly send stitched audio to Tonn API when possible
   * @param {Object} options - Optional mixing parameters
   * @param {boolean} options.skipPreviewStep - If true, attempt to skip the preview step
   * @returns {Promise<Object>} Mix data including task ID and status
   */
  async createSectionMix(options = { skipPreviewStep: true }) {
    console.log("[SectionManager.createMix] Attempting to create section mix.");
    try {
      this.mixingInProgress = true;
      store.set('currentMixStatus', { status: 'exporting', progress: 10 });
      
      console.log("[SectionManager.createMix] Step 1: Exporting sections for mixing...");
      const exportedSectionFilesMetadata = await this.exportSectionsForMixing(); // This contains file, id, type, instruments
      if (!exportedSectionFilesMetadata || exportedSectionFilesMetadata.length === 0) {
        store.set('currentMixStatus', { status: 'error', error: "Exporting sections yielded no files for mixing.", progress: 0 });
        throw new Error("Exporting sections yielded no files for mixing.");
      }
      console.log("[SectionManager.createMix] Step 1 successful. Files for export:", exportedSectionFilesMetadata.map(sf=>sf.file.name));
      store.set('currentMixStatus', { status: 'uploading', progress: 20 });

      // The `instruments` here are the raw client-side selected instruments for each section.
      const filesToUpload = exportedSectionFilesMetadata.map(sf => sf.file);
      const instrumentPayloadForUpload = exportedSectionFilesMetadata.map(sf => sf.instruments);

      console.log("[SectionManager.createMix] Step 2: Calling api.uploadSections...");
      const uploadResult = await api.uploadSections(filesToUpload, instrumentPayloadForUpload);
      console.log("[SectionManager.createMix] Step 2 successful. Upload result:", uploadResult);
      store.set('currentMixStatus', { status: 'uploaded', progress: 40 });
      
      if (!uploadResult || !uploadResult.sections || uploadResult.sections.length === 0) {
        store.set('currentMixStatus', { status: 'error', error: "Section upload to backend did not return valid section data.", progress: 0 });
        throw new Error("Section upload to backend did not return valid section data.");
      }

      // `uploadResult.sections` should contain `id` (backend UUID) and `path` (server path)
      const uploadedSectionDetails = uploadResult.sections.map(s => ({
          id: s.id, // Backend ID (UUID)
          path: s.path // Server path, e.g., "temp/sections/uuid.wav"
      }));

      const overlapMilliseconds = this.getCrossfadeDurationMs(); // Get overlap from a new method
      console.log(`[SectionManager.createMix] Step 3: Calling api.createStitchedSong with ${overlapMilliseconds}ms overlap.`);
      store.set('currentMixStatus', { status: 'stitching', progress: 60 });
      
      const stitchResult = await api.createStitchedSong(uploadedSectionDetails, overlapMilliseconds);
      console.log("[SectionManager.createMix] Step 3 successful. Stitch result:", stitchResult);

      if (!stitchResult || !stitchResult.task_id) {
        store.set('currentMixStatus', { status: 'error', error: "Stitched song creation did not return a valid task_id.", progress: 0 });
        throw new Error("Stitched song creation did not return a valid task_id.");
      }
      
      // *** IMPORTANT: Immediately start playing the stitched audio ***
      // This ensures we at least have audio playing even if professional mastering fails
      if (stitchResult.download_url) {
        // Play the stitched mix in the background - don't await
        this.playStitchedMix(stitchResult.download_url).catch(err => {
          console.error("[SectionManager] Error starting stitched playback:", err);
        });
      }
      
      // Check if we got a server-side path for the stitched audio
      const stitchedAudioPath = stitchResult.output_path_server;
      if (!stitchedAudioPath) {
        console.warn("[SectionManager.createMix] Server did not return a path to the stitched audio file");
      } else {
        console.log("[SectionManager.createMix] Got stitched audio path from server:", stitchedAudioPath);
      }
      
      this.mixData = {
        taskId: stitchResult.task_id,
        status: stitchResult.status, // Should be 'COMPLETED' if synchronous
        type: 'stitched',
        downloadUrl: stitchResult.download_url,
        createdAt: new Date(),
        uploadedSections: uploadedSectionDetails,
        stitchedAudioPath: stitchedAudioPath // Server-side path to stitched audio file
      };
      
      // Mark stitched mix as completed regardless of whether professional mastering succeeds
      this.mixingInProgress = false;
      store.set('currentMixStatus', { 
          status: 'completed', 
          progress: 100, 
          downloadUrl: stitchResult.download_url,
          taskId: stitchResult.task_id
      });
      
      // Dispatch event for UI update
      window.dispatchEvent(new CustomEvent('mix-status-update', { detail: this.mixData }));
      
      // Step 4: Request professional mastering via Tonn API using the stitched audio
      // Only try this if we have both autoMixEnabled and a stitched audio path
      if (this.autoMixEnabled && stitchedAudioPath) {
        // Do this in a non-blocking way so playback continues regardless
        setTimeout(async () => {
          try {
            console.log("[SectionManager.createMix] Step 4: Requesting professional mix from Tonn API");
            store.set('currentMixStatus', { 
              status: 'tonn_mixing', 
              progress: 80, 
              message: 'Requesting professional mix directly from stitched audio...' 
            });
            
            // Create section details for professional mix
            const sectionsWithDetails = uploadResult.sections.map((section, index) => ({
              id: section.id,
              instruments: instrumentPayloadForUpload[index]
            }));
            
            // Get the genre from the store
            const genre = store.get('genre') || 'pop';
            
            // STREAMLINED APPROACH: Send the stitched audio directly for professional mastering
            console.log("[SectionManager.createMix] Using streamlined approach - sending stitched audio directly for mastering");
            
            // Call Tonn API for professional mastering with stitched audio
            const masteringResult = await this.requestDirectFinalMix(
              sectionsWithDetails, 
              genre, 
              stitchedAudioPath
            );
            
            // Handle result from direct final mix request
            if (masteringResult && masteringResult.task_id) {
              this.mixData.tonnTaskId = masteringResult.task_id;
              this.mixData.tonnStatus = masteringResult.status || 'PENDING';
              
              // Update the mix status
              store.set('currentMixStatus', { 
                status: 'tonn_mixing_requested', 
                progress: 85, 
                message: 'Professional mix requested directly from stitched audio',
                tonnTaskId: masteringResult.task_id
              });
              
              // Start polling for direct mix status
              this.pollTonnMixStatus(masteringResult.task_id);
            } else {
              console.error("[SectionManager.createMix] Direct final mix request failed or returned invalid response:", masteringResult);
              throw new Error(masteringResult.error || "Direct final mix request failed");
            }
          } catch (error) {
            console.error("[SectionManager.createMix] Error requesting Tonn mix:", error);
            // Just log the error - we're already playing the stitched mix
            store.set('currentMixStatus', { 
              status: 'tonn_error', 
              progress: 70, 
              message: `Error requesting professional mix: ${error.message}. Using local stitched mix instead.`
            });
          }
        }, 0);
      }
      
      // Return the stitched mix data regardless of professional mastering success
      return this.mixData;
    } catch (error) {
      console.error('[SectionManager.createMix] Error creating stitched section mix:', error);
      this.mixingInProgress = false;
      const errorMsg = error.message || "Unknown error during mix creation";
      store.set('currentMixStatus', { status: 'error', error: errorMsg, progress: 0 });
      // Dispatch an error event or update UI directly
      window.dispatchEvent(new CustomEvent('mix-status-update', { 
        detail: { status: 'error', error: errorMsg, progress: 0 }
      }));
      
      // Try falling back to regular playback if possible
      this.fallbackToRegularPlayback();
      
      throw error;
    }
  }
  
  /**
   * Play the stitched mix immediately 
   * @param {string} url - The URL of the stitched mix
   */
  async playStitchedMix(url) {
    if (!url) {
      console.error("[SectionManager] Cannot play stitched mix: No URL provided");
      return;
    }
    
    try {
      // Generate a request ID to track this playback attempt in logs
      const requestId = `play-stitched-${Date.now()}`;
      console.log(`[SectionManager] [${requestId}] Starting playback of stitched mix: ${url}`);
      
      // Resolve URL via API module if possible
      let resolvedUrl;
      if (api.resolveApiUrl) {
        resolvedUrl = api.resolveApiUrl(url);
        console.log(`[SectionManager] [${requestId}] Resolved URL: ${resolvedUrl}`);
      } else {
        // Fallback URL resolution if api.resolveApiUrl is not available
        if (url.startsWith('http')) {
          resolvedUrl = url;
        } else {
          const apiBaseUrl = api.getApiBaseUrl ? api.getApiBaseUrl() : 'http://localhost:5000/api';
          resolvedUrl = url.startsWith('/') ? `${apiBaseUrl}${url}` : `${apiBaseUrl}/${url}`;
        }
        console.log(`[SectionManager] [${requestId}] Fallback resolved URL: ${resolvedUrl}`);
      }
      
      // Fetch the audio data with timeout
      console.log(`[SectionManager] [${requestId}] Fetching audio from: ${resolvedUrl}`);
      const fetchController = new AbortController();
      const fetchTimeout = setTimeout(() => fetchController.abort(), 15000); // 15 second timeout
      
      try {
        const response = await fetch(resolvedUrl, { 
          signal: fetchController.signal,
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        clearTimeout(fetchTimeout);
        
        if (!response.ok) {
          console.error(`[SectionManager] [${requestId}] Failed to fetch stitched mix: ${response.status} ${response.statusText}`);
          throw new Error(`Failed to fetch stitched mix: ${response.status} ${response.statusText}`);
        }
        
        // Get response data
        console.log(`[SectionManager] [${requestId}] Successfully fetched stitched mix, decoding audio...`);
        const audioData = await response.arrayBuffer();
        
        // Decode the audio in the background
        const audioContext = getAudioContext();
        const audioBuffer = await audioContext.decodeAudioData(audioData);
        
        console.log(`[SectionManager] [${requestId}] Successfully decoded stitched mix: duration=${audioBuffer.duration}s, channels=${audioBuffer.numberOfChannels}`);
        
        // Store the stitched mix buffer for potential future use
        this.stitchedMixBuffer = audioBuffer;
        
        // Start playback with continuousPlaybackEngine
        console.log(`[SectionManager] [${requestId}] Starting continuous playback with stitched mix`);
        this._startPlaybackWithBuffer(audioBuffer, 'stitched');
        
        return true;
      } catch (fetchError) {
        clearTimeout(fetchTimeout);
        console.error(`[SectionManager] [${requestId}] Error fetching stitched mix:`, fetchError);
        throw fetchError;
      }
        } catch (error) {
      console.error(`[SectionManager] Error playing stitched mix:`, error);
      
      // If we failed to fetch the stitched audio from the URL, fall back to playing individual sections
      this.fallbackToRegularPlayback();
      return false;
    }
  }
  
  /**
   * Helper method to start playback with a buffer
   * @private
   * @param {AudioBuffer} audioBuffer - The audio buffer to play
   * @param {string} type - The type of audio ('stitched', 'preview', 'final')
   */
  _startPlaybackWithBuffer(audioBuffer, type) {
    // Start or update continuous playback with this buffer
    if (this.continuousPlaybackActive) {
      console.log(`[SectionManager] Updating continuous playback with ${type} mix`);
      continuousPlaybackEngine.hotSwapContent([{
        id: `${type}-mix`,
        buffer: audioBuffer,
        type: type
      }]);
    } else {
      console.log(`[SectionManager] Starting continuous playback with ${type} mix`);
      continuousPlaybackEngine.setSections([{
        id: `${type}-mix`,
        buffer: audioBuffer,
        type: type
      }]);
      
      // Start continuous playback
      continuousPlaybackEngine.start();
      this.continuousPlaybackActive = true;
      
      // Notify app that continuous playback has started
      window.dispatchEvent(new CustomEvent('continuous-playback-started', {
        detail: { type: type }
      }));
    }
  }
  
  /**
   * Fall back to regular section playback if stitched mix fails
   */
  fallbackToRegularPlayback() {
    console.log("[SectionManager] Falling back to regular section playback");
    
    const sections = store.get('sections');
    const readySections = sections.filter(section => 
      section.status === 'ready' && this.audioBuffers.has(section.id)
    );
    
    if (readySections.length === 0) {
      console.error("[SectionManager] No ready sections found for fallback playback");
      return;
    }
    
    // Create an array of section buffers for continuous playback
    const sectionBuffers = readySections.map(section => ({
      id: section.id,
      buffer: this.audioBuffers.get(section.id),
      type: section.type
    }));
    
    // Start continuous playback with individual sections
    if (sectionBuffers.length > 0) {
      if (this.continuousPlaybackActive) {
        continuousPlaybackEngine.hotSwapContent(sectionBuffers);
      } else {
        continuousPlaybackEngine.setSections(sectionBuffers);
        continuousPlaybackEngine.start();
        this.continuousPlaybackActive = true;
        
        // Notify app that continuous playback has started
        window.dispatchEvent(new CustomEvent('continuous-playback-started', {
          detail: { type: 'regular' }
        }));
      }
    }
  }

  /**
   * Add a section to the playback queue
   * Enhanced to support appending to mastered audio
   * @param {string} sectionId - ID of the section to add
   * @param {Object} options - Configuration options
   * @param {boolean} options.appendToMastered - Whether to append to mastered audio if playing
   * @returns {boolean} Whether the section was successfully added
   */
  addSectionToPlaybackQueue(sectionId, options = {}) {
    if (!this.continuousPlaybackActive || !sectionId) return false;
    
    const section = store.get('sections').find(s => s.id === sectionId);
    if (!section || section.status !== 'ready' || !this.audioBuffers.has(sectionId)) {
      console.warn(`[SectionManager] Cannot add section ${sectionId} to playback: not ready or no audio buffer`);
      return false;
    }
    
    // Check if we're currently playing mastered audio
    const playingMastered = continuousPlaybackEngine.sections.length === 1 && 
                            (continuousPlaybackEngine.sections[0].type === 'mastered' ||
                            continuousPlaybackEngine.sections[0].type === 'mastered-with-appendage');
    
    const shouldAppendToMastered = options.appendToMastered !== false && playingMastered;
    
    console.log(`[SectionManager] Adding section ${sectionId} to playback queue (appendToMastered: ${shouldAppendToMastered})`);
    
    // Create the section object for the engine
    const sectionForEngine = {
      id: sectionId,
      buffer: this.audioBuffers.get(sectionId),
      type: section.type,
      metadata: {
        instruments: section.instruments,
        bpm: section.bpm || store.get('bpm'),
        key: section.key || 'C'
      }
    };
    
    // Add to the engine's queue
    const added = continuousPlaybackEngine.appendSection(sectionForEngine, shouldAppendToMastered);
    
    if (added && shouldAppendToMastered) {
      // Track this section as appended for mastering
      this.appendedSections.push({
        id: sectionId,
        timestamp: Date.now(),
        type: section.type
      });
      
      // If we successfully appended to mastered audio, schedule a remastering
      this.scheduleRemasteringOfCombinedAudio();
    }
    
    return added;
  }

  /**
   * Schedule remastering of combined audio (mastered + new sections)
   * This creates a pipeline for continuous improvement of the audio
   * Enhanced to only trigger when new sections have been added
   */
  async scheduleRemasteringOfCombinedAudio() {
    if (!this.autoMixEnabled) {
      console.log("[SectionManager] Auto-mixing is disabled, skipping remastering");
      return;
    }
    
    if (this.remasteringInProgress) {
      console.log("[SectionManager] Remastering already in progress, skipping");
      return;
    }
    
    // Get the current expanded mastered section from the engine
    const currentSections = continuousPlaybackEngine.sections;
    if (currentSections.length !== 1 || 
        (currentSections[0].type !== 'mastered-with-appendage' && 
         currentSections[0].type !== 'mastered')) {
      console.log("[SectionManager] No expanded mastered section to remaster");
      return;
    }
    
    // Check if any new sections have been added since last mastering
    if (this.appendedSections.length === 0 || 
        this.appendedSections.length <= this.lastMasteredSectionCount) {
      console.log("[SectionManager] No new sections added since last mastering, skipping");
      return;
    }
    
    // Update the count of mastered sections
    this.lastMasteredSectionCount = this.appendedSections.length;
    
    const currentSection = currentSections[0];
    console.log(`[SectionManager] Scheduling remastering of expanded mastered audio: ${currentSection.type} with ${this.appendedSections.length} sections`);
    
    // Mark remastering as in progress
    this.remasteringInProgress = true;
    
    try {
      // Generate a unique ID for the combined file
      const combinedAudioId = `combined-${Date.now()}`;
      const combinedAudioFilename = `${combinedAudioId}.wav`;
      const combinedAudioPath = `${store.get('tempDir') || 'temp'}/combined/${combinedAudioFilename}`;
      
      // Convert the buffer to WAV and save to disk via the API
      const buffer = currentSection.buffer;
      const wavBlob = await audioBufferToWav(buffer);
      
      // Create a formdata object to upload the file
      const formData = new FormData();
      formData.append('audio', new File([wavBlob], combinedAudioFilename, { type: 'audio/wav' }));
      
      // Upload the combined file
      console.log(`[SectionManager] Uploading combined audio for remastering`);
      
      const uploadResponse = await fetch(`${api.getApiBaseUrl()}/upload-combined-audio`, {
        method: 'POST',
        body: formData
      });
      
      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload combined audio: ${uploadResponse.status} ${uploadResponse.statusText}`);
      }
      
      const uploadResult = await uploadResponse.json();
      const serverPath = uploadResult.path;
      
      if (!serverPath) {
        throw new Error("Server did not return a valid path for the uploaded audio");
      }
      
      console.log(`[SectionManager] Combined audio uploaded successfully to ${serverPath}`);
      
      // Get the genre for mastering
      const genre = store.get('genre') || 'pop';
      
      // Start mastering process
      console.log(`[SectionManager] Requesting mastering of combined audio with genre ${genre}`);
      
      const masteringResponse = await fetch(`${api.getApiBaseUrl()}/create-direct-mix`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          stitchedAudioPath: serverPath,
          skipPreview: true,
          genre: genre
        })
      });
      
      if (!masteringResponse.ok) {
        throw new Error(`Failed to request mastering: ${masteringResponse.status} ${masteringResponse.statusText}`);
      }
      
      const masteringResult = await masteringResponse.json();
      const masteringTaskId = masteringResult.task_id;
      
      if (!masteringTaskId) {
        throw new Error("Server did not return a valid task ID for mastering");
      }
      
      // Store the current task ID
      this.pendingMasterTask = masteringTaskId;
      
      console.log(`[SectionManager] Mastering requested successfully: ${masteringTaskId}`);
      
      // Start polling for mastering status in the background
      this.pollTonnMixStatus(masteringTaskId);
      
      return masteringTaskId;
    } catch (error) {
      console.error("[SectionManager] Error scheduling remastering:", error);
      this.remasteringInProgress = false;
      
      // Dispatch event for UI update
      window.dispatchEvent(new CustomEvent('remastering-error', {
        detail: {
          error: error.message
        }
      }));
    }
  }
  
  /**
   * Set auto-mix enabled state
   * @param {boolean} enabled - Whether auto-mixing should be enabled
   */
  setAutoMixEnabled(enabled) {
    this.autoMixEnabled = !!enabled;
    console.log(`[SectionManager] Auto-mixing ${this.autoMixEnabled ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Get the current auto-mix enabled state
   * @returns {boolean} Whether auto-mixing is enabled
   */
  isAutoMixEnabled() {
    return this.autoMixEnabled;
  }
  
  /**
   * Set mute state for audio playback
   * @param {boolean} muted - Whether audio should be muted
   * @returns {boolean} New mute state
   */
  setMuted(muted) {
    if (this.continuousPlaybackActive) {
      // Use the continuous playback engine's mute function
      continuousPlaybackEngine.setMuted(muted);
      return muted;
    } else if (this.playerElement) {
      // Mute the standalone audio player
      this.playerElement.muted = muted;
      return muted;
    }
    
    return false;
  }
  
  /**
   * Toggle mute state for audio playback
   * @returns {boolean} New mute state (true = muted)
   */
  toggleMute() {
    if (this.continuousPlaybackActive) {
      // Use the continuous playback engine's toggle function
      return continuousPlaybackEngine.toggleMute();
    } else if (this.playerElement) {
      // Toggle the standalone audio player's mute state
      this.playerElement.muted = !this.playerElement.muted;
      return this.playerElement.muted;
    }
    
    return false;
  }
  
  /**
   * Get current mute state
   * @returns {boolean} Whether audio is currently muted
   */
  isMuted() {
    if (this.continuousPlaybackActive) {
      return continuousPlaybackEngine.isMuted();
    } else if (this.playerElement) {
      return this.playerElement.muted;
    }
    
    return false;
  }
  
  /**
   * Play a sound effect
   * @param {string} type - Effect type ('key' or 'transition')
   * @param {Object} options - Additional effect options
   */
  playSoundEffect(type, options = {}) {
    // First check if the continuous playback engine is active
    if (this.continuousPlaybackActive) {
      // Play through the continuous playback engine
      return continuousPlaybackEngine.playSoundEffect(type, options);
    }
    
    // If not using continuous playback, create a one-off effect
    const audioContext = getAudioContext();
    if (!audioContext) {
      console.warn('[SectionManager] AudioContext not available for sound effect');
      return;
    }
    
    // Resume context if suspended
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    
    const now = audioContext.currentTime;
    
    // Create a different effect based on type
    if (type === 'key') {
      // Simple chord stab effect
      const duration = 0.3;
      
      // Create oscillator and gain
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      
      // Set oscillator type and frequency
      osc.type = 'triangle';
      osc.frequency.value = 440; // A4
      
      // Set amplitude envelope
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.5, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      
      // Connect nodes
      osc.connect(gain);
      gain.connect(audioContext.destination);
      
      // Play the effect
      osc.start(now);
      osc.stop(now + duration);
      
      // Clean up
      setTimeout(() => {
        gain.disconnect();
      }, duration * 1000 + 100);
    } else if (type === 'transition') {
      // Filter sweep effect
      const duration = 2.0;
      
      // Create oscillator and filter
      const osc = audioContext.createOscillator();
      const filter = audioContext.createBiquadFilter();
      const gain = audioContext.createGain();
      
      // Set up nodes
      osc.type = 'sawtooth';
      osc.frequency.value = 110; // Low A2
      
      filter.type = 'lowpass';
      filter.Q.value = 10;
      filter.frequency.setValueAtTime(100, now);
      filter.frequency.exponentialRampToValueAtTime(5000, now + duration * 0.7);
      filter.frequency.exponentialRampToValueAtTime(100, now + duration);
      
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.1);
      gain.gain.linearRampToValueAtTime(0.1, now + duration * 0.8);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      
      // Connect nodes
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(audioContext.destination);
      
      // Play the effect
      osc.start(now);
      osc.stop(now + duration);
      
      // Clean up
      setTimeout(() => {
        gain.disconnect();
      }, duration * 1000 + 100);
    }
  }

  /**
   * Get current waveform data for display purposes.
   * Delegates to continuousPlaybackEngine if active, otherwise provides a fallback.
   * @param {number} numPoints - Number of data points desired for the waveform.
   * @returns {Uint8Array} Array of waveform data points (scaled 0-15).
   */
  getWaveformDataForDisplay(numPoints = 128) {
    if (this.continuousPlaybackActive && continuousPlaybackEngine) {
      return continuousPlaybackEngine.getWaveformData(numPoints);
    }
    
    // Fallback for non-continuous playback or if engine is not available
    // This might use the older analyserNode if it's still relevant for some playback modes.
    if (this.analyserNode && this.analyserDataArray && this.isPlaying) {
        this.analyserNode.getByteTimeDomainData(this.analyserDataArray);
        const waveform = new Uint8Array(numPoints);
        const bufferLength = this.analyserDataArray.length;
        if (bufferLength === 0) { // Guard against zero bufferLength
            for(let i=0; i<numPoints; i++) waveform[i] = 0;
            return waveform;
        }
        const step = Math.max(1, Math.floor(bufferLength / numPoints)); // Ensure step is at least 1

         for (let i = 0; i < numPoints; i++) {
              let sum = 0;
              let count = 0;
              for (let j = 0; j < step; j++) {
                  const sampleIndex = i * step + j;
                  if (sampleIndex < bufferLength) {
                      sum += this.analyserDataArray[sampleIndex];
                      count++;
                  }
              }
              let value = count > 0 ? sum / count : 128; // Default to silence
              // Scale 0-255 to 0-15 (max amplitude for Arduino display)
              let scaledValue = Math.abs(value - 128) / 128.0 * 15.0;
              waveform[i] = Math.min(15, Math.max(0, Math.round(scaledValue)));
        }
        return waveform;
    }
    
    // Default to a flat line if no data can be obtained
    const flatLine = new Uint8Array(numPoints);
    for(let i=0; i<numPoints; i++) flatLine[i] = 0;
    return flatLine;
  }
}

// Create and export singleton instance
export const sectionManager = new SectionManager(); 