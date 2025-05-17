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
      clearSectionsBtn: document.getElementById('clear-sections-btn')
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
      lastArduinoDataSent: ''
    };
    
    // Bind methods
    this.bindMethods();
    
    // Initialize app
    this.init();
  }
  
  // Camera handling methods
  async initializeCameraDefaultOn() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn("Camera API not available.");
      alert("Camera not available on this browser.");
      if(this.elements.captureBtn) this.elements.captureBtn.disabled = true;
      this.state.cameraAvailable = false;
      throw new Error("Camera API not available");
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (this.elements.cameraFeed) {
        this.elements.cameraFeed.srcObject = stream;
      }
      this.state.cameraStream = stream;
      this.state.cameraActive = true;
      this.state.cameraAvailable = true;
      if(this.elements.captureBtn) this.elements.captureBtn.disabled = false;
      console.log("Camera initialized and turned ON by default.");
    } catch (err) {
      console.error("Error accessing camera by default:", err);
      alert("Could not access camera. Please check permissions. Capture features will be disabled.");
      this.state.cameraActive = false;
      this.state.cameraAvailable = false;
      if(this.elements.captureBtn) this.elements.captureBtn.disabled = true;
      throw err; // Re-throw for init() to catch if needed
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
    this.handleCaptureImage = this.captureImage.bind(this);
    this.updateSectionStatusInStore = this.updateSectionStatusInStore.bind(this);
    this.handleConnectArduino = this.handleConnectArduino.bind(this);
    this.sendInfoToArduino = this.sendInfoToArduino.bind(this);
    this.handleArduinoStatus = this.handleArduinoStatus.bind(this);
    this.handleArduinoMessage = this.handleArduinoMessage.bind(this);
    this.handleDownloadSection = this.handleDownloadSection.bind(this);
    this.handleClearSections = this.handleClearSections.bind(this);
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
    
    console.log('[App] Initialization complete');
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
    
    // Camera controls
    if (this.elements.captureBtn) {
      this.elements.captureBtn.addEventListener('click', this.handleCaptureImage);
    }
    
    // Section modal
    this.elements.confirmAddSectionBtn.addEventListener('click', this.handleConfirmAddSection);
    
    // Instrument selection
    if (this.elements.confirmInstrumentsEditorBtn) {
      this.elements.confirmInstrumentsEditorBtn.addEventListener('click', this.handleConfirmInstruments);
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
      if (sectionManager.mixData && sectionManager.mixData.taskId) {
        try {
          this.updateMixStatusUI('processing', 'Creating high-quality mix...');
          const finalMix = await sectionManager.createFinalMix(sectionManager.mixData.taskId);
          if (finalMix.status === 'completed') {
            this.updateMixStatusUI('completed', 'High-quality mix ready!');
            this.elements.audioPlayer.src = finalMix.downloadUrl;
          }
        } catch (error) {
          console.error('Error creating final mix:', error);
          this.updateMixStatusUI('error', `Error: ${error.message}`);
        }
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
    
    // Listen for mix status updates
    window.addEventListener('mix-status-update', (event) => {
      const mixData = event.detail;
      
      // Update progress
      this.elements.mixProgress.value = mixData.progress || 0;
      
      // Update status
      this.updateMixStatusUI(
        mixData.status,
        mixData.status === 'completed' ? 'Mix completed successfully!' : 
        mixData.status === 'error' ? `Error: ${mixData.error}` : 
        'Processing sections...',
        mixData.progress || 0
      );
      
      // If completed, show player
      if (mixData.status === 'completed' && mixData.downloadUrl) {
        this.elements.audioPlayerContainer.style.display = 'block';
        this.elements.audioPlayer.src = mixData.downloadUrl;
      }
    });
    
    // Listen for store changes
    window.addEventListener('store-updated', () => {
      this.updateUI();
      this.sendInfoToArduino();
    });
    
    // Listen for playback events to update Arduino
    window.addEventListener('playback-started', () => this.sendInfoToArduino());
    window.addEventListener('playback-stopped', () => this.sendInfoToArduino());
    
    // New button
    if (this.elements.playAllBtn) {
      this.elements.playAllBtn.addEventListener('click', this.handlePlayAllSections);
    }

    if (this.elements.connectArduinoBtn) {
      this.elements.connectArduinoBtn.addEventListener('click', this.handleConnectArduino);
    }

    if (this.elements.downloadSectionBtn) {
      this.elements.downloadSectionBtn.addEventListener('click', this.handleDownloadSection);
    }
  }
  
  // Handle adding a new section (shows modal)
  handleAddSection() {
    this.elements.sectionModal.classList.add('show');
  }
  
  // Handle confirming section addition
  handleConfirmAddSection() {
    // Get selected section type
    const sectionType = this.elements.modalSectionTypeSelect.value;

    // Create a unique ID for the section
    const sectionId = 'section_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    
    // Create a new section
    const newSection = {
      id: sectionId,
      type: sectionType,
      instruments: [],
      status: 'empty'
    };
    
    // Add to sections array
    const sections = store.get('sections');
    const updatedSections = [...sections, newSection];
    store.set('sections', updatedSections);
    
    // Close modal
    this.closeModals();
    
    // Update UI
    this.renderSections();
    
    // Select the new section
    this.state.currentSectionId = sectionId;
    this.renderSectionEditor();
  }
  
  // Handle section click
  handleSectionClick(sectionId) {
    if (typeof sectionId === 'string') {
      this.state.currentSectionId = sectionId;
      this.renderSectionEditor();
      this.renderSections();
      this.sendInfoToArduino();
    } else {
      const target = event.currentTarget;
      const clickedSectionId = target.dataset.id;
      
      if (clickedSectionId) {
        this.state.currentSectionId = clickedSectionId;
        this.renderSectionEditor();
        this.renderSections();
        this.sendInfoToArduino();
      }
    }
  }
  
  /**
   * Get the current section object
   * @returns {Object|null} The current section or null
   */
  getCurrentSection() {
    if (!this.state.currentSectionId) return null;
    
    const sections = store.get('sections');
    return sections.find(section => section.id === this.state.currentSectionId) || null;
  }
  
  // Handle instrument selection
  handleSelectInstruments() {
    // Get current section
    const section = this.getCurrentSection();
    if (!section) return;
    
    // Clear the instrument grid
    this.elements.instrumentGrid.innerHTML = '';
    
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
    
    // Create instrument options
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
    this.elements.instrumentsModal.classList.add('show');
  }
  
  // Handle confirming instrument selection
  handleConfirmInstruments() {
    // Get current section
    const section = this.getCurrentSection();
    if (!section) {
      this.closeModals();
      return;
    }
    
    // Get selected instruments
    const selectedElements = this.elements.instrumentGrid.querySelectorAll('.instrument-option.selected');
    const selectedInstruments = Array.from(selectedElements).map(el => el.dataset.id);
    
    // Update section instruments in store
    const sections = store.get('sections');
    const index = sections.findIndex(s => s.id === section.id);
    
    if (index !== -1) {
      const updatedSection = {
        ...sections[index],
        instruments: selectedInstruments,
        status: selectedInstruments.length > 0 ? 'selected' : 'empty'
      };
      
      const updatedSections = [...sections];
      updatedSections[index] = updatedSection;
      
      store.set('sections', updatedSections);
    }
    
    // Close modal
    this.closeModals();
    
    // Update UI
    this.renderSectionEditor();
    this.sendInfoToArduino();
  }
  
  // Handle generating audio
  async handleGenerateAudio() {
    const section = this.getCurrentSection();
    if (!section) return;
    if (!section.instruments || section.instruments.length === 0) {
      alert('Please select at least one instrument for this section');
      return;
    }

    const caption = section.caption || { /* fallback */ }; // Ensure caption exists or use fallback
    const sessionBPM = store.get('bpm');
    if (!sessionBPM) {
      alert("Session BPM is not set. Please capture an image for the first section.");
      return;
    }
    const bpmForAudioCall = sessionBPM;

    try {
      this.elements.generateBtn.disabled = true;
      this.elements.generateBtn.textContent = 'Generating...';
      
      const sections = store.get('sections');
      const sectionIndex = sections.findIndex(s => s.id === section.id);
      
      let currentPaletteId = store.get('paletteId');
      if (!currentPaletteId && sectionIndex === 0) {
        currentPaletteId = `palette-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        store.set('paletteId', currentPaletteId);
        console.log("[handleGenerateAudio] Initial paletteId SET:", currentPaletteId);
      }

      const prompt = await import('/src/utils/promptBuilder.js')
        .then(module => module.buildPrompt(caption, section.instruments, sectionIndex, { paletteId: currentPaletteId, genre: store.get('genre') }));
      
      console.log('[handleGenerateAudio] Generated prompt for Stable Audio:', prompt);
      console.log(`[handleGenerateAudio] Calling api.generateAudio with BPM: ${bpmForAudioCall}`);
      
      const audioResult = await api.generateAudio(prompt, bpmForAudioCall, { duration: 15 });
      console.log('[handleGenerateAudio] Audio generation successful. Result:', audioResult);

      if (!audioResult || !audioResult.audioBlob) {
        throw new Error("Audio generation did not return a valid audioBlob.");
      }

      // Decode blob to AudioBuffer
      const arrayBuffer = await audioResult.audioBlob.arrayBuffer();
      const audioContext = getAudioContext(); // from src/audio/audioContext.js
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      console.log('[handleGenerateAudio] Audio decoded into AudioBuffer:', audioBuffer);

      const audioUrl = URL.createObjectURL(audioResult.audioBlob);

      // Extract server file ID from response headers if available
      let serverFileId = null;
      if (audioResult.serverFileId) {
        serverFileId = audioResult.serverFileId;
        console.log('[handleGenerateAudio] Server file ID received from api.js:', serverFileId);
      } else if (audioResult.headers && audioResult.headers['x-file-id']) {
        serverFileId = audioResult.headers['x-file-id'];
        console.log('[handleGenerateAudio] Server file ID extracted from headers:', serverFileId);
      }
      
      // Debugging for missing serverFileId
      if (!serverFileId) {
        console.warn('[handleGenerateAudio] No server file ID found in audio result:', audioResult);
        
        // Check if all headers are available to verify header key names
        if (audioResult.headers) {
          console.log('[handleGenerateAudio] All response headers:', audioResult.headers);
          
          // Try to find any header that might contain a UUID
          const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
          for (const [key, value] of Object.entries(audioResult.headers)) {
            if (uuidPattern.test(value)) {
              console.log(`[handleGenerateAudio] Found potential UUID in header ${key}: ${value}`);
              serverFileId = value;
              break;
            }
          }
        }
      }

      // Store AudioBuffer and URL in SectionManager
      sectionManager.setSectionAudio(section.id, audioBuffer, audioUrl);
      
      const updatedSection = {
        ...section,
        audioUrl: audioUrl,
        audioDuration: audioBuffer.duration,
        status: 'ready',
        bpm: audioResult.bpm, 
        key: audioResult.key,
        serverFileId: serverFileId // Store the server file ID for persistent loading
      };
      
      // Extra debug logging for debugging the serverFileId
      console.log(`[handleGenerateAudio] Updating section ${section.id} with serverFileId: ${serverFileId || 'MISSING!'}`);
      console.log('[handleGenerateAudio] Full updated section:', updatedSection);
      
      const updatedSections = [...sections];
      updatedSections[sectionIndex] = updatedSection;
      store.set('sections', updatedSections);
      
      this.state.currentSectionId = section.id;
      this.renderSections();
      this.renderSectionEditor();
      this.updateCreateMixButton();
      alert('Audio generation complete!');
      
      if (sectionIndex === 0 && audioResult) { 
        if (store.get('bpm')) this.elements.bpmInput.disabled = true;
        if (store.get('genre')) this.elements.genreSelect.disabled = true;
      }

    } catch (error) {
      console.error('[handleGenerateAudio] Error generating or processing audio:', error);
      alert(`Error during audio generation: ${error.message}`);
      // Reset section status if generation failed critically
      if (section) { // Ensure section exists before trying to update it
        this.updateSectionStatusInStore(section.id, { status: 'selected' }); // Use the new method
      }
    } finally {
      this.elements.generateBtn.disabled = false;
      this.elements.generateBtn.textContent = 'Generate Audio';
    }
  }
  
  // Handle creating a mix
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
      console.log("Mix container display set to 'block'"); // Debug log
      
      this.updateMixStatusUI('stitching_local', 'Starting local audio stitching...', 0); // Initial UI update
      
      // Create mix locally
      const stitchedWavBlob = await sectionManager.createLocalStitchedSong();
      
      if (stitchedWavBlob) {
        this.updateMixStatusUI('completed_local', 'Local song stitching complete! Ready for playback.', 100);
        
        // Create a download link for the blob
        const downloadUrl = URL.createObjectURL(stitchedWavBlob);
        const filename = `stitched_song_${Date.now()}.wav`;

        // Update UI to show download button/link and audio player
        if (this.elements.audioPlayerContainer) {
            this.elements.audioPlayerContainer.style.display = 'block';
            console.log("Audio player container display set to 'block'"); // Debug log
        }
        
        if (this.elements.audioPlayer) {
            this.elements.audioPlayer.src = downloadUrl; // Allow playback before download
            this.elements.audioPlayer.load(); // Force browser to load the new audio source
            console.log("Audio player source set to:", downloadUrl);
            
            // Try to autoplay (may be blocked by browser)
            this.elements.audioPlayer.play().catch(e => console.log('Auto-play prevented by browser:', e));
        }
        
        if (this.elements.downloadMixBtn) {
            this.elements.downloadMixBtn.disabled = false;
            this.elements.downloadMixBtn.onclick = () => {
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            };
            this.elements.downloadMixBtn.textContent = "Download Stitched Song";
        }
         // Hide Tonn-specific final mix button if it exists and we are in local stitching mode
        if (this.elements.createFinalMixBtn) {
            this.elements.createFinalMixBtn.style.display = 'none';
        }

      } else {
        throw new Error("Local stitching did not return a WAV blob.");
      }

    } catch (error) {
      console.error('Error during local mix creation:', error);
      this.updateMixStatusUI('error', `Error creating local mix: ${error.message}`, 0);
    }
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
      
      // Set section content
      item.innerHTML = `
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
        
        // Show/hide player & download based on status
        const isCompleted = status === 'completed' || status === 'completed_local';
        if (this.elements.audioPlayerContainer) {
            this.elements.audioPlayerContainer.style.display = isCompleted ? 'block' : 'none';
            console.log(`Audio player container display: ${isCompleted ? 'block' : 'none'}`);
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
      { id: 'guitar', name: 'Guitar', desc: 'Electric or Acoustic' },
      { id: 'bass', name: 'Bass', desc: 'Low Frequencies' },
      { id: 'keys_synth', name: 'Keys/Synth', desc: 'Piano, Synth sounds' } // Combined option
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
      option.addEventListener('click', () => this.handleInstrumentOptionClick(option, grid));
      grid.appendChild(option);
    });
  }

  handleInstrumentOptionClick(optionElement, gridElement) {
    const maxSelection = 3; // User can still select up to 3 from the new list if desired
    const currentlySelectedOptions = gridElement.querySelectorAll('.instrument-option.selected');

    if (optionElement.classList.contains('selected')) {
      optionElement.classList.remove('selected');
    } else {
      if (currentlySelectedOptions.length < maxSelection) {
        optionElement.classList.add('selected');
      } else {
        alert(`You can select up to ${maxSelection} instruments.`);
      }
    }
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
    // Note: hw.onStatus and hw.onMessage are set within handleConnectArduino upon successful connection
    // to avoid them being active if connection fails or is not yet attempted.
  }

  async handleConnectArduino() {
    if (this.state.arduinoConnected) {
      await hw.disconnect();
      // onStatus callback will handle UI updates for disconnection
    } else {
      const connected = await hw.connect();
      if (connected) {
        hw.onStatus(this.handleArduinoStatus);
        hw.onMessage(this.handleArduinoMessage);
        // UI update for connection status is handled by onStatus callback
        // Send initial state upon connection is also handled by onStatus
      } else {
        // Handle connection failure explicitly if needed, though onStatus might also cover it
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
    this.state.arduinoConnected = hw.getConnectionStatus(); // Update based on hardware module
    if (this.elements.connectArduinoBtn) {
        this.elements.connectArduinoBtn.textContent = this.state.arduinoConnected ? 'Disconnect Arduino' : 'Connect Arduino';
    }
    if (this.state.arduinoConnected) {
        this.startArduinoUpdates(); // Start sending data if connected
    } else {
        this.stopArduinoUpdates(); // Stop if disconnected
    }
  }
  
  handleArduinoMessage(data) {
    console.log("[Arduino Message]:", data);
    if (data && typeof data.btn !== 'undefined') {
        this.processArduinoButtonPress(data.btn);
    }
    // Potentially handle other types of messages from Arduino here
  }

  processArduinoButtonPress(buttonId) {
    console.log(`Arduino Button ${buttonId} pressed and processed by app.`);
    // Placeholder for actual logic - map buttonId to actions
    // Example: Instrument selection or triggering capture
    const currentSection = this.getCurrentSection();

    // Buttons 0-3 for instrument selection (map to your instrument IDs)
    const instrumentMap = ['drums', 'bass', 'guitar', 'keys_synth']; // Ensure this matches your instrument IDs

    if (buttonId >= 0 && buttonId < instrumentMap.length) {
        if (!currentSection) {
            alert("Please select or add a section to assign instruments.");
            return;
        }
        const instrumentId = instrumentMap[buttonId];
        let currentInstruments = currentSection.instruments ? [...currentSection.instruments] : [];
        
        if (currentInstruments.includes(instrumentId)) {
            currentInstruments = currentInstruments.filter(inst => inst !== instrumentId);
        } else {
            if (currentInstruments.length < 3) {
                currentInstruments.push(instrumentId);
            } else {
                alert("Maximum 3 instruments can be selected.");
                return; // Do not add if max is reached
            }
        }
        this.updateSectionStatusInStore(currentSection.id, { instruments: currentInstruments, status: 'selected' });
        this.renderSectionEditor(); // Re-render to show updated selections
    } else if (buttonId === 4) { // Assuming button 4 is the 'action' button
        console.log("Action button (4) pressed on Arduino.");
        // Example: Trigger image capture if a section is selected
        if (currentSection) {
            this.captureImage();
        } else {
            alert("Please select a section before using the action button.");
        }
    }
    this.sendInfoToArduino(); // Update Arduino display after action
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

    // LED 5 (index 4) could indicate recording status or other state
    // For now, let's make it blink if music is playing
    if (sectionManager.isPlaying) {
        // Simple blink: toggle based on time to simulate blink if continuously called
        // Or just set to 1 if playing for simplicity in Arduino sketch
        ledArray[4] = 1; 
    }
    return ledArray;
  }

  sendInfoToArduino() {
    if (!this.state.arduinoConnected || !hw.getConnectionStatus()) return;

    const currentSessionStore = store.getAll();
    const currentSectionFromStore = this.getCurrentSection(); // Uses this.state.currentSectionId
    
    const dataToSend = {
        lcd_l1: `BPM:${currentSessionStore.bpm || '---'} ${currentSessionStore.genre || '----'}`.substring(0, 16),
        lcd_l2: (currentSectionFromStore ? (currentSectionFromStore.caption?.section || currentSectionFromStore.type || 'Sel Sec') : 'No Sec').substring(0, 16),
        leds: this.getLedStates(),
        vu: sectionManager.getAudioLevel() || 0
    };
    
    const dataString = JSON.stringify(dataToSend);
    if (dataString === this.state.lastArduinoDataSent && !sectionManager.isPlaying) {
      // Only skip if not playing; VU meter needs frequent updates during playback
      return;
    }

    hw.send(dataToSend);
    this.state.lastArduinoDataSent = dataString;
    // console.log("[To Arduino]:", dataString); // Can be verbose, uncomment for debugging
  }

  startArduinoUpdates() {
    if (this.arduinoUpdateInterval) clearInterval(this.arduinoUpdateInterval);
    this.arduinoUpdateInterval = setInterval(this.sendInfoToArduino, 300);
    console.log("Started sending periodic updates to Arduino.");
  }

  stopArduinoUpdates() {
    if (this.arduinoUpdateInterval) clearInterval(this.arduinoUpdateInterval);
    this.arduinoUpdateInterval = null;
    console.log("Stopped sending periodic updates to Arduino.");
    // Optionally send a "clear" or "disconnected" message to Arduino LCD
    if(hw.getConnectionStatus()){ // Check if it was connected before stopping updates
        hw.send({lcd_l1: "Frontend StpUpd", lcd_l2: "...", leds: [0,0,0,0,0], vu: 0});
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
}

// Initialize the app
window.addEventListener('DOMContentLoaded', () => {
  window.app = new MusicGeneratorApp();
});
 