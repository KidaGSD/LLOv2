/**
 * Section-Based Music Generator Client
 * Main application logic to integrate with the backend
 */

// Import required modules (when integrating with a build system)
// In this standalone version, we'll use inline imports

import { store } from '/src/core/store.js';
import { sectionManager } from '/src/core/sectionManager.js';
import { getSectionTypes, getInstrumentOptions, getRecommendedInstruments } from '/src/utils/sectionUtils.js';
import * as api from '/src/core/api.js';
import { getAudioContext } from '/src/audio/audioContext.js';
import { hw } from '/src/core/hardware.js';

// Server configuration
const SERVER_CONFIG = {
  BASE_PORTS: [5000, 5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009, 5010],
  currentPort: null,
  getServerUrl() {
    if (this.currentPort) {
      return `http://localhost:${this.currentPort}`;
    }
    return null;
  }
};

// Make SERVER_CONFIG globally available
window.SERVER_CONFIG = SERVER_CONFIG;

// Main App Class
class MusicGeneratorApp {
  constructor() {
    // UI element references
    this.elements = {
      // Sections
      sectionList: document.getElementById('section-list'),
      noSectionsPlaceholder: document.getElementById('no-sections'),
      editorPlaceholder: document.getElementById('editor-placeholder'),
      sectionEditor: document.getElementById('section-editor'),
      
      // Modals
      sectionModal: document.getElementById('section-modal'),
      instrumentsModal: document.getElementById('instruments-modal'),
      
      // Form inputs
      genreSelect: document.getElementById('genre'),
      bpmInput: document.getElementById('bpm'),
      sectionTypeSelect: document.getElementById('section-type'),
      modalSectionTypeSelect: document.getElementById('modal-section-type'),
      sectionDescription: document.getElementById('section-description'),
      instrumentsDisplay: document.getElementById('instruments-display'),
      instrumentGrid: document.getElementById('instrument-grid'),
      
      // Camera elements
      cameraFeed: document.getElementById('camera-feed'),
      cameraCanvas: document.getElementById('camera-canvas'),
      captureBtn: document.getElementById('capture-btn'),
      
      // Buttons
      addSectionBtn: document.getElementById('add-section-btn'),
      createMixBtn: document.getElementById('create-mix-btn'),
      confirmAddSectionBtn: document.getElementById('confirm-add-section'),
      selectInstrumentsBtn: document.getElementById('select-instruments-btn'),
      confirmInstrumentsBtn: document.getElementById('confirm-instruments'),
      generateBtn: document.getElementById('generate-btn'),
      deleteSectionBtn: document.getElementById('delete-section-btn'),
      playBtn: document.getElementById('play-btn'),
      stopBtn: document.getElementById('stop-btn'),
      downloadSectionBtn: document.getElementById('download-section-btn'),
      
      // Visualizer
      visualizerContainer: document.getElementById('visualizer-container'),
      visualizer: document.getElementById('visualizer'),
      
      // Mix container
      mixContainer: document.getElementById('mix-container'),
      mixStatus: document.getElementById('mix-status'),
      mixStatusText: document.getElementById('mix-status-text'),
      mixProgress: document.getElementById('mix-progress'),
      audioPlayerContainer: document.getElementById('audio-player-container'),
      audioPlayer: document.getElementById('audio-player'),
      downloadMixBtn: document.getElementById('download-mix-btn'),
      createFinalMixBtn: document.getElementById('create-final-mix-btn'),
      
      // Server status
      serverStatus: document.getElementById('server-status'),
      statusIndicator: document.getElementById('status-indicator'),
      statusText: document.getElementById('status-text'),
      
      // New button
      playAllBtn: document.getElementById('play-all-btn'),
      instrumentGridEditor: document.getElementById('instrument-grid-editor'),
      confirmInstrumentsEditorBtn: document.getElementById('confirm-instruments-editor'),
      connectArduinoBtn: document.getElementById('connect-arduino-btn'),
      arduinoStatusText: document.getElementById('arduino-status-text'),
      clearSectionsBtn: document.getElementById('clear-sections-btn'),
      
      // New continuous playback elements
      continuousPlayBtn: document.getElementById('continuous-play-btn'),
      loopCountDisplay: document.getElementById('loop-count-display'),
      mixStatusIndicator: document.getElementById('mix-status-indicator'),
      autoMixToggle: document.getElementById('auto-mix-toggle'),
      miniviews: document.getElementById('section-miniviews'),
      miniviewGrid: document.getElementById('section-miniview-grid'),
    };
    
    // App state
    this.state = {
      currentSectionId: null,
      selectedInstruments: [],
      serverAvailable: false,
      cameraActive: false,
      cameraStream: null,
      capturedImage: null,
      arduinoConnected: false,
      lastArduinoDataSent: '',
      isGeneratingAudio: false,
      isMuted: false
    };
    
    // Bind methods
    this.bindMethods();
    
    // Initialize app
    this.init();
  }
  
