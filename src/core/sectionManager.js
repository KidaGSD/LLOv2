import { store } from './store.js';
import { getSectionTypes } from '../utils/sectionUtils.js';
import { buildPrompt } from '../utils/promptBuilder.js';
import * as api from './api.js';
import { getAudioContext, createOfflineContext, audioBufferToWav } from '../audio/audioContext.js';
import { createVisualizer } from '../components/visualizer.js';

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

    // Optionally, if sectionManager handles its own visualization data generation upon receiving the buffer:
    // this.generateVisualizationData(audioBuffer).then(visualData => {
    //   this.updateSection(sectionId, { visualData, status: 'ready' }); 
    //   // Note: app.js also sets status to 'ready'. Ensure consistency or centralize status updates.
    // }).catch(err => console.error("Error generating viz data in setSectionAudio:", err));
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
   * Create a mix from all sections
   * @returns {Promise<Object>} Mix data including task ID and status
   */
  async createSectionMix() {
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
      store.set('currentMixStatus', { status: 'uploading', progress: 30 });

      // The `instruments` here are the raw client-side selected instruments for each section.
      const filesToUpload = exportedSectionFilesMetadata.map(sf => sf.file);
      const instrumentPayloadForUpload = exportedSectionFilesMetadata.map(sf => sf.instruments);

      console.log("[SectionManager.createMix] Step 2: Calling api.uploadSections...");
      const uploadResult = await api.uploadSections(filesToUpload, instrumentPayloadForUpload);
      console.log("[SectionManager.createMix] Step 2 successful. Upload result:", uploadResult);
      store.set('currentMixStatus', { status: 'uploaded', progress: 50 });
      
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
      store.set('currentMixStatus', { status: 'stitching', progress: 70 });
      
      const stitchResult = await api.createStitchedSong(uploadedSectionDetails, overlapMilliseconds);
      console.log("[SectionManager.createMix] Step 3 successful. Stitch result:", stitchResult);

      if (!stitchResult || !stitchResult.task_id) {
        store.set('currentMixStatus', { status: 'error', error: "Stitched song creation did not return a valid task_id.", progress: 0 });
        throw new Error("Stitched song creation did not return a valid task_id.");
      }
      
      this.mixData = {
        taskId: stitchResult.task_id,
        status: stitchResult.status, // Should be 'COMPLETED' if synchronous
        type: 'stitched',
        downloadUrl: stitchResult.download_url,
        createdAt: new Date(),
        // sections: uploadResult.sections.map(s => s.id) // Store the backend-generated IDs
      };
      
      this.mixingInProgress = false;
      store.set('currentMixStatus', { 
          status: 'completed', 
          progress: 100, 
          downloadUrl: stitchResult.download_url,
          taskId: stitchResult.task_id
      });
      console.log("[SectionManager.createMix] Stitched mix completed.", this.mixData);
      // Dispatch event for UI update
      window.dispatchEvent(new CustomEvent('mix-status-update', { detail: this.mixData }));
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
      throw error;
    }
  }
  
  /**
   * Calculates the crossfade duration in milliseconds.
   * For now, a fixed value. Can be made BPM-dependent.
   * @returns {number} Crossfade duration in milliseconds.
   */
  getCrossfadeDurationMs() {
    const sessionBPM = store.get('bpm') || 120;
    const beatsToOverlap = 1; // e.g., 1 beat overlap
    // Duration of one beat in milliseconds: (60 / BPM) * 1000
    const beatDurationMs = (60 / sessionBPM) * 1000;
    // const overlapMs = beatsToOverlap * beatDurationMs; // BPM-dependent
    // console.log(`[SectionManager] BPM: ${sessionBPM}, Beat Duration: ${beatDurationMs.toFixed(0)}ms, Overlap: ${overlapMs.toFixed(0)}ms for ${beatsToOverlap} beats`);
    return 200; // Fixed 200ms for now, consistent with playSequence for testing
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
   * Create a final high-quality mix based on preview mix
   * @param {string} previewTaskId - The preview mix task ID
   * @returns {Promise<Object>} Final mix data
   */
  async createFinalMix(previewTaskId) {
    try {
      this.mixingInProgress = true;
      
      // Call API to create final mix
      const finalMixResult = await api.createFinalMix(previewTaskId);
      
      // Store mix data
      this.mixData = {
        taskId: finalMixResult.task_id,
        status: finalMixResult.status,
        type: 'final',
        createdAt: new Date(),
        previewTaskId,
        downloadUrl: finalMixResult.download_url
      };
      
      // If the mix was completed immediately, return the mix data
      if (finalMixResult.status === 'completed') {
        this.mixingInProgress = false;
        return this.mixData;
      }
      
      // Otherwise, set up a poller to check mix status
      this.pollMixStatus(finalMixResult.task_id);
      
      return this.mixData;
    } catch (error) {
      console.error('Error creating final mix:', error);
      this.mixingInProgress = false;
      throw error;
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
   * Get the current audio level for VU meter
   * @returns {number} Audio level from 0-100, or 0 if not available.
   */
  getAudioLevel() {
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

  async createLocalStitchedSong() {
    console.log("[SectionManager.createLocalStitchedSong] Starting client-side stitching.");
    store.set('currentMixStatus', { status: 'stitching_local', progress: 10, message: 'Preparing sections for local stitching...' });

    const sectionsFromStore = store.get('sections');
    const readyBuffers = [];
    let firstSampleRate = 44100; // Default sample rate

    for (const section of sectionsFromStore) {
      if (section.status === 'ready' && this.audioBuffers.has(section.id)) {
        const buffer = this.audioBuffers.get(section.id);
        readyBuffers.push(buffer);
        if (readyBuffers.length === 1) {
          firstSampleRate = buffer.sampleRate;
        }
      }
    }

    if (readyBuffers.length === 0) {
      console.error("[SectionManager.createLocalStitchedSong] No ready audio buffers found to stitch.");
      store.set('currentMixStatus', { status: 'error', error: 'No ready audio found for stitching.', progress: 0 });
      throw new Error('No ready audio buffers to stitch.');
    }

    const crossfadeMs = this.getCrossfadeDurationMs();
    const crossfadeSecs = crossfadeMs / 1000;
    let totalDurationSecs = 0;

    readyBuffers.forEach((buffer, index) => {
      totalDurationSecs += buffer.duration;
      if (index < readyBuffers.length - 1) {
        totalDurationSecs -= crossfadeSecs; // Subtract overlap for all but the last transition
      }
    });
     if (totalDurationSecs <= 0 && readyBuffers.length > 0) { // Handle case where total duration might be negative if crossfade is too long for short clips
      totalDurationSecs = readyBuffers.reduce((sum, b) => sum + b.duration, 0); // Fallback to sum of durations
      console.warn("[SectionManager.createLocalStitchedSong] Calculated total duration was <=0 due to overlaps. Using sum of durations as fallback.");
    }


    console.log(`[SectionManager.createLocalStitchedSong] Total calculated duration for OfflineAudioContext: ${totalDurationSecs.toFixed(2)}s`);
    store.set('currentMixStatus', { status: 'stitching_local', progress: 30, message: `Calculated total duration: ${totalDurationSecs.toFixed(2)}s. Initializing offline context...` });

    const offlineCtx = new OfflineAudioContext(2, Math.ceil(totalDurationSecs * firstSampleRate), firstSampleRate);
    let currentTime = 0; // Start time for scheduling in the offline context

    readyBuffers.forEach((buffer, index) => {
      const source = offlineCtx.createBufferSource();
      source.buffer = buffer;
      const gainNode = offlineCtx.createGain();

      const duration = buffer.duration;
      const startTimeInSequence = currentTime;

      // Apply fade logic similar to playSequence
      gainNode.gain.setValueAtTime(0, startTimeInSequence);
      const fadeInDuration = Math.min(crossfadeSecs, duration / 2);
      gainNode.gain.linearRampToValueAtTime(1, startTimeInSequence + fadeInDuration);

      const fadeOutStartTime = Math.max(startTimeInSequence + fadeInDuration, startTimeInSequence + duration - crossfadeSecs);
      gainNode.gain.setValueAtTime(1, fadeOutStartTime);
      gainNode.gain.linearRampToValueAtTime(0, startTimeInSequence + duration);
      
      source.connect(gainNode);
      gainNode.connect(offlineCtx.destination);
      source.start(startTimeInSequence);

      console.log(`[SectionManager.createLocalStitchedSong] Scheduled section ${index + 1} to start at ${startTimeInSequence.toFixed(2)}s, duration ${duration.toFixed(2)}s in OfflineContext.`);

      if (index < readyBuffers.length - 1) {
        currentTime += (duration - crossfadeSecs);
      } else {
        // For the last buffer, we don't advance currentTime beyond its end for calculation purposes,
        // but the totalDurationSecs of the context should cover it.
      }
       // Ensure currentTime doesn't go backward if duration is shorter than crossfade
      if (duration < crossfadeSecs && index < readyBuffers.length -1) {
          currentTime = startTimeInSequence + fadeInDuration; // Ensure positive advancement at least by fade-in
      }
    });
    
    store.set('currentMixStatus', { status: 'stitching_local', progress: 60, message: 'Rendering audio offline...' });
    console.log("[SectionManager.createLocalStitchedSong] Starting offline rendering...");

    return new Promise((resolve, reject) => {
      offlineCtx.oncomplete = async (event) => {
        console.log("[SectionManager.createLocalStitchedSong] Offline rendering complete.");
        store.set('currentMixStatus', { status: 'stitching_local', progress: 90, message: 'Converting to WAV...' });
        try {
          // Assuming audioBufferToWav is available and imported correctly
          // If it's not automatically imported, we might need:
          const audioContextModule = await import('/src/audio/audioContext.js');
          const wavBlob = audioContextModule.audioBufferToWav(event.renderedBuffer);
          console.log("[SectionManager.createLocalStitchedSong] WAV blob created.", wavBlob);
          console.log("[SectionManager.createLocalStitchedSong] WAV blob size: " + wavBlob.size + " bytes, type: " + wavBlob.type);
          console.log("[SectionManager.createLocalStitchedSong] SUCCESS - Returning WAV blob to handleCreateMix()");
          store.set('currentMixStatus', { status: 'completed_local', progress: 100, message: 'Local stitching complete! WAV ready.' });
          resolve(wavBlob);
        } catch (error) {
          console.error("[SectionManager.createLocalStitchedSong] Error converting rendered buffer to WAV:", error);
          store.set('currentMixStatus', { status: 'error', error: 'Failed to convert audio to WAV.', progress: 0 });
          reject(error);
        }
      };
      offlineCtx.startRendering().catch(err => {
        console.error("[SectionManager.createLocalStitchedSong] Error starting offline rendering:", err);
        store.set('currentMixStatus', { status: 'error', error: `Offline rendering failed: ${err.message}`, progress: 0 });
        reject(err);
      });
    });
  }
}

// Create and export singleton instance
export const sectionManager = new SectionManager(); 