  // Camera handling methods
  async initializeCameraDefaultOn() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !navigator.mediaDevices.enumerateDevices) {
      console.warn("Camera API (getUserMedia or enumerateDevices) not available.");
      alert("Camera features not fully available on this browser.");
      if(this.elements.captureBtn) this.elements.captureBtn.disabled = true;
      this.state.cameraAvailable = false;
      throw new Error("Camera API not fully available");
    }

    try {
      // Get list of video input devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');

      let preferredDeviceId = null;

      if (videoDevices.length > 1) {
        console.log("Multiple video devices found:", videoDevices.map(d => d.label));
        // Try to find an external camera. This is heuristic.
        // Common built-in camera names: "FaceTime", "Integrated Camera", "Built-in"
        // External cameras often have brand names or generic USB names.
        const externalCamera = videoDevices.find(device => 
          !device.label.toLowerCase().includes('facetime') && 
          !device.label.toLowerCase().includes('integrated') &&
          !device.label.toLowerCase().includes('built-in') &&
          (device.label.toLowerCase().includes('usb') || 
           device.label.toLowerCase().includes('webcam') || 
           device.label.toLowerCase().includes('external') ||
           // Add more keywords if specific external cameras are common
           videoDevices.indexOf(device) > 0 // Often, built-in is first
          )
        );
        
        if (externalCamera) {
          preferredDeviceId = externalCamera.deviceId;
          console.log("Attempting to use preferred external camera:", externalCamera.label);
        } else {
          // If no clear external, try the last one in the list that isn't an obvious internal one
          const lastResortExternal = videoDevices.slice().reverse().find(device =>
            !device.label.toLowerCase().includes('facetime') && 
            !device.label.toLowerCase().includes('integrated') &&
            !device.label.toLowerCase().includes('built-in')
          );
          if (lastResortExternal) {
            preferredDeviceId = lastResortExternal.deviceId;
            console.log("Using last resort non-internal camera:", lastResortExternal.label);
          } else {
            // Fallback to the first one if no better option
            preferredDeviceId = videoDevices[0]?.deviceId;
             console.log("Could not clearly identify external camera, using first available:", videoDevices[0]?.label);
          }
        }
      } else if (videoDevices.length === 1) {
        preferredDeviceId = videoDevices[0].deviceId;
        console.log("Only one video device found, using:", videoDevices[0].label);
      }

      const constraints = { video: {} };
      if (preferredDeviceId) {
        constraints.video.deviceId = { exact: preferredDeviceId };
      } else {
        // Default constraints if no specific device ID is found (should not happen if videoDevices.length > 0)
        // or if enumerateDevices fails to return useful info but getUserMedia still works.
        constraints.video = true;
        console.log("No specific video device ID to prefer, using default video input.");
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (this.elements.cameraFeed) {
        this.elements.cameraFeed.srcObject = stream;
      }
      this.state.cameraStream = stream;
      this.state.cameraActive = true;
      this.state.cameraAvailable = true;
      if(this.elements.captureBtn) this.elements.captureBtn.disabled = false;
      const activeTrack = stream.getVideoTracks()[0];
      console.log(`Camera initialized. Active track: ${activeTrack?.label || 'N/A'} (ID: ${activeTrack?.id || 'N/A'})`);

    } catch (err) {
      console.error("Error accessing camera with preference:", err);
      alert("Could not access the preferred camera. Please check permissions. Capture features might be limited.");
      // Fallback to default camera if specific device fails
      try {
        console.log("Falling back to default camera access...");
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (this.elements.cameraFeed) {
            this.elements.cameraFeed.srcObject = stream;
        }
        this.state.cameraStream = stream;
        this.state.cameraActive = true;
        this.state.cameraAvailable = true;
        if(this.elements.captureBtn) this.elements.captureBtn.disabled = false;
        const activeTrack = stream.getVideoTracks()[0];
        console.log(`Fallback camera initialized. Active track: ${activeTrack?.label || 'N/A'}`);
      } catch (fallbackErr) {
        console.error("Error accessing fallback camera:", fallbackErr);
        alert("Could not access any camera. Please check permissions. Capture features will be disabled.");
      this.state.cameraActive = false;
      this.state.cameraAvailable = false;
      if(this.elements.captureBtn) this.elements.captureBtn.disabled = true;
        // throw err; // Optionally re-throw original or fallback error
      }
    }
  }
  
  stopCamera() {
    if (this.state.cameraStream) {
      this.state.cameraStream.getTracks().forEach(track => track.stop());
      if(this.elements.cameraFeed) this.elements.cameraFeed.srcObject = null;
      this.state.cameraStream = null;
      this.state.cameraActive = false;
      console.log("Camera stopped.");
    }
  }
  
  async captureImage() {
    if (!this.state.cameraActive) {
      alert('Camera is not active. Please ensure it is enabled and permissions are granted.');
      return null;
    }
    
    const video = this.elements.cameraFeed;
    const canvas = this.elements.cameraCanvas;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    let imageData;
    try {
      imageData = canvas.toDataURL('image/jpeg');
      this.state.capturedImage = imageData;
      console.log('Image captured by canvas');
      this.displayCapturedImage(imageData);
    } catch (error) {
      console.error('Error converting canvas to data URL:', error);
      alert('Failed to capture image data.');
      return null;
    }

    if (imageData) {
      const currentSection = this.getCurrentSection();
      if (!currentSection) {
        alert("Please add or select a section first before capturing an image for it.");
        return null;
      }

      try {
        this.elements.captureBtn.disabled = true;
        this.elements.captureBtn.textContent = 'Analyzing...';
        this.elements.sectionDescription.value = "Analyzing image with GPT-4o Vision...";
        
        const captionData = await api.processImageWithGPT4o(imageData);

        if (!captionData || Object.keys(captionData).length === 0) {
            throw new Error("Received empty or invalid caption data from API.");
        }
        
        this.elements.sectionDescription.value = 
          `Description: ${captionData.description || 'N/A'}\n` +
          `Objects: ${(captionData.objects && captionData.objects.length > 0) ? captionData.objects.join(', ') : 'N/A'}\n` +
          `Mood: ${captionData.mood || 'N/A'}\n` +
          `Section Type: ${captionData.section || 'N/A'}\n` +
          `Genre: ${captionData.genre || 'N/A'}\n` +
          `BPM: ${captionData.bpm || 'N/A'}`;
        
        const sections = store.get('sections');
        const index = sections.findIndex(s => s.id === currentSection.id);
        let isFirstSectionSettingGlobals = (sections.length === 1 && sections[0].id === currentSection.id);
        
        if (index !== -1) {
          const updatedSection = {
            ...sections[index],
            caption: captionData,
            capturedImage: imageData // Store the image in the section
          };
          const updatedSections = [...sections];
          updatedSections[index] = updatedSection;
          store.set('sections', updatedSections);
          console.log("Caption data and image stored in section:", currentSection.id, captionData);

          if (captionData.section && this.elements.sectionTypeSelect.value !== captionData.section) {
             if (Array.from(this.elements.sectionTypeSelect.options).some(opt => opt.value === captionData.section)) {
                this.elements.sectionTypeSelect.value = captionData.section;
                updatedSection.type = captionData.section;
                store.set('sections', updatedSections); 
             }
          }
        }

        // --- BPM Locking Logic --- 
        const existingGlobalBPM = store.get('bpm');
        // Only set global BPM if it hasn't been set by a caption yet OR if this is the very first section being captioned.
        // We use a more explicit check for an initial un-set state (e.g. 0 or initial default 120).
        const isGlobalBPMUnset = !existingGlobalBPM || existingGlobalBPM === 120; // Consider 120 as unset if it's the default

        if (captionData.bpm && (isFirstSectionSettingGlobals || isGlobalBPMUnset)) {
          const newBpm = parseInt(captionData.bpm, 10);
          if (!isNaN(newBpm) && newBpm >= 60 && newBpm <= 180) {
            this.elements.bpmInput.value = newBpm;
            store.set('bpm', newBpm); // Set the global BPM
            console.log("Global BPM SET from caption:", newBpm);
            this.elements.bpmInput.disabled = true; // Disable BPM input after first set
          }
        } else if (existingGlobalBPM) {
            // If global BPM is already set, ensure the UI reflects it and stays disabled.
            this.elements.bpmInput.value = existingGlobalBPM;
            this.elements.bpmInput.disabled = true;
        }
        
        // --- Genre Locking Logic (similar to BPM) ---
        const existingGlobalGenre = store.get('genre');
        const isGlobalGenreUnset = !existingGlobalGenre || existingGlobalGenre === 'pop'; // Consider pop as unset if it's the default

        if (captionData.genre && (isFirstSectionSettingGlobals || isGlobalGenreUnset)) {
          const newGenre = captionData.genre.toLowerCase();
          const genreSelectOptions = Array.from(this.elements.genreSelect.options);
          const matchedOption = genreSelectOptions.find(opt => opt.value.toLowerCase() === newGenre || opt.text.toLowerCase().includes(newGenre));
          if (matchedOption) {
            this.elements.genreSelect.value = matchedOption.value;
            store.set('genre', matchedOption.value); // Set the global genre
            console.log("Global Genre SET from caption:", matchedOption.value);
            this.elements.genreSelect.disabled = true; // Disable Genre input after first set
          }
        } else if (existingGlobalGenre) {
            this.elements.genreSelect.value = existingGlobalGenre;
            this.elements.genreSelect.disabled = true;
        }
        
      } catch (error) {
        console.error('Error processing image with GPT-4o Vision:', error);
        this.elements.sectionDescription.value = 
          `Error analyzing image: ${error.message}. Please try again.`;
      } finally {
        this.elements.captureBtn.disabled = false;
        this.elements.captureBtn.textContent = 'Capture Image';
      }
    }
    return imageData;
  }
  
  displayCapturedImage(imageData) {
    // Remove any existing captured image
    const existingImage = document.querySelector('.captured-image');
    if (existingImage) {
      existingImage.remove();
    }
    
    // Create and display new image
    const img = document.createElement('img');
    img.src = imageData;
    img.className = 'captured-image';
    
    // Insert after camera controls
    const cameraWrap = document.querySelector('.camera-wrap');
    cameraWrap.appendChild(img);
  }
  
  // Bind class methods to this instance
  bindMethods() {
    this.init = this.init.bind(this);
    this.checkServerStatus = this.checkServerStatus.bind(this);
    this.bindEventListeners = this.bindEventListeners.bind(this);
    this.handleAddSection = this.handleAddSection.bind(this);
    this.handleConfirmAddSection = this.handleConfirmAddSection.bind(this);
    this.handleSectionClick = this.handleSectionClick.bind(this);
    this.handleSelectInstruments = this.handleSelectInstruments.bind(this);
    this.handleConfirmInstruments = this.handleConfirmInstruments.bind(this);
    this.handleGenerateAudio = this.handleGenerateAudio.bind(this);
    this.handleCreateMix = this.handleCreateMix.bind(this);
    this.handleDeleteSection = this.handleDeleteSection.bind(this);
    this.handlePlaySection = this.handlePlaySection.bind(this);
    this.handleStopPlayback = this.handleStopPlayback.bind(this);
    this.updateUI = this.updateUI.bind(this);
    this.renderSections = this.renderSections.bind(this);
    this.renderSectionEditor = this.renderSectionEditor.bind(this);
    this.closeModals = this.closeModals.bind(this);
    this.updateSectionFromEditor = this.updateSectionFromEditor.bind(this);
    this.updateMixStatusUI = this.updateMixStatusUI.bind(this);
    this.handlePlayAllSections = this.handlePlayAllSections.bind(this);
    this.captureImage = this.captureImage.bind(this); // Ensure this is bound
    this.handleCaptureImage = this.handleCaptureImage.bind(this); // Add explicit binding for the handler
    this.updateSectionStatusInStore = this.updateSectionStatusInStore.bind(this);
    
    // Arduino-related method bindings
    this.initializeArduino = this.initializeArduino.bind(this);
    this.handleConnectArduino = this.handleConnectArduino.bind(this);
    this.sendInfoToArduino = this.sendInfoToArduino.bind(this);
    this.handleArduinoStatus = this.handleArduinoStatus.bind(this);
    this.handleArduinoMessage = this.handleArduinoMessage.bind(this);
    this.startArduinoUpdates = this.startArduinoUpdates.bind(this);
    this.stopArduinoUpdates = this.stopArduinoUpdates.bind(this);
    this.getLedStates = this.getLedStates.bind(this);
    this.processArduinoButtonPress = this.processArduinoButtonPress.bind(this); 
    this.handleInstrumentToggleFromArduino = this.handleInstrumentToggleFromArduino.bind(this);

    this.handleDownloadSection = this.handleDownloadSection.bind(this);
    this.handleClearSections = this.handleClearSections.bind(this);
    this.handleContinuousPlayback = this.handleContinuousPlayback.bind(this);
    this.handleContinuousPlaybackEvent = this.handleContinuousPlaybackEvent.bind(this);
    this.handleAutoMixToggle = this.handleAutoMixToggle.bind(this);
    this.handleMuteToggle = this.handleMuteToggle.bind(this);
    this.showTempMessage = this.showTempMessage.bind(this);
    this.showToastNotification = this.showToastNotification.bind(this);
    this.getNextSectionType = this.getNextSectionType.bind(this);
    this.toggleInstrument = this.toggleInstrument.bind(this); // UI-initiated toggle
    this.handleCaptureAndGenerate = this.handleCaptureAndGenerate.bind(this);
    this.playSoundEffect = this.playSoundEffect.bind(this);
    this.playKeyEffect = this.playKeyEffect.bind(this);
    this.playTransitionEffect = this.playTransitionEffect.bind(this);
    this.showCaptureEffect = this.showCaptureEffect.bind(this);
    this.renderMinimizedSections = this.renderMinimizedSections.bind(this);
  }
  
  // Initialize the application
  async init() {
    console.log('[App] Starting initialization...');
    
    // Check localStorage directly first (debugging)
    if (window.localStorage) {
      const sectionsData = localStorage.getItem('music_generator_sections_metadata');
      console.log('[App] Raw localStorage check:', sectionsData ? 'Data found' : 'No data');
    }
    
    // Check server status
    await this.checkServerStatus();
    
    // Load saved sections from localStorage
    const savedSections = store.loadFromLocalStorage();
    console.log(`[App] Loaded ${savedSections.length} sections from localStorage:`, savedSections);
    
    // If we have saved sections, handle audio restoration
    if (savedSections && savedSections.length > 0) {
      // Make sure the store sections are actually set 
      store.set('sections', savedSections);
      
      // Check for sections with server files
      const sectionsWithServerFiles = savedSections.filter(s => s.serverFileId);
      console.log(`[App] Found ${sectionsWithServerFiles.length} sections with server file references`);
      
      // Update UI elements to reflect loaded settings
      this.elements.genreSelect.value = store.get('genre') || 'pop';
      this.elements.bpmInput.value = store.get('bpm') || 120;
      
      console.log('[App] Successfully restored sections and settings from localStorage');
    } else {
      // Initialize store with default values if no saved sections
      console.log('[App] No saved sections found, using defaults');
    store.set('genre', this.elements.genreSelect.value);
    store.set('bpm', parseInt(this.elements.bpmInput.value, 10));
    store.set('sections', []);
    }
    
    // Initialize section manager
    sectionManager.initialize({
      playerElement: this.elements.audioPlayer
    });
    
    // Bind event listeners and methods first
    this.bindMethods(); // Ensure all methods are bound
    this.bindEventListeners();

    // Initialize Arduino Comms
    this.initializeArduino();

    // Attempt to initialize and start the camera by default
    try {
      await this.initializeCameraDefaultOn(); 
    } catch (error) {
      console.error("Camera initialization failed during init:", error);
      // UI should reflect camera unavailability (e.g., disable capture button)
      if(this.elements.captureBtn) this.elements.captureBtn.disabled = true;
    }
    
    // Initial UI update - this will call renderSections and renderSectionEditor
    this.updateUI(); 
    
    // Initialize continuous playback
    this.initContinuousPlayback();
    
    // Auto-enable continuous playback if there are ready sections
    this.autoEnableContinuousPlayback();
    
    console.log('[App] Initialization complete');
  }
  
  /**
   * Auto-enable continuous playback if we have enough ready sections
   * This provides a better UX by starting playback automatically
   */
  autoEnableContinuousPlayback() {
    const sections = store.get('sections');
    const readySections = sections.filter(section => 
      section.status === 'ready' && sectionManager.audioBuffers.has(section.id)
    );
    
    if (readySections.length >= 2) {
      console.log('[App] Auto-enabling continuous playback');
      
      // First create a mix of all ready sections
      setTimeout(async () => {
        try {
          console.log('[App] Auto-creating mix from ready sections');
          const mixResult = await sectionManager.createSectionMix({ skipPreviewStep: true });
          console.log('[App] Auto-mix created successfully:', mixResult);
          
          // The mix creation will automatically start playback - no need to do anything else
        } catch (error) {
          console.error('[App] Error auto-creating mix:', error);
          
          // Fall back to regular continuous playback if mix creation fails
          if (!sectionManager.continuousPlaybackActive) {
            console.log('[App] Falling back to regular continuous playback after mix creation error');
            try {
              sectionManager.startContinuousPlayback({}, this.handleContinuousPlaybackEvent.bind(this));
              this.updateContinuousPlaybackUI(true);
            } catch (playbackError) {
              console.error('[App] Error starting fallback continuous playback:', playbackError);
            }
          }
        }
      }, 1000);
    } else if (readySections.length > 0) {
      // Even if we just have one section, we can at least play it on loop
      console.log(`[App] Auto-enabling continuous playback with ${readySections.length} ready section(s)`);
      
      setTimeout(() => {
        try {
          sectionManager.startContinuousPlayback({}, this.handleContinuousPlaybackEvent.bind(this));
          this.updateContinuousPlaybackUI(true);
        } catch (error) {
          console.error('[App] Error starting continuous playback with single section:', error);
        }
      }, 1000);
    } else {
      console.log('[App] Not enough ready sections for auto continuous playback');
    }
  }
  
  /**
   * Update UI to reflect continuous playback state
   * @param {boolean} isPlaying - Whether continuous playback is active
   */
  updateContinuousPlaybackUI(isPlaying) {
    // Update button text
    if (this.elements.continuousPlayBtn) {
      this.elements.continuousPlayBtn.textContent = isPlaying 
        ? 'Stop Continuous Playback' 
        : 'Continuous Playback';
      
      this.elements.continuousPlayBtn.className = isPlaying 
        ? this.elements.playAllBtn.className + ' active' 
        : this.elements.playAllBtn.className;
    }
    
    // Show/hide loop count display
    if (this.elements.loopCountDisplay) {
      this.elements.loopCountDisplay.style.display = isPlaying ? 'block' : 'none';
      
      // Reset loop count
      if (isPlaying) {
        const countElement = this.elements.loopCountDisplay.querySelector('strong');
        if (countElement) countElement.textContent = '0';
      }
    }
    
    // Show/hide mix status indicator
    if (this.elements.mixStatusIndicator) {
      this.elements.mixStatusIndicator.style.display = isPlaying ? 'block' : 'none';
      
      // Reset mix status
      if (isPlaying) {
        const statusElement = this.elements.mixStatusIndicator.querySelector('strong');
        if (statusElement) statusElement.textContent = 'idle';
      }
    }
    
    // Disable/enable other playback buttons
    if (this.elements.playAllBtn) {
      this.elements.playAllBtn.disabled = isPlaying;
    }
    
    if (this.elements.playBtn) {
      this.elements.playBtn.disabled = isPlaying;
    }
  }
  
  /**
   * Restore audio for sections loaded from localStorage
   * Note: audioUrl stored in localStorage won't be valid after page reload
   * We need to flag these sections for re-generation if needed
   */
  restoreSectionAudio(sections) {
    // Update UI to reflect loaded settings
    this.elements.genreSelect.value = store.get('genre') || 'pop';
    this.elements.bpmInput.value = store.get('bpm') || 120;
    
    // If there are sections with 'ready' status, they'll need audio regeneration
    const readySections = sections.filter(s => s.status === 'ready');
    if (readySections.length > 0) {
      console.log(`[App] ${readySections.length} sections with status 'ready' will need audio regeneration`);
      // Mark sections as needing regeneration but keep instruments and caption
      readySections.forEach(section => {
        section.status = 'selected'; // Change to 'selected' to indicate audio needs regeneration
        section.audioNeedsRegeneration = true; // Flag for UI to show regeneration prompt
      });
    }
  }
  
  // Check if server is available
  async checkServerStatus() {
    // Try each port until we find the server
    for (const port of SERVER_CONFIG.BASE_PORTS) {
      try {
        console.log(`Checking server on port ${port}...`);
        const response = await fetch(`http://localhost:${port}/health`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          // Short timeout to quickly move to next port if this one doesn't respond
          signal: AbortSignal.timeout(1000) 
        });
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.status === 'healthy') {
            // Found working server, save the port
            SERVER_CONFIG.currentPort = port;
            console.log(`Server found on port ${port}`);
            
            this.elements.serverStatus.className = 'server-status healthy';
            this.elements.statusIndicator.className = 'status-indicator green';
            this.elements.statusText.textContent = `Server is online and healthy (port ${port})`;
            this.state.serverAvailable = true;
            break;
          }
        }
      } catch (error) {
        // Ignore errors and try next port
        console.log(`Server not available on port ${port}`);
      }
    }
    
    // If we couldn't find the server on any port
    if (!SERVER_CONFIG.currentPort) {
      this.elements.serverStatus.className = 'server-status error';
      this.elements.statusIndicator.className = 'status-indicator red';
      this.elements.statusText.textContent = 'Server is offline or unreachable on any port';
      this.state.serverAvailable = false;
      console.error('Error connecting to server: No available server found');
    }
    
    // Update UI based on server availability
    this.elements.createMixBtn.disabled = !this.state.serverAvailable;
  }
  
  // Bind event listeners to elements
  bindEventListeners() {
    // Main controls
    this.elements.addSectionBtn.addEventListener('click', this.handleAddSection);
    this.elements.createMixBtn.addEventListener('click', this.handleCreateMix);
    
    // Add clear sections button event listener
    if (this.elements.clearSectionsBtn) {
      this.elements.clearSectionsBtn.addEventListener('click', this.handleClearSections);
    }
    
    // Camera controls - Fix the handler here
    if (this.elements.captureBtn) {
      this.elements.captureBtn.addEventListener('click', this.handleCaptureImage);
    }
    
    // Section modal
    this.elements.confirmAddSectionBtn.addEventListener('click', this.handleConfirmAddSection);
    
    // Instrument selection - auto-apply without requiring confirmation
    if (this.elements.instrumentGridEditor) {
      // Add event listeners to instrument options for automatic selection
      this.setupAutoInstrumentSelection();
    }
    
    // Section editor
    this.elements.generateBtn.addEventListener('click', this.handleGenerateAudio);
    this.elements.deleteSectionBtn.addEventListener('click', this.handleDeleteSection);
    this.elements.playBtn.addEventListener('click', this.handlePlaySection);
    this.elements.stopBtn.addEventListener('click', this.handleStopPlayback);
    
    // Mix controls
    this.elements.downloadMixBtn.addEventListener('click', () => {
      if (this.elements.audioPlayer.src) {
        window.open(this.elements.audioPlayer.src, '_blank');
      }
    });
    
    this.elements.createFinalMixBtn.addEventListener('click', async () => {
      const tonnTaskId = this.elements.createFinalMixBtn.dataset.tonnTaskId || 
                        (sectionManager.mixData && sectionManager.mixData.tonnTaskId);
      
      if (!tonnTaskId) {
        console.error("[App] No Tonn task ID available for final mix");
        alert("No preview mix task ID found. Please create a preview mix first.");
        return;
      }
      
      console.log(`[App] Creating final mix from Tonn preview task: ${tonnTaskId}`);
      
        try {
        this.updateMixStatusUI('processing', 'Creating high-quality final mix...', 50);
        const finalMix = await api.createFinalMix(tonnTaskId);
        
        if (finalMix.status === 'COMPLETED' || finalMix.status === 'completed') {
          this.updateMixStatusUI('completed', 'High-quality professional mix ready!', 100);
          
          // Update UI for the new mix
          if (this.elements.audioPlayer && finalMix.download_url) {
            this.elements.audioPlayer.src = finalMix.download_url;
            this.elements.audioPlayer.load();
            this.elements.audioPlayerContainer.style.display = 'block';
            
            // Try to autoplay (may be blocked by browser)
            this.elements.audioPlayer.play().catch(e => console.log('Auto-play prevented by browser:', e));
          }
          
          // Update download button
          if (this.elements.downloadMixBtn) {
            this.elements.downloadMixBtn.disabled = false;
            this.elements.downloadMixBtn.onclick = () => {
              const a = document.createElement('a');
              a.href = finalMix.download_url;
              a.download = `tonn_final_mix_${Date.now()}.wav`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            };
          }
        } else {
          this.updateMixStatusUI('processing', `Final mix in progress: ${finalMix.status}`, 50);
          
          // Start polling for final mix status
          // In a real implementation, you would poll the server for updates
          const checkStatus = async () => {
            try {
              const status = await api.checkMixStatus(finalMix.task_id);
              if (status.status === 'COMPLETED' || status.status === 'completed') {
                this.updateMixStatusUI('completed', 'High-quality professional mix ready!', 100);
                if (this.elements.audioPlayer && status.download_url) {
                  this.elements.audioPlayer.src = status.download_url;
                  this.elements.audioPlayer.load();
                }
              } else if (status.status === 'FAILED' || status.status === 'ERROR' || status.status === 'error') {
                this.updateMixStatusUI('error', `Error: ${status.error || 'Final mix failed'}`, 0);
              } else {
                // Still processing, poll again after a delay
                setTimeout(checkStatus, 2000);
          }
        } catch (error) {
              console.error("Error checking final mix status:", error);
              this.updateMixStatusUI('error', `Error checking mix status: ${error.message}`, 0);
            }
          };
          
          // Start polling
          setTimeout(checkStatus, 2000);
        }
      } catch (error) {
          console.error('Error creating final mix:', error);
        this.updateMixStatusUI('error', `Error: ${error.message}`, 0);
      }
    });
    
    // Close modals
    document.querySelectorAll('.close-btn, .cancel-btn').forEach(elem => {
      elem.addEventListener('click', this.closeModals);
    });
    
    // Settings change
    this.elements.genreSelect.addEventListener('change', () => {
      store.set('genre', this.elements.genreSelect.value);
    });
    
    this.elements.bpmInput.addEventListener('change', () => {
      store.set('bpm', parseInt(this.elements.bpmInput.value, 10));
    });
    
    // Update section from editor changes
    this.elements.sectionTypeSelect.addEventListener('change', this.updateSectionFromEditor);
    this.elements.sectionDescription.addEventListener('blur', this.updateSectionFromEditor);
    
    // Listen for continuous playback started events
    window.addEventListener('continuous-playback-started', (event) => {
      console.log('[App] Detected continuous playback started:', event.detail);
      this.updateContinuousPlaybackUI(true);
    });
    
    // Listen for mix status updates
    window.addEventListener('mix-status-update', (event) => {
      const mixData = event.detail;
      console.log("[App] Mix status update received:", mixData);
      
      // Update progress
      this.elements.mixProgress.value = mixData.progress || 0;
      
      // Check for Tonn mixing or mastering status
      if (mixData.status === 'tonn_mixing' || 
          mixData.status === 'tonn_mastering' ||
          mixData.status === 'tonn_mixing_requested' ||
          mixData.status === 'tonn_mastering_requested') {
      this.updateMixStatusUI(
        mixData.status,
          mixData.message || 'Professional audio processing in progress...',
          mixData.progress || 80
      );
      
        // Update the Tonn mix status indicator
        if (this.elements.mixStatusIndicator) {
          const statusElement = this.elements.mixStatusIndicator.querySelector('strong');
          if (statusElement) statusElement.textContent = 'Processing audio';
        }
        
        // Show the create final mix button if we have a Tonn task ID
        if (this.elements.createFinalMixBtn && mixData.tonnTaskId) {
          this.elements.createFinalMixBtn.style.display = 'inline-block';
          this.elements.createFinalMixBtn.dataset.tonnTaskId = mixData.tonnTaskId;
        }
        
        return;
  }
  
      // If this is a Tonn mix or master ready notification
      if (mixData.status === 'tonn_mix_ready' || 
          mixData.status === 'tonn_mastering_completed') {
        
        const isMastered = mixData.status === 'tonn_mastering_completed' || mixData.mixType === 'mastered';

        // Add a visual flash to the mix status indicator to draw attention
        const mixStatus = this.elements.mixStatus;
        if (mixStatus) {
          // First, add a highlight class
          mixStatus.classList.add('highlight-complete');
    
          // Remove it after a short delay to create a flash effect
          setTimeout(() => {
            mixStatus.classList.remove('highlight-complete');
          }, 1000);
        }
        
        this.updateMixStatusUI(
          'completed',
          isMastered ? 
            'Professional mastering completed successfully!' : 
            'Professional mix completed successfully!',
          100
        );
        
        // Only show audio player if continuous playback is NOT active
        // If continuous playback is active, the mastered audio should transition seamlessly
        if (!sectionManager.continuousPlaybackActive) {
          // Update the audio player
          if (this.elements.audioPlayerContainer) {
            this.elements.audioPlayerContainer.style.display = 'block';
          }
          
          if (this.elements.audioPlayer && mixData.downloadUrl) {
            // Ensure the download URL is properly resolved
            const resolvedUrl = (mixData.downloadUrl.startsWith('http') || mixData.downloadUrl.startsWith('/'))
              ? mixData.downloadUrl
              : api.resolveApiUrl ? api.resolveApiUrl(mixData.downloadUrl) : mixData.downloadUrl;
            
            console.log(`[App] Using resolved URL for professional audio: ${resolvedUrl}`);
            
            this.elements.audioPlayer.src = resolvedUrl;
            this.elements.audioPlayer.load();
        
            // Try to autoplay (may be blocked by browser policies)
            this.elements.audioPlayer.play().catch(e => {
              console.log('Auto-play prevented by browser, user must click play');
            });
          }
        } else {
          console.log('[App] Continuous playback active, not showing standalone audio player');
          // Hide the audio player container since continuous playback will handle the audio
          if (this.elements.audioPlayerContainer) {
            this.elements.audioPlayerContainer.style.display = 'none';
          }
        }
        
        // Update the mix status indicator
        if (this.elements.mixStatusIndicator) {
          const statusElement = this.elements.mixStatusIndicator.querySelector('strong');
          if (statusElement) {
            statusElement.textContent = isMastered ? 
              'professional master ready' : 
              'professional mix ready';
            
            // Make the status indicator flash to draw attention
            statusElement.classList.add('status-highlight');
            setTimeout(() => {
              statusElement.classList.remove('status-highlight');
            }, 2000);
          }
        }
        
      return;
    }

      // Regular mix status updates (non-Tonn)
      this.updateMixStatusUI(
        mixData.status,
        mixData.status === 'completed' ? 'Mix completed successfully!' : 
        mixData.status === 'error' ? `Error: ${mixData.error}` : 
        'Processing sections...',
        mixData.progress || 0
      );
      
      // If completed, show player only if continuous playback is not active
      if (mixData.status === 'completed' && mixData.downloadUrl) {
        if (!sectionManager.continuousPlaybackActive) {
          this.elements.audioPlayerContainer.style.display = 'block';
          
          // Ensure the download URL is properly resolved
          const resolvedUrl = (mixData.downloadUrl.startsWith('http') || mixData.downloadUrl.startsWith('/'))
            ? mixData.downloadUrl
            : api.resolveApiUrl ? api.resolveApiUrl(mixData.downloadUrl) : mixData.downloadUrl;
          
          this.elements.audioPlayer.src = resolvedUrl;
          this.elements.audioPlayer.load();
        } else {
          console.log('[App] Continuous playback active, not showing standalone audio player');
          // Hide the audio player container
          this.elements.audioPlayerContainer.style.display = 'none';
        }
      }
    });

    // Listen for continuous playback info events
    window.addEventListener('continuous-playback-info', (event) => {
      console.log('[App] Continuous playback info event:', event.detail);
      
      // Show the info message in the mix status indicator
      if (this.elements.mixStatusIndicator) {
        const statusElement = this.elements.mixStatusIndicator.querySelector('strong');
        if (statusElement) {
          statusElement.textContent = event.detail.message || 'info event';
          
          // Add a visual indicator for fallback
          if (event.detail.type === 'info') {
            statusElement.style.color = '#1976d2'; // Blue for info
          } else if (event.detail.type === 'warning') {
            statusElement.style.color = '#f57c00'; // Orange for warning
          } else if (event.detail.type === 'error') {
            statusElement.style.color = '#d32f2f'; // Red for error
          } else {
            statusElement.style.color = ''; // Reset color
          }
          
          // Reset color after a few seconds
          setTimeout(() => {
            statusElement.style.color = '';
          }, 5000);
        }
      }
    });

    // Listen for the new auto-mix-triggered event
    window.addEventListener('auto-mix-triggered', (event) => {
      console.log('[App] Auto-mix triggered:', event.detail);

      // Update the mix status indicator
      if (this.elements.mixStatusIndicator) {
        const statusElement = this.elements.mixStatusIndicator.querySelector('strong');
        if (statusElement) {
          statusElement.textContent = `auto-mixing ${event.detail.sectionCount} sections...`;
          
          // Add a visual indicator for active processing
          statusElement.classList.add('processing');
          
          // Remove the class after a timeout
          setTimeout(() => {
            statusElement.classList.remove('processing');
          }, 3000);
        }
      }
    });

    // Listen for section-audio-ready event
    window.addEventListener('section-audio-ready', (event) => {
      console.log('[App] Section audio ready:', event.detail);
      
      // Flash the section in the list if possible
      const sectionItem = document.querySelector(`.section-item[data-id="${event.detail.sectionId}"]`);
      if (sectionItem) {
        sectionItem.classList.add('highlight-ready');
        setTimeout(() => {
          sectionItem.classList.remove('highlight-ready');
        }, 1000);
    }
    });
  }
  
  // Handle playing all sections in sequence
  async handlePlayAllSections() {
    console.log("[PlayAll] Attempting to play all ready sections.");
    const sections = store.get('sections');
    const readySections = sections.filter(section => section.status === 'ready' && section.audioUrl);

    if (readySections.length === 0) {
      alert('No sections with generated audio found and ready to play.');
      console.log("[PlayAll] No ready sections to play.");
      return;
    }

    const sectionIds = readySections.map(section => section.id);
    console.log(`[PlayAll] Playing ${sectionIds.length} sections:`, sectionIds);

    if (this.elements.playAllBtn) {
      this.elements.playAllBtn.disabled = true;
      this.elements.playAllBtn.textContent = 'Playing...';
    }

    try {
      await sectionManager.playSequence(sectionIds, (eventType, eventData) => {
        console.log(`[PlayAll] Event from SectionManager: ${eventType}`, eventData || '');
        if (eventType === 'playback_ended') {
          if (this.elements.playAllBtn) {
            this.elements.playAllBtn.disabled = false;
            this.elements.playAllBtn.textContent = 'Play All Sections';
          }
          console.log("[PlayAll] Sequence playback ended.");
        } else if (eventType === 'error') {
          const errorMessage = eventData?.message || "Unknown playback error";
          console.error("[PlayAll] Error during sequence playback from SectionManager:", errorMessage);
          alert(`Error during playback: ${errorMessage}`);
          if (this.elements.playAllBtn) {
            this.elements.playAllBtn.disabled = false;
            this.elements.playAllBtn.textContent = 'Play All Sections';
          }
        }
        if (eventType === 'playback_started' || eventType === 'playback_ended' || eventType === 'section_changed') {
          this.sendInfoToArduino();
        }
      });
    } catch (error) {
      console.error('[PlayAll] Error calling sectionManager.playSequence:', error);
      alert(`Error initiating playback of sections: ${error.message}`);
      if (this.elements.playAllBtn) {
        this.elements.playAllBtn.disabled = false;
        this.elements.playAllBtn.textContent = 'Play All Sections';
      }
      this.sendInfoToArduino();
    }
  }
  
  // Handle section deletion
  handleDeleteSection() {
    // Get current section
    const section = this.getCurrentSection();
    if (!section) return;
    
    if (confirm(`Are you sure you want to delete this section?`)) {
      sectionManager.deleteSection(section.id);
      
      // Update UI
      this.renderSections();
      this.renderSectionEditor();
      
      // Enable creating mix if we have sections
      this.updateCreateMixButton();
    }
  }
  
  // Handle playing a section
  handlePlaySection() {
    // Get current section
    const section = this.getCurrentSection();
    if (!section || !section.audioUrl || section.status !== 'ready') {
      alert('No audio available to play. Generate audio first.');
      return;
    }
    
    // Create audio element if not exists
    if (!this.audioPlayer) {
      this.audioPlayer = new Audio();
      this.audioPlayer.addEventListener('ended', this.handleStopPlayback);
    }
    
    // Stop any currently playing audio
    if (this.audioPlayer.src) {
      this.audioPlayer.pause();
      this.audioPlayer.currentTime = 0;
    }
    
    // Set the source and play
    this.audioPlayer.src = section.audioUrl;
    this.audioPlayer.play().catch(error => {
      console.error('Error playing audio:', error);
      alert('Error playing audio. Please try again.');
    });
    
    // Update button states
    this.elements.playBtn.disabled = true;
    this.elements.stopBtn.disabled = false;
    
    // TODO: In the future, connect to visualizer
    this.sendInfoToArduino();
  }
  
  // Handle stopping playback
  handleStopPlayback() {
    // Stop audio if playing
    if (this.audioPlayer && this.audioPlayer.src) {
      this.audioPlayer.pause();
      this.audioPlayer.currentTime = 0;
    }
    
    // Update button states
    this.elements.playBtn.disabled = false;
    this.elements.stopBtn.disabled = true;
    
    // TODO: In the future, stop visualizer
    this.sendInfoToArduino();
  }
  
  /**
   * Update the UI to reflect current application state
   */
  updateUI() {
    this.renderSections();
    
    // Update global settings
    this.elements.genreSelect.value = store.get('genre') || 'pop';
    this.elements.bpmInput.value = store.get('bpm') || 120;
    
    // Update create mix button
    this.updateCreateMixButton();
  }
  
  /**
   * Update the create mix button state
   */
  updateCreateMixButton() {
    const sections = store.get('sections') || [];
    const hasReadySections = sections.some(section => section.status === 'ready');
    this.elements.createMixBtn.disabled = !hasReadySections || !this.state.serverAvailable;
  }
  
  /**
   * Render the sections list
   */
  renderSections() {
    const sections = store.get('sections') || [];
    const list = this.elements.sectionList;
    
    // Clear the list
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
    
    // Show/hide placeholder
    this.elements.noSectionsPlaceholder.style.display = sections.length > 0 ? 'none' : 'block';
    
    // Create section items
    sections.forEach(section => {
      const item = document.createElement('li');
      item.className = 'section-item';
      if (section.id === this.state.currentSectionId) {
        item.className += ' active';
      }
      item.dataset.id = section.id;
      
      // Add thumbnail element for captured image
      const thumbHtml = section.capturedImage ? 
        `<div class="section-thumb"><img src="${section.capturedImage}" alt="${section.type}"></div>` :
        `<div class="section-thumb"><div class="section-thumb-placeholder">${section.type.charAt(0).toUpperCase()}</div></div>`;
      
      // Set section content
      item.innerHTML = `
        ${thumbHtml}
        <div class="section-header">
          <h4 class="section-title">${section.type.charAt(0).toUpperCase() + section.type.slice(1)}</h4>
          <span class="status-tag ${section.status}">${section.status}</span>
        </div>
        <div class="instruments-list">
          ${section.instruments && section.instruments.length > 0 
            ? section.instruments.map(instrument => 
                `<span class="instrument-tag">${instrument}</span>`
              ).join('') 
            : '<span class="instrument-tag">No instruments</span>'}
        </div>
      `;
      
      // Add click handler
      item.addEventListener('click', () => this.handleSectionClick(section.id));
      
      // Add to list
      list.appendChild(item);
    });
    
    // Initialize or update minimized sections view
    this.renderMinimizedSections();
    
    this.sendInfoToArduino(); // Update Arduino after rendering sections
  }
  
  /**
   * Render the section editor for the current section
   */
  renderSectionEditor() {
    const section = this.getCurrentSection();
    
    if (!section) {
      this.elements.editorPlaceholder.style.display = 'block';
      this.elements.sectionEditor.style.display = 'none';
      this.elements.mixContainer.style.display = 'none';
      if (this.elements.downloadSectionBtn) this.elements.downloadSectionBtn.disabled = true;
      return;
    }
    
    this.elements.editorPlaceholder.style.display = 'none';
    this.elements.sectionEditor.style.display = 'block';
    this.elements.mixContainer.style.display = 'none';
    
    this.elements.sectionTypeSelect.value = section.type;
    
    if (section.caption && section.caption.description) {
      this.elements.sectionDescription.value = 
        `${section.caption.description}\\n\\nMood: ${section.caption.mood || 'N/A'}\\nGenre: ${section.caption.genre || 'N/A'}\\nBPM: ${section.caption.bpm || 'N/A'}`;
    } else {
      this.elements.sectionDescription.value = section.description || '';
    }
    
    // Display captured image if available
    if (section.capturedImage) {
      this.displayCapturedImage(section.capturedImage);
    } else {
      // Remove any existing captured image
      const existingImage = document.querySelector('.captured-image');
      if (existingImage) {
        existingImage.remove();
      }
    }
    
    this.renderInstrumentOptions();

    this.elements.visualizerContainer.style.display = section.status === 'ready' ? 'block' : 'none';
    this.elements.generateBtn.disabled = !section.instruments || section.instruments.length === 0;
    this.elements.playBtn.disabled = section.status !== 'ready' || !section.audioUrl;
    this.elements.stopBtn.disabled = true;
    if (this.elements.downloadSectionBtn) {
      this.elements.downloadSectionBtn.disabled = section.status !== 'ready' || !section.audioUrl;
    }
    
    // Show a regeneration notice if needed
    if (section.audioNeedsRegeneration) {
      const cameraWrap = document.querySelector('.camera-wrap');
      if (cameraWrap) {
        const notice = document.createElement('div');
        notice.className = 'regeneration-notice';
        notice.style.padding = '10px';
        notice.style.backgroundColor = '#fff8e1';
        notice.style.borderRadius = '4px';
        notice.style.marginTop = '10px';
        notice.style.color = '#f57c00';
        notice.style.fontWeight = 'bold';
        notice.innerHTML = 'Audio needs regeneration. Please click "Generate Audio".';
        
        // Check if notice already exists
        if (!cameraWrap.querySelector('.regeneration-notice')) {
          cameraWrap.appendChild(notice);
        }
      }
    }
  }
  
  /**
   * Close all modals
   */
  closeModals() {
    document.querySelectorAll('.modal.show').forEach(modal => {
      if (modal.id !== 'instruments-modal') {
        modal.classList.remove('show');
      }
    });
  }
  
  /**
   * Update section data from editor fields
   */
  updateSectionFromEditor() {
    const section = this.getCurrentSection();
    if (!section) return;
    
    // Get values from editor
    const type = this.elements.sectionTypeSelect.value;
    const description = this.elements.sectionDescription.value;
    
    // Update section in store
    const sections = store.get('sections');
    const index = sections.findIndex(s => s.id === section.id);
    
    if (index !== -1) {
      const updatedSection = {
        ...sections[index],
        type,
        description
      };
      
      const updatedSections = [...sections];
      updatedSections[index] = updatedSection;
      
      store.set('sections', updatedSections);
    }
  }
  
  /**
   * Update mix status display
   * @param {string} status - Status type (processing, completed, error, stitching_local, completed_local)
   * @param {string} message - Status message
   * @param {number} progressValue - Progress value (0-100)
   */
  updateMixStatusUI(status, message, progressValue) {
    // First ensure mix container is visible
    if (this.elements.mixContainer) {
        this.elements.mixContainer.style.display = 'block';
        console.log(`Mix container visibility set to 'block'`);
    }
    
    if (this.elements.mixStatus && this.elements.mixStatusText && this.elements.mixProgress) {
        this.elements.mixStatus.className = `mix-status ${status}`;
        this.elements.mixStatusText.textContent = message;
        this.elements.mixProgress.value = progressValue;
        
        // For completed status, add an extra visual indicator
        if (status === 'completed' || status === 'completed_local') {
          // Add a flash animation class
          this.elements.mixStatus.classList.add('complete-flash');
          
          // Remove it after animation completes
          setTimeout(() => {
            this.elements.mixStatus.classList.remove('complete-flash');
          }, 1500);
        }
        
        // Show/hide player & download based on status
        const isCompleted = status === 'completed' || status === 'completed_local';
        if (this.elements.audioPlayerContainer) {
            // Only show player if not in continuous playback mode
            const shouldShowPlayer = isCompleted && !sectionManager.continuousPlaybackActive;
            this.elements.audioPlayerContainer.style.display = shouldShowPlayer ? 'block' : 'none';
            console.log(`Audio player container display: ${shouldShowPlayer ? 'block' : 'none'}`);
        }
        if (this.elements.downloadMixBtn) {
            this.elements.downloadMixBtn.disabled = !isCompleted;
        }
    } else {
        console.warn("Mix status UI elements not found for update.");
    }
     // Update global store for other components that might react to mix status
    store.set('currentMixStatus', { status, message, progress: progressValue });
  }
  
  renderInstrumentOptions() {
    const grid = this.elements.instrumentGridEditor;
    if (!grid) {
        console.warn("#instrument-grid-editor not found in DOM for rendering options.");
        return;
    }
    grid.innerHTML = ''; 

    // New simplified instrument list
    const instruments = [
      { id: 'drums', name: 'Drums', desc: 'Rhythm & Percussion' },
      { id: 'bass', name: 'Bass', desc: 'Low Frequencies' },
      { id: 'guitar', name: 'Guitar', desc: 'Electric or Acoustic' },
      { id: 'keys_synth', name: 'Keys/Synth', desc: 'Piano, Synth sounds' }, // Combined option
    ];

    const currentSection = this.getCurrentSection();
    const selectedInstrumentsFromStore = currentSection?.instruments || [];

    instruments.forEach(instrument => {
      const option = document.createElement('div');
      option.className = 'instrument-option';
      if (selectedInstrumentsFromStore.includes(instrument.id)) {
        option.classList.add('selected');
      }
      option.dataset.id = instrument.id; // Use the id for storing/sending
      option.innerHTML = `
        <div class="instrument-name">${instrument.name}</div>
        <div class="instrument-desc">${instrument.desc}</div>
      `;
      option.addEventListener('click', () => this.handleInstrumentOptionAutoClick(option));
      grid.appendChild(option);
    });
  }

  handleInstrumentOptionAutoClick(optionElement) {
    const section = this.getCurrentSection();
    if (!section) return;
    
    const instrumentId = optionElement.dataset.id;
    if (!instrumentId) return;
    
    // Toggle selection state
    const isSelected = optionElement.classList.toggle('selected');
    
    // Get all currently selected instruments
    const selectedOptions = this.elements.instrumentGridEditor.querySelectorAll('.instrument-option.selected');
    const selectedInstruments = Array.from(selectedOptions).map(opt => opt.dataset.id);
    
    // Limit to max 3 instruments - if we have too many, deselect this one and return
    if (selectedInstruments.length > 3) {
      optionElement.classList.remove('selected');
      this.showTempMessage(`Maximum 3 instruments allowed`);
      return;
    }
    
    // Update the section with the new instruments
    this.updateSectionStatusInStore(section.id, {
      instruments: selectedInstruments,
      status: 'selected'
    });
    
    // Update UI
    this.renderSections();
    
    // Flash feedback message
    this.showTempMessage(`${instrumentId} ${isSelected ? 'added' : 'removed'}`);
    
    // Update Arduino
    this.sendInfoToArduino();
  }

  handleConfirmInstruments() {
    const currentSection = this.getCurrentSection();
    if (!currentSection) {
        console.warn("No current section to confirm instruments for.");
        return;
    }

    const grid = this.elements.instrumentGridEditor;
    if (!grid) {
        console.error("#instrument-grid-editor not found during confirm.");
        return;
    }
    const selectedOptions = grid.querySelectorAll('.instrument-option.selected');
    const newSelectedInstruments = Array.from(selectedOptions).map(opt => opt.dataset.id);

    if (newSelectedInstruments.length === 0 || newSelectedInstruments.length > 3) {
      alert('Please select 1 to 3 instruments to apply.');
      return;
    }

    const sections = store.get('sections');
    const index = sections.findIndex(s => s.id === currentSection.id);

    if (index !== -1) {
      const updatedSection = {
        ...sections[index],
        instruments: newSelectedInstruments,
        status: 'selected'
      };
      
      const updatedSections = [...sections];
      updatedSections[index] = updatedSection;
      
      store.set('sections', updatedSections);
      console.log('Instruments applied to section:', currentSection.id, newSelectedInstruments);
      
      this.renderSections();
      this.renderSectionEditor();
    } else {
        console.warn("Could not find current section in store to update instruments.");
    }
    this.sendInfoToArduino(); // Update Arduino after confirming instruments
  }

  /**
   * Helper to update a specific section's properties in the store.
   * @param {string} sectionId - The ID of the section to update.
   * @param {object} updates - An object containing properties to update.
   */
  updateSectionStatusInStore(sectionId, updates) {
    if (!sectionId || !updates) return;
    const sections = store.get('sections');
    const index = sections.findIndex(s => s.id === sectionId);

    if (index !== -1) {
      const updatedSection = {
        ...sections[index],
        ...updates
      };
      const updatedSections = [...sections];
      updatedSections[index] = updatedSection;
      store.set('sections', updatedSections);
      console.log(`[App.updateSectionStatusInStore] Section ${sectionId} updated in store with:`, updates);
      // Optionally, re-render if needed, though store.notify() should trigger updateUI
      // this.renderSections(); 
      // this.renderSectionEditor(); 
    } else {
      console.warn(`[App.updateSectionStatusInStore] Section ${sectionId} not found in store.`);
    }
  }

  // --- Arduino Integration Methods ---
  initializeArduino() {
    if (this.elements.connectArduinoBtn) {
        this.elements.connectArduinoBtn.addEventListener('click', this.handleConnectArduino);
    }
    
    // Set up callbacks for Arduino status and messages
    hw.onStatus(this.handleArduinoStatus);
    hw.onMessage(this.handleArduinoMessage);
    
    // Try to auto-connect to Arduino
    console.log("[App] Attempting automatic Arduino connection...");
    hw.autoConnect().then(connected => {
      if (connected) {
        console.log("[App] Auto-connected to Arduino successfully");
        this.state.arduinoConnected = true;
        if (this.elements.connectArduinoBtn) {
          this.elements.connectArduinoBtn.textContent = 'Disconnect Arduino';
        }
        if (this.elements.arduinoStatusText) {
          this.elements.arduinoStatusText.textContent = 'Arduino: Connected';
        }
        
        // Send initial data
        this.sendInfoToArduino();
        this.startArduinoUpdates();
      } else {
        console.log("[App] Automatic Arduino connection failed, manual connection required");
        // Manual connection will be required
        this.state.arduinoConnected = false;
        if (this.elements.connectArduinoBtn) {
          this.elements.connectArduinoBtn.textContent = 'Connect Arduino';
        }
        if (this.elements.arduinoStatusText) {
          this.elements.arduinoStatusText.textContent = 'Arduino: Not Connected';
        }
      }
    });
  }

  async handleConnectArduino() {
    if (this.state.arduinoConnected) {
      await hw.disconnect();
      // onStatus callback will handle UI updates for disconnection
    } else {
      // Use the auto-reconnect feature for more stability
      const connected = await hw.connect({ autoReconnect: true });
      if (connected) {
        // UI update for connection status is handled by onStatus callback
        // Send initial state upon connection
        this.sendInfoToArduino();
      } else {
        // Handle connection failure explicitly 
        if (this.elements.arduinoStatusText) {
            this.elements.arduinoStatusText.textContent = 'Arduino: Connection Failed';
        }
        this.state.arduinoConnected = false;
        if (this.elements.connectArduinoBtn) {
            this.elements.connectArduinoBtn.textContent = 'Connect Arduino';
        }
      }
    }
  }

  handleArduinoStatus(statusMessage) {
    console.log("[Arduino Status]:", statusMessage);
    if (this.elements.arduinoStatusText) {
      this.elements.arduinoStatusText.textContent = `Arduino: ${statusMessage}`;
    }
    
    // Update connection state based on hardware module's state
    const wasConnected = this.state.arduinoConnected;
    this.state.arduinoConnected = hw.getConnectionStatus();
    
    if (this.elements.connectArduinoBtn) {
        this.elements.connectArduinoBtn.textContent = this.state.arduinoConnected ? 'Disconnect Arduino' : 'Connect Arduino';
    }
    
    // Handle connection/disconnection changes
    if (this.state.arduinoConnected && !wasConnected) {
        // Just connected
        this.startArduinoUpdates();
        this.showTempMessage("Arduino connected");
        
        // Send initial state after a short delay to ensure Arduino is ready
        setTimeout(() => {
          this.sendInfoToArduino();
        }, 500);
    } else if (!this.state.arduinoConnected && wasConnected) {
        // Just disconnected
        this.stopArduinoUpdates();
        this.showTempMessage("Arduino disconnected");
    }
  }
  
  handleArduinoMessage(data) {
    console.log("[Arduino Message]:", data);
    
    // Handle JSON message with button press (legacy or simple button ID)
    if (data && typeof data.btn !== 'undefined' && typeof data.action === 'undefined') {
        this.processArduinoButtonPress(data.btn); // Assuming this handles simple button IDs
        return;
    }
    
    // Handle specific action messages from Arduino
    if (data && data.action) {
      switch(data.action) {
        case 'instrument_toggle':
          if (typeof data.instrument_index !== 'undefined' && typeof data.selected !== 'undefined') {
            this.handleInstrumentToggleFromArduino(data.instrument_index, data.selected);
          } else {
            console.warn("Invalid instrument_toggle message from Arduino:", data);
          }
          break;
        case 'mute':
          const muted = data.muted !== undefined ? data.muted : !sectionManager.isMuted();
          sectionManager.setMuted(muted);
          this.showTempMessage(muted ? "Audio Muted" : "Audio Unmuted");
          this.sendInfoToArduino(); 
          break;
        case 'clear_all':
          this.handleClearSections();
          break;
        case 'capture':
          this.handleCaptureAndGenerate();
          break;
        case 'sound_effect':
          sectionManager.playSoundEffect(data.type || 'key');
          this.showTempMessage(`Playing ${data.type || 'key'} effect`);
          break;
        // Handle other Arduino actions if needed
        default:
          console.log("[App] Received unhandled Arduino action:", data.action, data);
      }
    } else if (data && data.status === 'arduino_connect_attempt') {
      // This is handled by hw.js now, but good to log if it still comes through here
      console.log("[App] Arduino connection attempt signal received.");
    } else if (data && data.text) {
        // Plain text message from Arduino (e.g., debug messages)
        console.log("[Arduino Text]:", data.text);
    }
  }

  handleInstrumentToggleFromArduino(instrumentIndex, isSelected) {
    const currentSection = this.getCurrentSection();
    // If no section is selected in the UI, we could either select the first one
    // or simply log that the Arduino tried to toggle an instrument for a non-selected section.
    if (!currentSection) {
      console.log(`[App] Arduino toggled instrument ${instrumentIndex} but no section is active in UI.`);
      // Auto-select the first section or create one if none exist
      const sections = store.get('sections');
      if (sections && sections.length > 0) {
        // Auto-select the first section
        this.state.currentSectionId = sections[0].id;
        this.renderSections();
        this.renderSectionEditor();
        const selectedSection = this.getCurrentSection();
        if (selectedSection) {
          this.showTempMessage(`Auto-selected first section`);
          // Now continue with the instrument toggle
          this.handleInstrumentToggleFromArduino(instrumentIndex, isSelected);
          return;
        } else {
          this.showTempMessage(`Failed to auto-select section`);
          return;
        }
      } else {
        // Create a new section since none exists
        const newSection = sectionManager.addSection('verse');
        this.state.currentSectionId = newSection.id;
        this.renderSections();
        this.renderSectionEditor();
        this.showTempMessage(`Created new section`);
        // Now continue with the instrument toggle
        this.handleInstrumentToggleFromArduino(instrumentIndex, isSelected);
        return;
      }
    }

    const instrumentMap = ['drums', 'bass', 'guitar', 'keys_synth'];
    const instrumentId = instrumentMap[instrumentIndex];
    if (!instrumentId) {
      console.warn("[App] Invalid instrument index from Arduino:", instrumentIndex);
      return;
    }

    let currentInstruments = currentSection.instruments ? [...currentSection.instruments] : [];
    const isCurrentlySelectedInApp = currentInstruments.includes(instrumentId);

    if (isSelected && !isCurrentlySelectedInApp) {
      if (currentInstruments.length < 3) {
        currentInstruments.push(instrumentId);
      } else {
        this.showTempMessage(`Max 3 instruments allowed`);
        return;
      }
    } else if (!isSelected && isCurrentlySelectedInApp) {
      currentInstruments = currentInstruments.filter(inst => inst !== instrumentId);
    }
    
    // If states already match, do nothing
    if ((isSelected && isCurrentlySelectedInApp) || (!isSelected && !isCurrentlySelectedInApp)) {
      return;
    }

    // Ensure instruments are not duplicated
    currentInstruments = [...new Set(currentInstruments)];

    // Update section in store - always apply immediately
    this.updateSectionStatusInStore(currentSection.id, {
      instruments: currentInstruments,
      status: 'selected'
    });

    // Update UI
    this.renderSectionEditor();
    this.renderSections();
    this.showTempMessage(`${instrumentId} ${isSelected ? 'ON' : 'OFF'} (Arduino)`);
    
    // Send a full update back to Arduino
    this.sendInfoToArduino();
  }

  processArduinoButtonPress(buttonId) {
    console.log(`Arduino Button ${buttonId} pressed and processed by app.`);
    
    const currentSection = this.getCurrentSection();

    // Buttons 0-3 for instrument selection
    const instrumentMap = ['drums', 'bass', 'guitar', 'keys_synth'];

    if (buttonId >= 0 && buttonId < instrumentMap.length) {
        if (!currentSection) {
            // Create a new section if none exists
            const newSection = sectionManager.addSection('verse');
            this.state.currentSectionId = newSection.id;
            this.renderSections();
            this.renderSectionEditor();
            this.showTempMessage("New section created");
            setTimeout(() => this.toggleInstrument(buttonId), 100);
            return;
        }
        this.toggleInstrument(buttonId);
    } 
    else if (buttonId === 4) {
        // Button 4: Sound effect (short press)
        sectionManager.playSoundEffect('key');
        this.showTempMessage("Playing key effect");
    }
    else if (buttonId === 5) {
        // Button 5: Clear sections
        // Note: Long press detection is handled on Arduino side
        this.handleClearSections();
    }
    else if (buttonId === 6) {
        // Button 6: Toggle mute
        const isMuted = sectionManager.toggleMute();
        this.showTempMessage(isMuted ? "Audio Muted" : "Audio Unmuted");
    } 
    else if (buttonId === 7) {
        // Button 7: Execute full capture and generate workflow
        this.handleCaptureAndGenerate();
    }
    
    this.sendInfoToArduino(); // Update Arduino display after action
  }

  // Toggle an instrument in the current section
  toggleInstrument(instrumentIndex) {
    const currentSection = this.getCurrentSection();
    if (!currentSection) return;
    
    const instrumentId = ['drums', 'bass', 'guitar', 'keys_synth'][instrumentIndex];
        let currentInstruments = currentSection.instruments ? [...currentSection.instruments] : [];
        
        if (currentInstruments.includes(instrumentId)) {
            currentInstruments = currentInstruments.filter(inst => inst !== instrumentId);
        } else {
            if (currentInstruments.length < 3) {
                currentInstruments.push(instrumentId);
            } else {
            this.showTempMessage("Max 3 instruments");
                return; // Do not add if max is reached
            }
        }
    
    // Update section in store
    this.updateSectionStatusInStore(currentSection.id, { 
        instruments: currentInstruments, 
        status: 'selected' 
    });
    
    // Re-render to show updated selections
    this.renderSectionEditor();
    this.renderSections();
    
    // Show message about the change
    this.showTempMessage(`${instrumentId}: ${currentInstruments.includes(instrumentId) ? 'ON' : 'OFF'}`);
  }

  // Handle the complete capture and generate workflow - improve handling
  async handleCaptureAndGenerate() {
    console.log('[App] Starting capture and generate workflow');
    
    // Show capture flash effect
    this.showCaptureEffect();
    
    // Show status message
    this.showTempMessage("Starting capture workflow...");
    
    try {
      // 1. First capture the image
      const imageData = await this.captureImage();
      if (!imageData) {
        this.showTempMessage("Image capture failed");
        return;
      }
      
      this.showTempMessage("Image captured! Analyzing...");
      
      // 2. Wait briefly to let the UI update
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 3. Generate audio for the current section
      const currentSection = this.getCurrentSection();
      if (currentSection && currentSection.instruments && currentSection.instruments.length > 0) {
        this.showTempMessage("Generating audio...");
        await this.handleGenerateAudio();
        
        // The autoAdvanceAfterGeneration method will be called automatically from handleGenerateAudio
      } else if (currentSection) {
        // If we have a section but no instruments, suggest instruments based on the caption
        if (currentSection.caption) {
          const suggestedInstruments = this.getSuggestedInstruments(currentSection.caption);
          if (suggestedInstruments.length > 0) {
            // Auto-select suggested instruments
            this.autoSelectInstruments(currentSection, suggestedInstruments);
            this.showTempMessage("Auto-selected instruments based on image");
            
            // Generate audio after a short delay
            setTimeout(() => {
              this.handleGenerateAudio();
            }, 500);
        } else {
            this.showTempMessage("Please select instruments");
          }
        } else {
          this.showTempMessage("Waiting for image analysis...");
          // Poll for caption completion
          this.pollForCaptionCompletion(currentSection);
        }
      } else {
        this.showTempMessage("No section selected");
      }
    } catch (error) {
      console.error("Capture workflow error:", error);
      this.showTempMessage("Workflow error");
    }
  }

  // Add method to poll for caption completion
  async pollForCaptionCompletion(section) {
    const MAX_ATTEMPTS = 10;
    const POLL_INTERVAL = 1000; // 1 second
    
    let attempts = 0;
    
    const checkCaption = async () => {
      attempts++;
      
      // Get the latest section data
      const sections = store.get('sections');
      const updatedSection = sections.find(s => s.id === section.id);
      
      if (updatedSection && updatedSection.caption) {
        console.log('[App] Caption completed:', updatedSection.caption);
        
        // Auto-select instruments based on caption
        const suggestedInstruments = this.getSuggestedInstruments(updatedSection.caption);
        if (suggestedInstruments.length > 0) {
          // Auto-select suggested instruments
          this.autoSelectInstruments(updatedSection, suggestedInstruments);
          this.showTempMessage("Auto-selected instruments based on image");
          
          // Generate audio after a short delay
          setTimeout(() => {
            this.handleGenerateAudio();
          }, 500);
        }
      } else if (attempts < MAX_ATTEMPTS) {
        // Continue polling
        setTimeout(checkCaption, POLL_INTERVAL);
      } else {
        this.showTempMessage("Caption analysis timed out. Please select instruments manually.");
      }
    };
    
    // Start polling
    setTimeout(checkCaption, POLL_INTERVAL);
  }

  // Improve the autoSelectInstruments method
  autoSelectInstruments(section, instruments) {
    if (!section || !instruments || instruments.length === 0) return;
    
    console.log(`[App] Auto-selecting instruments for section ${section.id}:`, instruments);
    
    // Update the section in store
    this.updateSectionStatusInStore(section.id, {
      instruments: instruments,
      status: 'selected'
    });
    
    // Update UI
    this.renderSectionEditor();
    this.renderSections();
    
    // Update instrument options visual state in the editor
    const instrumentGrid = this.elements.instrumentGridEditor;
    if (instrumentGrid) {
      const options = instrumentGrid.querySelectorAll('.instrument-option');
      options.forEach(option => {
        const optionId = option.dataset.id;
        if (optionId) {
          if (instruments.includes(optionId)) {
            option.classList.add('selected');
          } else {
            option.classList.remove('selected');
          }
        }
      });
    }
    
    // Send update to Arduino
    this.sendInfoToArduino();
  }

  // Show a capture flash effect
  showCaptureEffect() {
    // Create the flash element
    const flashElement = document.createElement('div');
    flashElement.className = 'capture-effect';
    document.body.appendChild(flashElement);
    
    // Remove after animation completes
    setTimeout(() => {
      if (flashElement.parentNode) {
        flashElement.parentNode.removeChild(flashElement);
      }
    }, 500);
  }

  // Play a sound effect
  playSoundEffect(type = 'key') {
    if (!this.state.serverAvailable) {
      this.showTempMessage("Server unavailable for effects");
      return;
    }
    
    this.showTempMessage(`Playing ${type} effect...`);
    
    // Create an audio context if needed
    if (!this.effectContext) {
      this.effectContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Create a different effect based on type
    if (type === 'key') {
      // Key effect - short MIDI-like arpeggio
      this.playKeyEffect();
    } else if (type === 'transition') {
      // Transition effect - longer reverb/filter sweep
      this.playTransitionEffect();
    }
  }

  // Play a short key/MIDI style effect
  playKeyEffect() {
    if (!this.effectContext) return;
    
    const now = this.effectContext.currentTime;
    
    // Create oscillator for MIDI-like sound
    const osc = this.effectContext.createOscillator();
    osc.type = 'triangle';
    
    // Create filter for tone shaping
    const filter = this.effectContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, now);
    filter.frequency.exponentialRampToValueAtTime(500, now + 0.3);
    
    // Create gain node for volume envelope
    const gain = this.effectContext.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.7, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    
    // Connect nodes
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.effectContext.destination);
    
    // Create short arpeggio pattern
    const genre = store.get('genre') || 'pop';
    let notes;
    
    // Different patterns based on genre
    if (genre.includes('rock') || genre.includes('metal')) {
      notes = [440, 554.37, 659.25, 783.99]; // A4, C#5, E5, G5 (power chord)
    } else if (genre.includes('jazz') || genre.includes('soul')) {
      notes = [523.25, 659.25, 784, 987.77]; // C5, E5, G5, B5 (Cmaj7)
    } else if (genre.includes('electronic') || genre.includes('dance')) {
      notes = [261.63, 329.63, 415.30, 493.88]; // C4, E4, G#4, B4 (electronic)
    } else {
      notes = [261.63, 329.63, 392, 523.25]; // C4, E4, G4, C5 (basic major)
    }
    
    // Play the arpeggio
    osc.frequency.setValueAtTime(notes[0], now);
    osc.frequency.setValueAtTime(notes[1], now + 0.05);
    osc.frequency.setValueAtTime(notes[2], now + 0.1);
    osc.frequency.setValueAtTime(notes[3], now + 0.15);
    
    // Start and stop the oscillator
    osc.start(now);
    osc.stop(now + 0.3);
  }

  // Play a longer transition effect
  playTransitionEffect() {
    if (!this.effectContext) return;
    
    const now = this.effectContext.currentTime;
    const duration = 2.0; // 2 second effect
    
    // Create noise source for transition sweep
    const bufferSize = 2 * this.effectContext.sampleRate;
    const noiseBuffer = this.effectContext.createBuffer(1, bufferSize, this.effectContext.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    
    // Create white noise source
    const noise = this.effectContext.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    
    // Create filter for sweep
    const filter = this.effectContext.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(50, now);
    filter.frequency.exponentialRampToValueAtTime(4000, now + duration * 0.5);
    filter.frequency.exponentialRampToValueAtTime(50, now + duration);
    filter.Q.setValueAtTime(20, now);
    filter.Q.linearRampToValueAtTime(5, now + duration);
    
    // Create gain node for volume envelope
    const gain = this.effectContext.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.1);
    gain.gain.linearRampToValueAtTime(0.1, now + duration * 0.5);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    
    // Connect nodes
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.effectContext.destination);
    
    // Create complementary oscillator for tonal component
    const osc = this.effectContext.createOscillator();
    osc.type = 'sine';
    
    // Create filter for tonal component
    const oscFilter = this.effectContext.createBiquadFilter();
    oscFilter.type = 'lowpass';
    oscFilter.frequency.setValueAtTime(400, now);
    oscFilter.frequency.linearRampToValueAtTime(1200, now + duration * 0.3);
    oscFilter.frequency.linearRampToValueAtTime(200, now + duration);
    
    // Create gain for tonal component
    const oscGain = this.effectContext.createGain();
    oscGain.gain.setValueAtTime(0, now);
    oscGain.gain.linearRampToValueAtTime(0.3, now + 0.3);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    
    // Get notes based on genre/BPM
    const bpm = store.get('bpm') || 120;
    const baseFreq = (bpm / 60) * 110; // Scale with BPM for musical coherence
    
    // Set frequency glide
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.linearRampToValueAtTime(baseFreq * 2, now + duration * 0.5);
    osc.frequency.linearRampToValueAtTime(baseFreq * 0.5, now + duration);
    
    // Connect oscillator nodes
    osc.connect(oscFilter);
    oscFilter.connect(oscGain);
    oscGain.connect(this.effectContext.destination);
    
    // Start and stop all sources
    noise.start(now);
    osc.start(now);
    
    // Stop after duration
    noise.stop(now + duration);
    osc.stop(now + duration);
  }
  
  // Handle mute toggle
  handleMuteToggle(forceMuteState = null) {
    // Use forceMuteState if provided, otherwise toggle current state
    const newMuteState = forceMuteState !== null ? forceMuteState : !sectionManager.isMuted();
    
    // Use sectionManager to handle muting
    sectionManager.setMuted(newMuteState);
    
    // Show message about the change
    this.showTempMessage(newMuteState ? "Audio Muted" : "Audio Unmuted");
    
    // Update Arduino with mute state
    this.sendInfoToArduino();
  }
  
  // Show a temporary message on screen and send to Arduino
  showTempMessage(message) {
    console.log(`[App] Message: ${message}`);
    
    // Show an alert if needed (can be replaced with a nicer UI notification)
    // Consider creating a toast-style notification system instead of alerts
    
    // Send message to Arduino if connected
    if (this.state.arduinoConnected && hw.getConnectionStatus()) {
      hw.send({
        message: message
      });
    }
    
    // Create or update toast notification
    this.showToastNotification(message);
  }
  
  // Show toast notification
  showToastNotification(message) {
    // Find or create toast container
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      toastContainer.style.position = 'fixed';
      toastContainer.style.bottom = '20px';
      toastContainer.style.right = '20px';
      toastContainer.style.zIndex = '1000';
      document.body.appendChild(toastContainer);
    }
    
    // Create new toast
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.style.backgroundColor = '#333';
    toast.style.color = 'white';
    toast.style.padding = '10px 15px';
    toast.style.borderRadius = '4px';
    toast.style.marginTop = '10px';
    toast.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
    toast.style.minWidth = '200px';
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease-in-out';
    toast.textContent = message;
    
    // Add to container
    toastContainer.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => {
      toast.style.opacity = '1';
    }, 10);
    
    // Remove after delay
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 3000);
  }
  
  // Get the next logical section type
  getNextSectionType(currentType) {
    const sectionFlow = {
      'intro': 'verse',
      'verse': 'chorus', 
      'chorus': 'verse',
      'bridge': 'outro',
      'outro': 'intro'
    };
    
    return sectionFlow[currentType] || 'verse';
  }

  getLedStates() {
    const currentSection = this.getCurrentSection();
    const selectedInstruments = currentSection?.instruments || [];
    const instrumentMap = ['drums', 'bass', 'guitar', 'keys_synth'];
    const ledArray = [0, 0, 0, 0, 0]; // 5 LEDs

    instrumentMap.forEach((instId, index) => {
        if (selectedInstruments.includes(instId)) {
            ledArray[index] = 1;
        }
    });

    // LED 5 (index 4) for various status indications
    if (this.state.isGeneratingAudio) {
        // Solid on during generation
        ledArray[4] = 1; 
    } else if (sectionManager.continuousPlaybackActive) {
        // Blink during continuous playback
        const blinkRate = 500; // 500ms per blink
        ledArray[4] = Math.floor(Date.now() / blinkRate) % 2;
    } else if (sectionManager.isPlaying) {
        // Regular playback
        ledArray[4] = 1; 
    } else if (sectionManager.isMuted()) {
        // Muted state - use sectionManager to check mute state
        ledArray[4] = Math.floor(Date.now() / 300) % 2; // Faster blink for mute
    }
    
    return ledArray;
  }

  sendInfoToArduino() {
    if (!this || !this.state) {
      console.warn("[App] sendInfoToArduino called with incorrect context");
      return;
    }
    if (!this.state.arduinoConnected || !hw.getConnectionStatus()) return;

    const currentSessionStore = store.getAll();
    const currentSectionFromStore = this.getCurrentSection();
    const isPlayingAudio = sectionManager.isPlaying || sectionManager.continuousPlaybackActive;
    
    // Get waveform data only if playing, otherwise prepare a flat line array
    let waveformArray;
    if (isPlayingAudio) {
      const waveformData = sectionManager.getWaveformDataForDisplay(128);
      waveformArray = Array.from(waveformData);
    } else {
      // Send a minimal representation or flat line when not playing to save bandwidth
      // Arduino sketch already handles empty wave array by drawing flat line.
      waveformArray = new Array(128).fill(0); 
    }

    // Prepare LCD line 1 with BPM, genre and section type
    let lcd1Str = `BPM:${currentSessionStore.bpm || '??'}`;
    if (currentSessionStore.genre) {
      lcd1Str += ` ${currentSessionStore.genre.substring(0,4).toUpperCase()}`;
    }
    if (currentSectionFromStore && currentSectionFromStore.type) {
        const sectionType = currentSectionFromStore.type.substring(0,5).toUpperCase();
        if ((lcd1Str.length + sectionType.length + 1) <= 20) { 
            lcd1Str += ` ${sectionType}`;
        }
    }
    lcd1Str = lcd1Str.substring(0, 20);

    // Prepare LCD line 2 with instrument information or section status
    let lcd2Str = "No Section";
    if (currentSectionFromStore) {
        const instruments = currentSectionFromStore.instruments || [];
        if (instruments.length > 0) {
            lcd2Str = instruments.map(inst => inst.substring(0,3).toUpperCase()).join(' ').substring(0,20); // Use 3 chars for instrument names
        } else {
            lcd2Str = (currentSectionFromStore.caption?.section || currentSectionFromStore.type || 'Selected').substring(0,20);
        }
    }
    
    // If in continuous playback mode, show status on line 2
    if (sectionManager.continuousPlaybackActive) {
      const mixer = store.get('currentMixStatus');
      if (mixer && mixer.status && (mixer.status.includes('tonn_mixing') || mixer.status.includes('tonn_mastering'))) {
        lcd2Str = "PROCESSING AUDIO...";
      } else if (mixer && mixer.status && mixer.status.includes('completed')) {
        lcd2Str = "PROF.AUDIO READY";
      }
    }
    
    // Add playing indicator if audio is playing
    if (isPlayingAudio) {
      if (lcd2Str.length < 16) {
        lcd2Str += " ►";
      }
    }
    
    // Add muted indicator if audio is muted
    if (sectionManager.isMuted()) {
      if (lcd2Str.length < 17) {
        lcd2Str += " 🔇";
      }
    }
    
    // Limit LCD line 2 to 20 chars
    lcd2Str = lcd2Str.substring(0, 20);
    
    // Get LED states for instrument selection + status LED
    const dataToSend = {
        lcd_l1: lcd1Str,
        lcd_l2: lcd2Str, 
        leds: this.getLedStates(),
        vu: sectionManager.getAudioLevel() || 0,
        muted: sectionManager.isMuted(),
        wave: waveformArray 
    };
    
    // String representation of data for comparison with last sent data
    const dataString = JSON.stringify(dataToSend);
    const vuChangedSignificantly = Math.abs(dataToSend.vu - (this.state.lastVuSent || 0)) > 2; // More sensitive VU change detection
    const muteChanged = dataToSend.muted !== this.state.lastMuteStateSent;
    const ledsChanged = JSON.stringify(dataToSend.leds) !== JSON.stringify(this.state.lastLedsSent);
    const lcdL1Changed = dataToSend.lcd_l1 !== this.state.lastLcdL1Sent;
    const lcdL2Changed = dataToSend.lcd_l2 !== this.state.lastLcdL2Sent;

    // Determine if a send is necessary
    let shouldSend = false;
    if (isPlayingAudio) {
        // If playing, send more frequently (controlled by arduinoUpdateInterval)
        // and always if waveform or VU has changed significantly, or other states.
        // The interval itself handles frequency; here we decide *if* the data is different enough.
        if (dataString !== this.state.lastArduinoDataSent) { // Simple check if anything changed
            shouldSend = true;
        }
    } else {
        // If not playing, only send if critical UI elements changed or VU changed significantly (e.g., decay)
        if (muteChanged || ledsChanged || lcdL1Changed || lcdL2Changed || vuChangedSignificantly) {
            shouldSend = true;
        }
    }

    if (shouldSend) {
    hw.send(dataToSend);
    this.state.lastArduinoDataSent = dataString;
        this.state.lastVuSent = dataToSend.vu;
        this.state.lastMuteStateSent = dataToSend.muted;
        this.state.lastLedsSent = dataToSend.leds;
        this.state.lastLcdL1Sent = dataToSend.lcd_l1;
        this.state.lastLcdL2Sent = dataToSend.lcd_l2;
    } 
  }

  startArduinoUpdates() {
    if (this.arduinoUpdateInterval) clearInterval(this.arduinoUpdateInterval);
    // Adjust interval based on playback state - more frequent when playing
    const interval = (sectionManager.isPlaying || sectionManager.continuousPlaybackActive) ? 150 : 500; // Faster when playing
    this.arduinoUpdateInterval = setInterval(() => {
        this.sendInfoToArduino();
        // Dynamically adjust interval if playback state changes
        const currentPlayingState = sectionManager.isPlaying || sectionManager.continuousPlaybackActive;
        const newInterval = currentPlayingState ? 150 : 500;
        if (this.arduinoUpdateInterval && this.currentArduinoInterval !== newInterval) {
            console.log(`[App] Adjusting Arduino update interval to ${newInterval}ms`);
            clearInterval(this.arduinoUpdateInterval);
            this.currentArduinoInterval = newInterval;
            this.arduinoUpdateInterval = setInterval(this.sendInfoToArduino, this.currentArduinoInterval);
        }
    }, interval);
    this.currentArduinoInterval = interval; // Store current interval
    console.log(`[App] Started Arduino updates at ${interval}ms interval.`);
  }

  stopArduinoUpdates() {
    if (this.arduinoUpdateInterval) clearInterval(this.arduinoUpdateInterval);
    this.arduinoUpdateInterval = null;
    this.currentArduinoInterval = 0;
    console.log("[App] Stopped sending periodic updates to Arduino.");
    if(hw.getConnectionStatus()){ 
        hw.send({lcd_l1: "Updates Paused", lcd_l2: "...", leds: [0,0,0,0,0], vu: 0, wave: new Array(128).fill(0)});
    }
  }
  // --- End Arduino Integration Methods ---

  handleDownloadSection() {
    const section = this.getCurrentSection();
    if (section && section.audioUrl && section.status === 'ready') {
      const filename = `section_${section.type}_${section.id}.wav`;
      const a = document.createElement('a');
      a.href = section.audioUrl;
      a.download = filename;
      document.body.appendChild(a); // Required for Firefox
      a.click();
      document.body.removeChild(a);
      // URL.revokeObjectURL(section.audioUrl); // DECIDE: Comment out for now to ensure playback isn't affected if URL is in use.
      console.log(`[App] Downloading section: ${filename}`);
    } else {
      alert('No audio available to download for this section, or section not ready.');
      console.warn('[App] Download attempt failed: No audioUrl or section not ready.', section);
    }
  }

  /**
   * Handle clearing all sections
   */
  handleClearSections() {
    if (confirm('Are you sure you want to clear all sections? This cannot be undone.')) {
      // Clear the store
      store.clearAll();
      
      // Reset UI
      this.state.currentSectionId = null;
      
      // Clear audio buffers in sectionManager
      sectionManager.clearAudioData();
      
      // Update UI
      this.renderSections();
      this.renderSectionEditor();
      
      console.log('[App] All sections cleared');
      alert('All sections have been cleared.');
    }
  }

  // Add a new method for initializing continuous playback
  initContinuousPlayback() {
    // Create continuous playback button if it doesn't exist
    if (!this.elements.continuousPlayBtn) {
      const playAllBtnContainer = this.elements.playAllBtn.parentElement;
      
      const continuousBtn = document.createElement('button');
      continuousBtn.id = 'continuous-play-btn';
      continuousBtn.textContent = 'Continuous Playback';
      continuousBtn.className = this.elements.playAllBtn.className;
      
      playAllBtnContainer.appendChild(continuousBtn);
      this.elements.continuousPlayBtn = continuousBtn;
      
      // Add event listener
      continuousBtn.addEventListener('click', this.handleContinuousPlayback.bind(this));
    }
    
    // Create loop count display if it doesn't exist
    if (!this.elements.loopCountDisplay) {
      const sidebarControls = this.elements.createMixBtn.parentElement;
      
      const loopDisplay = document.createElement('div');
      loopDisplay.id = 'loop-count-display';
      loopDisplay.className = 'loop-display';
      loopDisplay.style.display = 'none';
      loopDisplay.innerHTML = '<span>Loop: <strong>0</strong></span>';
      
      sidebarControls.appendChild(loopDisplay);
      this.elements.loopCountDisplay = loopDisplay;
    }
    
    // Create auto-mix toggle if it doesn't exist
    if (!this.elements.autoMixToggle) {
      const sidebarControls = this.elements.createMixBtn.parentElement;
      
      const toggleContainer = document.createElement('div');
      toggleContainer.className = 'auto-mix-container';
      toggleContainer.style.display = 'flex';
      toggleContainer.style.alignItems = 'center';
      toggleContainer.style.marginTop = '10px';
      
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.id = 'auto-mix-toggle';
      toggle.checked = true; // Default to enabled
      
      const label = document.createElement('label');
      label.htmlFor = 'auto-mix-toggle';
      label.textContent = 'Auto-Mix';
      label.style.marginLeft = '5px';
      
      toggleContainer.appendChild(toggle);
      toggleContainer.appendChild(label);
      sidebarControls.appendChild(toggleContainer);
      
      this.elements.autoMixToggle = toggle;
      
      // Add event listener
      toggle.addEventListener('change', this.handleAutoMixToggle.bind(this));
    }
    
    // Create mix status indicator if it doesn't exist
    if (!this.elements.mixStatusIndicator) {
      const sidebarControls = this.elements.createMixBtn.parentElement;
      
      const indicator = document.createElement('div');
      indicator.id = 'mix-status-indicator';
      indicator.className = 'mix-status-indicator';
      indicator.style.display = 'none';
      indicator.innerHTML = '<span>Auto-mixing: <strong>idle</strong></span>';
      
      sidebarControls.appendChild(indicator);
      this.elements.mixStatusIndicator = indicator;
    }
  }

  // Add new methods for continuous playback
  handleContinuousPlayback() {
    const wasPlaying = sectionManager.continuousPlaybackActive;
    
    const playbackStarted = sectionManager.toggleContinuousPlayback({}, this.handleContinuousPlaybackEvent.bind(this));
    
    // Update button text
    if (this.elements.continuousPlayBtn) {
      this.elements.continuousPlayBtn.textContent = playbackStarted 
        ? 'Stop Continuous Playback' 
        : 'Continuous Playback';
      
      this.elements.continuousPlayBtn.className = playbackStarted 
        ? this.elements.playAllBtn.className + ' active' 
        : this.elements.playAllBtn.className;
    }
    
    // Show/hide loop count display
    if (this.elements.loopCountDisplay) {
      this.elements.loopCountDisplay.style.display = playbackStarted ? 'block' : 'none';
      
      // Reset loop count
      if (playbackStarted && !wasPlaying) {
        const countElement = this.elements.loopCountDisplay.querySelector('strong');
        if (countElement) countElement.textContent = '0';
      }
    }
    
    // Show/hide mix status indicator
    if (this.elements.mixStatusIndicator) {
      this.elements.mixStatusIndicator.style.display = playbackStarted ? 'block' : 'none';
      
      // Reset mix status
      if (playbackStarted && !wasPlaying) {
        const statusElement = this.elements.mixStatusIndicator.querySelector('strong');
        if (statusElement) statusElement.textContent = 'idle';
      }
    }
    
    // Disable/enable other playback buttons
    if (this.elements.playAllBtn) {
      this.elements.playAllBtn.disabled = playbackStarted;
    }
    
    if (this.elements.playBtn) {
      this.elements.playBtn.disabled = playbackStarted;
    }
    
    // Auto-trigger mix if starting playback
    if (playbackStarted && !wasPlaying && this.elements.autoMixToggle && this.elements.autoMixToggle.checked) {
      setTimeout(() => sectionManager.checkAndTriggerAutoMix(), 500);
    }
    
    // Update Arduino
    this.sendInfoToArduino();
  }

  handleContinuousPlaybackEvent(eventType, eventData) {
    console.log(`[App] Continuous playback event: ${eventType}`, eventData);
    
    switch (eventType) {
      case 'continuous_playback_started':
        // Update UI for playback started
        break;
        
      case 'loop_completed':
        // Update loop count display
        if (this.elements.loopCountDisplay) {
          const countElement = this.elements.loopCountDisplay.querySelector('strong');
          if (countElement) countElement.textContent = eventData.loopCount;
        }
        break;
        
      case 'section_changed':
        // Update current section in UI
        if (eventData.currentSectionId) {
          this.state.currentSectionId = eventData.currentSectionId;
          this.renderSectionEditor();
          this.renderSections();
        }
        break;
        
      case 'error':
        // Handle playback error
        console.error(`[App] Continuous playback error: ${eventData.message}`);
        alert(`Playback error: ${eventData.message}`);
        break;
        
      default:
        // Handle other events
        break;
    }
    
    // Update Arduino
    this.sendInfoToArduino();
  }

  handleAutoMixToggle(event) {
    const enabled = event.target.checked;
    sectionManager.setAutoMixEnabled(enabled);
    
    console.log(`[App] Auto-mixing ${enabled ? 'enabled' : 'disabled'}`);
    
    // Update mix status indicator
    if (this.elements.mixStatusIndicator) {
      const statusElement = this.elements.mixStatusIndicator.querySelector('strong');
      if (statusElement) statusElement.textContent = enabled ? 'idle' : 'disabled';
    }
  }

  /**
   * Get the currently selected section
   * @returns {Object|null} The current section object or null if none selected
   */
  getCurrentSection() {
    if (!this.state.currentSectionId) return null;
    
    const sections = store.get('sections') || [];
    return sections.find(section => section.id === this.state.currentSectionId) || null;
  }

  /**
   * Handle section item click in the sections list
   * @param {string} sectionId - ID of the clicked section
   */
  handleSectionClick(sectionId) {
    // Set as current section
    this.state.currentSectionId = sectionId;
    
    // Update UI
    const sectionItems = document.querySelectorAll('.section-item');
    sectionItems.forEach(item => {
      if (item.dataset.id === sectionId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
    
    // Show editor for this section
    this.renderSectionEditor();
    
    // Show the newly generated section in continuous playback if active
    const section = this.getCurrentSection();
    if (section && section.status === 'ready' && sectionManager.continuousPlaybackActive) {
      sectionManager.addSectionToPlaybackQueue(sectionId);
    }
    
    // Update Arduino if connected
    this.sendInfoToArduino();
  }

  /**
   * Handle add section button click
   */
  handleAddSection() {
    // Populate section type dropdown
    if (this.elements.modalSectionTypeSelect) {
      this.elements.modalSectionTypeSelect.innerHTML = '';
      
      getSectionTypes().forEach(type => {
        const option = document.createElement('option');
        option.value = type.id;
        option.textContent = type.name || type.id.charAt(0).toUpperCase() + type.id.slice(1);
        this.elements.modalSectionTypeSelect.appendChild(option);
      });
    }
    
    // Show section modal
    if (this.elements.sectionModal) {
      this.elements.sectionModal.classList.add('show');
    }
  }

  /**
   * Handle confirm add section button click
   */
  handleConfirmAddSection() {
    // Get section type from modal
    const type = this.elements.modalSectionTypeSelect.value;
    
    // Create new section
    const newSection = sectionManager.addSection(type);
    
    // Set as current section
    this.state.currentSectionId = newSection.id;
    
    // Update UI
    this.renderSections();
    this.renderSectionEditor();
    
    // Close modal
    this.elements.sectionModal.classList.remove('show');
  }

  /**
   * Handle generate audio button click
   */
  async handleGenerateAudio() {
    const section = this.getCurrentSection();
    if (!section) return;
    
    // Check if instruments are selected
    if (!section.instruments || section.instruments.length === 0) {
      alert('Please select at least one instrument before generating audio');
      return;
    }
    
    this.state.isGeneratingAudio = true;
    this.elements.generateBtn.disabled = true;
    this.elements.generateBtn.textContent = 'Generating...';
    
    try {
      // Update section status
      this.updateSectionStatusInStore(section.id, { status: 'generating' });
      
      // Build prompt based on section data
      let prompt = '';
      
      if (section.caption) {
        // Advanced prompt with caption
        prompt = `${section.caption.genre || 'pop'} ${section.type} with ${section.instruments.join(', ')}. `;
        prompt += `${section.caption.mood || 'neutral'} mood. `;
        prompt += `${section.caption.description || ''}`;
      } else {
        // Basic prompt with just instruments and type
        prompt = `${store.get('genre') || 'pop'} ${section.type} with ${section.instruments.join(', ')}`;
      }
      
      // Get BPM from global or section caption
      const bpm = section.caption?.bpm || store.get('bpm') || 120;
      
      console.log(`[App] Generating audio with prompt: "${prompt}", BPM: ${bpm}`);
      
      // Call the API
      const result = await api.generateAudio(prompt, bpm, { duration: 15 });
      
      if (!result || !result.audioBlob) {
        throw new Error('Failed to generate audio: empty response from API');
      }
      
      // Create object URL for playback
      const audioUrl = URL.createObjectURL(result.audioBlob);
      
      // Create an AudioContext to decode the audio
      const audioContext = getAudioContext();
      
      // Decode the audio data
      const arrayBuffer = await result.audioBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Update the section in the store
      this.updateSectionStatusInStore(section.id, {
        status: 'ready',
        audioUrl: audioUrl,
        bpm: result.bpm,
        key: result.key,
        duration: result.duration,
        serverFileId: result.serverFileId
      });
      
      // Set the audio buffer in the section manager
      sectionManager.setSectionAudio(section.id, audioBuffer, audioUrl);
      
      console.log(`[App] Audio generation successful for section ${section.id}`);
      
      // Update UI
      this.renderSections();
      this.renderSectionEditor();
      
      // Update the create mix button state
      this.updateCreateMixButton();
      
      // Auto-move to next section or create a new one
      this.autoAdvanceAfterGeneration(section);
      
    } catch (error) {
      console.error('[App] Error generating audio:', error);
      alert(`Error generating audio: ${error.message}`);
      
      // Update section status
      this.updateSectionStatusInStore(section.id, { status: 'selected' });
    } finally {
      this.state.isGeneratingAudio = false;
      this.elements.generateBtn.disabled = false;
      this.elements.generateBtn.textContent = 'Generate Audio';
      
      // Send Arduino update
      this.sendInfoToArduino();
    }
  }

  /**
   * Handle creating a mix
   */
  async handleCreateMix() {
    const sections = store.get('sections');
    const readySections = sections.filter(section => section.status === 'ready' && sectionManager.audioBuffers.has(section.id)); // Check sectionManager cache
    
    if (readySections.length === 0) {
      alert('No sections with generated audio found and ready for local stitching.');
      return;
    }
    
    try {
      // Explicitly show mix container and hide editor
      this.elements.sectionEditor.style.display = 'none';
      this.elements.editorPlaceholder.style.display = 'none';
      this.elements.mixContainer.style.display = 'block'; // Show the mix container
      
      this.updateMixStatusUI('stitching_local', 'Starting streamlined audio mixing workflow...', 10); // Initial UI update
      
      // Check if continuous playback is active
      const wasContinuousActive = sectionManager.continuousPlaybackActive;
      if (wasContinuousActive) {
        // We used to temporarily stop continuous playback here, but that's not necessary
        // Just let it continue playing while we create the mix in the background
        console.log('[App] Keeping continuous playback active during mix creation');
      }
      
      // Call sectionManager to create the mix - use streamlined approach
      const mixData = await sectionManager.createSectionMix({ skipPreviewStep: true });
      
      // If continuous playback was not active before, we need to play the mix in the audio player
      // Otherwise, the continuous playback engine will handle the transition
      if (!wasContinuousActive) {
        // Update UI based on mix result
        this.updateMixStatusUI(
          mixData.status, 
          mixData.status === 'COMPLETED' || mixData.status === 'completed' 
            ? 'Local stitching completed. Professional mix request initiated!' 
            : 'Processing mix...', 
          mixData.status === 'COMPLETED' || mixData.status === 'completed' ? 100 : 50
        );
        
        // Show audio player if mix is ready and continuous playback is not active
        if ((mixData.status === 'COMPLETED' || mixData.status === 'completed') && mixData.downloadUrl) {
          // Ensure the download URL is properly resolved
          const resolvedUrl = (mixData.downloadUrl.startsWith('http') || mixData.downloadUrl.startsWith('/'))
            ? mixData.downloadUrl
            : api.resolveApiUrl ? api.resolveApiUrl(mixData.downloadUrl) : mixData.downloadUrl;
          
          console.log(`[App] Using resolved URL for audio player: ${resolvedUrl}`);
          
          if (this.elements.audioPlayer) {
            this.elements.audioPlayer.src = resolvedUrl;
            this.elements.audioPlayer.load();
            this.elements.audioPlayerContainer.style.display = 'block';
            
            // Try to autoplay (may be blocked by browser policies)
            this.elements.audioPlayer.play().catch(e => {
              console.log('Auto-play prevented by browser, user must click play');
            });
          }
          
          // Enable download button
          if (this.elements.downloadMixBtn) {
            this.elements.downloadMixBtn.disabled = false;
          }
          
          // If tonnTaskId is available, enable final mix button
          if (mixData.tonnTaskId && this.elements.createFinalMixBtn) {
            this.elements.createFinalMixBtn.style.display = 'inline-block';
            this.elements.createFinalMixBtn.dataset.tonnTaskId = mixData.tonnTaskId;
          }
        }
      } else {
        // When continuous playback is active, just update the status UI
        // The continuous playback engine will handle the audio playback
        console.log('[App] Continuous playback active, not showing standalone audio player');
        
        this.updateMixStatusUI(
          mixData.status,
          'Audio mixing in progress. Playback will continue with current audio.',
          mixData.status === 'COMPLETED' || mixData.status === 'completed' ? 100 : 50
        );
        
        // Hide the audio player container
        this.elements.audioPlayerContainer.style.display = 'none';
      }
    } catch (error) {
      console.error('[App] Error creating mix:', error);
      this.updateMixStatusUI('error', `Error creating mix: ${error.message}`, 0);
    }
  }

  // Handle instrument selection - this method is added to fix the binding error
  handleSelectInstruments() {
    // Get current section
    const section = this.getCurrentSection();
    if (!section) return;
    
    // Clear instrument grid
    if (this.elements.instrumentGrid) {
      this.elements.instrumentGrid.innerHTML = '';
    }
    
    // Get all instrument options
    const instrumentOptions = [
      { id: 'drums', name: 'Drums', description: 'Percussion and rhythm instruments' },
      { id: 'bass', name: 'Bass', description: 'Low frequency instruments' },
      { id: 'guitar', name: 'Guitar', description: 'Acoustic or electric guitar' },
      { id: 'piano', name: 'Piano', description: 'Keyboard instruments' },
      { id: 'synth', name: 'Synth', description: 'Synthesized sounds' },
      { id: 'strings', name: 'Strings', description: 'Orchestral string instruments' },
      { id: 'brass', name: 'Brass', description: 'Trumpet, trombone, etc.' },
      { id: 'woodwinds', name: 'Woodwinds', description: 'Flute, saxophone, etc.' },
      { id: 'vocals', name: 'Vocals', description: 'Human voice' }
    ];
    
    // Populate the instrument grid with options
    if (this.elements.instrumentGrid) {
      instrumentOptions.forEach(instrument => {
        const div = document.createElement('div');
        div.className = 'instrument-option';
        div.dataset.id = instrument.id;
        
        // If instrument is already selected, mark it
        if (section.instruments && section.instruments.includes(instrument.id)) {
          div.className += ' selected';
        }
        
        div.innerHTML = `
          <div class="instrument-name">${instrument.name}</div>
          <div class="instrument-desc">${instrument.description}</div>
        `;
        
        div.addEventListener('click', () => {
          div.classList.toggle('selected');
          
          // Limit to 3 instruments max
          const selected = this.elements.instrumentGrid.querySelectorAll('.instrument-option.selected');
          if (selected.length > 3) {
            div.classList.remove('selected');
            alert('You can select up to 3 instruments for a section');
          }
        });
        
        this.elements.instrumentGrid.appendChild(div);
      });
      
      // Show the modal
      if (this.elements.instrumentsModal) {
        this.elements.instrumentsModal.classList.add('show');
      }
    } else {
      console.warn('Instrument grid element not found');
    }
  }

  // Add new method to render minimized section thumbnails
  renderMinimizedSections() {
    const sections = store.get('sections') || [];
    const readySections = sections.filter(section => section.status === 'ready');
    
    // If we have the miniview container and grid elements
    const miniviewContainer = this.elements.miniviews || document.getElementById('section-miniviews');
    const miniviewGrid = document.getElementById('section-miniview-grid');
    
    if (!miniviewContainer || !miniviewGrid) return;
    
    // Only show if we have ready sections
    if (readySections.length === 0) {
      miniviewContainer.style.display = 'none';
      return;
    }
    
    // Show the container
    miniviewContainer.style.display = 'block';
    
    // Clear the grid
    miniviewGrid.innerHTML = '';
    
    // Add miniviews for each ready section
    readySections.forEach(section => {
      const miniview = document.createElement('div');
      miniview.className = 'section-miniview';
      if (section.id === this.state.currentSectionId) {
        miniview.className += ' active';
      }
      miniview.dataset.id = section.id;
      
      // Create image or placeholder
      let imgSrc = '';
      if (section.capturedImage) {
        imgSrc = section.capturedImage;
      } else {
        // Create a placeholder image with a colored background based on section type
        const colors = {
          'intro': '#A5C6E5', // light blue
          'verse': '#C6E5A5', // light green
          'chorus': '#E5A5C6', // light pink
          'bridge': '#E5C6A5', // light orange
          'outro': '#A5E5C6'  // light teal
        };
        const color = colors[section.type] || '#A5C6E5';
        imgSrc = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='${color.replace('#', '%23')}' /%3E%3Ctext x='50' y='50' font-family='sans-serif' font-size='20' text-anchor='middle' dominant-baseline='middle' fill='white'%3E${section.type.charAt(0).toUpperCase()}%3C/text%3E%3C/svg%3E`;
      }
      
      // Create section info
      const instrumentsLabel = section.instruments && section.instruments.length > 0 
        ? section.instruments.map(i => i.substring(0, 3)).join(' ') 
        : 'None';
      
      miniview.innerHTML = `
        <img src="${imgSrc}" alt="${section.type}">
        <div class="section-miniview-info">${section.type}</div>
      `;
      
      // Add click handler to navigate to section
      miniview.addEventListener('click', () => this.handleSectionClick(section.id));
      
      // Add to grid
      miniviewGrid.appendChild(miniview);
    });
    
    // Store references to these elements for future updates
    this.elements.miniviews = miniviewContainer;
    this.elements.miniviewGrid = miniviewGrid;
  }

  // Add method to suggest instruments based on caption
  getSuggestedInstruments(caption) {
    // Default instrument selection based on section type and genre
    const sectionType = caption.section || 'verse';
    const genre = caption.genre || store.get('genre') || 'pop';
    
    const suggestions = {
      'intro': {
        'pop': ['keys_synth'],
        'rock': ['guitar', 'drums'],
        'electronic': ['keys_synth'],
        'hiphop': ['drums', 'bass'],
        'jazz': ['keys_synth'],
        'classical': ['keys_synth'],
        'ambient': ['keys_synth'],
        'default': ['keys_synth']
      },
      'verse': {
        'pop': ['drums', 'bass', 'keys_synth'],
        'rock': ['drums', 'bass', 'guitar'],
        'electronic': ['drums', 'keys_synth'],
        'hiphop': ['drums', 'bass'],
        'jazz': ['drums', 'bass', 'keys_synth'],
        'classical': ['keys_synth'],
        'ambient': ['keys_synth'],
        'default': ['drums', 'keys_synth']
      },
      'chorus': {
        'pop': ['drums', 'bass', 'keys_synth'],
        'rock': ['drums', 'bass', 'guitar'],
        'electronic': ['drums', 'bass', 'keys_synth'],
        'hiphop': ['drums', 'bass', 'keys_synth'],
        'jazz': ['drums', 'bass', 'keys_synth'],
        'classical': ['keys_synth'],
        'ambient': ['keys_synth', 'bass'],
        'default': ['drums', 'bass', 'keys_synth']
      },
      'bridge': {
        'pop': ['keys_synth'],
        'rock': ['guitar'],
        'electronic': ['keys_synth'],
        'hiphop': ['keys_synth'],
        'jazz': ['keys_synth'],
        'classical': ['keys_synth'],
        'ambient': ['keys_synth'],
        'default': ['keys_synth']
      },
      'outro': {
        'pop': ['keys_synth'],
        'rock': ['guitar', 'drums'],
        'electronic': ['keys_synth'],
        'hiphop': ['drums', 'bass'],
        'jazz': ['keys_synth'],
        'classical': ['keys_synth'],
        'ambient': ['keys_synth'],
        'default': ['keys_synth']
      }
    };
    
    // Get suggestions for this section type and genre, or fallback to defaults
    const genreSuggestions = suggestions[sectionType] || suggestions['verse'];
    const instruments = genreSuggestions[genre.toLowerCase()] || genreSuggestions['default'];
    
    // Limit to 3 instruments maximum
    return instruments.slice(0, 3);
  }

  // Add method to auto-select instruments
  autoSelectInstruments(section, instruments) {
    if (!section || !instruments || instruments.length === 0) return;
    
    // Update the section in store
    this.updateSectionStatusInStore(section.id, {
      instruments: instruments,
      status: 'selected'
    });
    
    // Update UI
    this.renderSectionEditor();
    this.renderSections();
  }

  // Add new method to automatically advance to next section or create a new one
  autoAdvanceAfterGeneration(currentSection) {
    // Only advance if audio generation was successful
    if (currentSection.status !== 'ready') return;
    
    // Get all sections and find current position
    const sections = store.get('sections');
    const currentIndex = sections.findIndex(s => s.id === currentSection.id);
    
    // Find the next section that needs attention
    const nextSection = sections.slice(currentIndex + 1).find(s => s.status !== 'ready');
    
    if (nextSection) {
      // Move to the next section that needs attention
      this.state.currentSectionId = nextSection.id;
      this.renderSections();
      this.renderSectionEditor();
      this.showTempMessage(`Moved to ${nextSection.type} section`);
    } else {
      // Check if we're at the last section
      if (currentIndex === sections.length - 1) {
        // Create a new section with the next logical type
        const nextType = this.getNextSectionType(currentSection.type);
        const newSection = sectionManager.addSection(nextType);
        
        // Set as current section
        this.state.currentSectionId = newSection.id;
        this.renderSections();
        this.renderSectionEditor();
        
        this.showTempMessage(`Added new ${nextType} section`);
      } else {
        // Find the next section in sequence (even if it's ready)
        const nextSectionInSequence = sections[currentIndex + 1];
        if (nextSectionInSequence) {
          this.state.currentSectionId = nextSectionInSequence.id;
          this.renderSections();
          this.renderSectionEditor();
          this.showTempMessage(`Moved to next ${nextSectionInSequence.type} section`);
        }
      }
    }
    
    // Start continuous playback if we have at least 2 ready sections
    const readySections = sections.filter(s => s.status === 'ready');
    if (readySections.length >= 2 && !sectionManager.continuousPlaybackActive && this.elements.autoMixToggle?.checked) {
      // Start continuous playback after a short delay to let UI updates settle
      setTimeout(() => {
        sectionManager.startContinuousPlayback({}, this.handleContinuousPlaybackEvent.bind(this));
        this.updateContinuousPlaybackUI(true);
        this.showTempMessage("Starting continuous playback");
      }, 1000);
    }
  }

  // Add new method to set up auto instrument selection
  setupAutoInstrumentSelection() {
    const instrumentGrid = this.elements.instrumentGridEditor;
    if (!instrumentGrid) return;
    
    // Remove existing event listeners if any
    const instrumentOptions = instrumentGrid.querySelectorAll('.instrument-option');
    instrumentOptions.forEach(option => {
      // Clone element to remove old listeners
      const newOption = option.cloneNode(true);
      option.parentNode.replaceChild(newOption, option);
      
      // Add new listener that applies selection immediately
      newOption.addEventListener('click', () => {
        this.handleInstrumentOptionAutoClick(newOption);
      });
    });
  }

  // Add handleCaptureImage method
  handleCaptureImage() {
    console.log('[App] Capture image button clicked');
    this.captureImage().catch(error => {
      console.error("Error capturing image:", error);
      this.showTempMessage("Failed to capture image");
    });
  }
}

// Initialize the app
window.addEventListener('DOMContentLoaded', () => {
  window.app = new MusicGeneratorApp();
});
 
// Listen for remastering error events
window.addEventListener('remastering-error', (event) => {
  console.log('[App] Remastering error event:', event.detail);
  
  // Show the error message in the mix status indicator
  if (this.elements.mixStatusIndicator) {
    const statusElement = this.elements.mixStatusIndicator.querySelector('strong');
    if (statusElement) {
      statusElement.textContent = 'Remastering failed - using current audio';
      statusElement.style.color = '#d32f2f'; // Red for error
      
      // Reset color after a few seconds
      setTimeout(() => {
        statusElement.style.color = '';
      }, 5000);
    }
  }
  
  // Show a brief notification to the user
  if (this.elements.mixStatus && this.elements.mixStatusText) {
    const originalText = this.elements.mixStatusText.textContent;
    this.elements.mixStatusText.textContent = `Remastering error: ${event.detail.error}. Continuing with current audio.`;
    
    // Restore original text after 5 seconds
    setTimeout(() => {
      this.elements.mixStatusText.textContent = originalText;
    }, 5000);
  }
});
 