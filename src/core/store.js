/**
 * store.js - Simple session state management
 * 
 * Maintains the state for the section-based music creation system.
 * Uses a plain object with minimal state management functionality.
 */

// Define the section structure
// Section = {
//   id: string,           // Unique identifier
//   buffer: AudioBuffer,  // Audio data
//   startTime: number,    // When this section starts in the timeline
//   duration: number,     // Duration of this section (typically 15s)
//   caption: object,      // The GPT-4o Vision caption data
//   instruments: string[],// Selected instruments for this section
//   role: string,         // Section role (intro, verse, chorus, bridge, outro)
//   bpm: number,          // BPM for this section (should match global)
//   key: string           // Musical key
// }

// Local Storage Keys
const STORAGE_KEYS = {
  SECTIONS_METADATA: 'music_generator_sections_metadata',
  CAPTIONS: 'music_generator_captions',
  IMAGES: 'music_generator_images',
  GLOBAL_SETTINGS: 'music_generator_settings'
};

// Store data
const storeData = {
  genre: 'pop',
  bpm: 120,
  sections: [],
  mixData: null,
  paletteId: null,
  history: [],
  variationIndex: 0,
  barsPerClip: 4
};

// Event listeners
const listeners = [];

// Store API
export const store = {
  // Initialize properties to match storeData for object properties
  // that are accessed directly
  bpm: storeData.bpm,
  genre: storeData.genre,
  paletteId: storeData.paletteId,
  sections: storeData.sections,
  variationIndex: storeData.variationIndex,
  barsPerClip: storeData.barsPerClip,
  history: storeData.history,
  
  /**
   * Get a value from the store
   * @param {string} key - The key to retrieve
   * @returns {any} The value
   */
  get(key) {
    return storeData[key];
  },
  
  /**
   * Set a value in the store
   * @param {string} key - The key to set
   * @param {any} value - The value to set
   */
  set(key, value) {
    if (typeof key === 'object') {
      // If first arg is object, call updateMultiple instead
      this.updateMultiple(key);
      return;
    }
    
    storeData[key] = value;
    this.notify();
    
    // If certain properties are updated directly, make sure to update the local copy too
    if (key === 'bpm') this.bpm = value;
    if (key === 'genre') this.genre = value;
    if (key === 'paletteId') this.paletteId = value;
    if (key === 'sections') this.sections = value;
    if (key === 'variationIndex') this.variationIndex = value;
    
    // Automatically persist sections to localStorage when they change
    if (key === 'sections') {
      this.saveToLocalStorage();
    }
    
    // Automatically persist global settings when they change
    if (key === 'bpm' || key === 'genre' || key === 'paletteId') {
      this.saveGlobalSettingsToLocalStorage();
    }
  },
  
  /**
   * Update multiple state properties at once
   * @param {object} data - Object with properties to update
   */
  updateMultiple(data) {
    // Save current state to history
    this.saveHistory();
    
    // Update storeData
    Object.assign(storeData, data);
    
    // Update local copies of properties
    if (data.bpm) {
      this.bpm = data.bpm;
      this.barsPerClip = Math.round((15 * data.bpm) / 60 / 4);
    }
    if (data.genre) this.genre = data.genre;
    if (data.paletteId) this.paletteId = data.paletteId;
    if (data.sections) this.sections = data.sections;
    if (data.variationIndex) this.variationIndex = data.variationIndex;
    
    // Notify listeners
    this.notify();
    
    // Automatically persist data if sections or global settings were updated
    if (data.sections) {
      this.saveToLocalStorage();
    }
    
    if (data.bpm || data.genre || data.paletteId) {
      this.saveGlobalSettingsToLocalStorage();
    }
  },
  
  /**
   * Get all data in the store
   * @returns {Object} All store data
   */
  getAll() {
    return { ...storeData };
  },
  
  /**
   * Add a listener to store changes
   * @param {Function} listener - The listener function
   */
  subscribe(listener) {
    listeners.push(listener);
    
    // Return unsubscribe function
    return () => {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    };
  },
  
  /**
   * Notify all listeners of changes
   */
  notify() {
    listeners.forEach(listener => listener(storeData));
  },
  
  // Methods for modifying state
  
  /**
   * Add a new section to the composition
   * @param {object} section - Section object
   */
  addSection(section) {
    // Save current state to history
    this.saveHistory();
    
    // Generate a unique ID if not provided
    if (!section.id) {
      section.id = 'section_' + Date.now();
    }
    
    // If this is the first section, set global parameters
    if (this.sections.length === 0) {
      this.bpm = section.bpm || this.bpm;
      this.genre = section.caption?.genre || this.genre;
      
      // Generate a random palette ID if not already set
      if (!this.paletteId) {
        this.paletteId = 'palette_' + Math.random().toString(36).substring(2, 11);
      }
      
      // Calculate barsPerClip based on BPM
      this.barsPerClip = Math.round((15 * this.bpm) / 60 / 4);
    }
    
    // Calculate startTime based on previous sections
    if (this.sections.length > 0) {
      const lastSection = this.sections[this.sections.length - 1];
      const crossfadeDuration = 2; // 2 seconds crossfade
      section.startTime = lastSection.startTime + lastSection.duration - crossfadeDuration;
    } else {
      section.startTime = 0;
    }
    
    // Push to sections array
    this.sections.push(section);
    
    // Increment variation index for progressive development
    this.variationIndex = (this.variationIndex + 1) % 4;
    
    // Save to localStorage
    this.saveToLocalStorage();
    
    return section;
  },
  
  /**
   * Remove a section by index
   * @param {number} index - Index of section to remove
   */
  removeSection(index) {
    if (index < 0 || index >= this.sections.length) return;
    
    // Save current state to history
    this.saveHistory();
    
    // Remove the section
    this.sections.splice(index, 1);
    
    // Recalculate startTimes for all following sections
    for (let i = index; i < this.sections.length; i++) {
      if (i === 0) {
        this.sections[i].startTime = 0;
      } else {
        const prevSection = this.sections[i - 1];
        const crossfadeDuration = 2; // 2 seconds crossfade
        this.sections[i].startTime = prevSection.startTime + prevSection.duration - crossfadeDuration;
      }
    }
    
    // Save to localStorage
    this.saveToLocalStorage();
  },
  
  /**
   * Get the current variation tag for progressive development
   * @returns {string} Variation tag for the current section
   */
  getVariationTag() {
    const variationTags = [
      'steady groove',      // First section
      'subtle variation',   // Minor changes
      'motif development',  // Evolve themes
      'dynamic evolution'   // Change energy level
    ];
    
    return variationTags[this.variationIndex];
  },
  
  /**
   * Save current state to history for undo
   */
  saveHistory() {
    // Create a deep copy of the current state
    const stateCopy = JSON.parse(JSON.stringify({
      bpm: this.bpm,
      genre: this.genre,
      paletteId: this.paletteId,
      sections: this.sections.map(s => ({...s, buffer: null})), // Exclude buffer (can't stringify)
      variationIndex: this.variationIndex
    }));
    
    // Add to history
    this.history.push(stateCopy);
    
    // Limit history size
    if (this.history.length > 10) {
      this.history.shift();
    }
  },
  
  /**
   * Undo the last change
   */
  undo() {
    if (this.history.length === 0) return;
    
    // Get the last state
    const prevState = this.history.pop();
    
    // Restore everything except buffers (which weren't saved)
    this.bpm = prevState.bpm;
    this.genre = prevState.genre;
    this.paletteId = prevState.paletteId;
    this.variationIndex = prevState.variationIndex;
    
    // For sections, only update the metadata (keep the buffers)
    this.sections = this.sections.filter(s => 
      prevState.sections.find(ps => ps.id === s.id)
    );
    
    // Update section metadata
    this.sections.forEach(section => {
      const prevSection = prevState.sections.find(ps => ps.id === section.id);
      if (prevSection) {
        section.startTime = prevSection.startTime;
        section.duration = prevSection.duration;
        section.caption = prevSection.caption;
        section.instruments = prevSection.instruments;
        section.role = prevSection.role;
      }
    });
    
    // Save to localStorage
    this.saveToLocalStorage();
  },
  
  /**
   * Clear all session data
   */
  clearAll() {
    // Save current state to history
    this.saveHistory();
    
    // Reset to defaults
    this.bpm = 120;
    this.genre = "";
    this.paletteId = "";
    this.sections = [];
    this.lastPreviewAt = null;
    this.previewTaskId = null;
    this.barsPerClip = 4;
    this.variationIndex = 0;
    
    // Clear localStorage
    this.clearLocalStorage();
  },
  
  /**
   * Save sections data to localStorage
   * Serializes section data excluding AudioBuffers
   */
  saveToLocalStorage() {
    try {
      if (!window.localStorage) {
        console.warn('localStorage not available for saving sections');
        return;
      }
      
      // Prepare sections data for storage - we need to exclude any AudioBuffers
      // and serialize only what can be stringified
      const sectionsForStorage = this.sections.map(section => {
        // Create a clean copy of the section without audio data
        const storedSection = {
          id: section.id,
          type: section.type,
          instruments: section.instruments,
          status: section.status,
          caption: section.caption,
          startTime: section.startTime,
          duration: section.duration || 15,
          audioUrl: null, // Don't store the object URL as it won't be valid after refresh
          serverFileId: section.serverFileId, // CRITICAL: Store the server file ID reference
          description: section.description
        };
        
        console.log(`[Store] Saving section ${section.id}, serverFileId: ${section.serverFileId || 'none'}`);
        
        // Store capturedImage separately if available
        if (section.capturedImage) {
          // Store image in its own localStorage key to avoid size limits
          localStorage.setItem(
            `${STORAGE_KEYS.IMAGES}_${section.id}`, 
            section.capturedImage
          );
          // Just keep a flag that image is available
          storedSection.hasStoredImage = true;
        }
        
        return storedSection;
      });
      
      localStorage.setItem(
        STORAGE_KEYS.SECTIONS_METADATA, 
        JSON.stringify(sectionsForStorage)
      );
      
      console.log(`[Store] Saved ${sectionsForStorage.length} sections to localStorage`);
    } catch (error) {
      console.error('[Store] Error saving sections to localStorage:', error);
    }
  },
  
  /**
   * Save global settings to localStorage
   */
  saveGlobalSettingsToLocalStorage() {
    try {
      if (!window.localStorage) {
        console.warn('localStorage not available for saving settings');
        return;
      }
      
      const settings = {
        bpm: this.bpm,
        genre: this.genre,
        paletteId: this.paletteId,
        variationIndex: this.variationIndex,
        barsPerClip: this.barsPerClip
      };
      
      localStorage.setItem(
        STORAGE_KEYS.GLOBAL_SETTINGS, 
        JSON.stringify(settings)
      );
      
      console.log('[Store] Saved global settings to localStorage');
    } catch (error) {
      console.error('[Store] Error saving settings to localStorage:', error);
    }
  },
  
  /**
   * Load sections from localStorage
   * @returns {Array} Loaded sections, or empty array if none found
   */
  loadFromLocalStorage() {
    try {
      console.log('[Store] Attempting to load data from localStorage...');
      
      if (!window.localStorage) {
        console.warn('[Store] localStorage not available for loading sections');
        return [];
      }
      
      // Try to get all localStorage items - for debugging
      let allKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        allKeys.push(localStorage.key(i));
      }
      console.log('[Store] All localStorage keys:', allKeys);
      
      // Load global settings first
      const settingsJson = localStorage.getItem(STORAGE_KEYS.GLOBAL_SETTINGS);
      if (settingsJson) {
        console.log('[Store] Found global settings in localStorage');
        const settings = JSON.parse(settingsJson);
        
        // Update storeData
        storeData.bpm = settings.bpm || 120;
        storeData.genre = settings.genre || 'pop';
        storeData.paletteId = settings.paletteId;
        storeData.variationIndex = settings.variationIndex || 0;
        storeData.barsPerClip = settings.barsPerClip || 4;
        
        // Also update the direct properties
        this.bpm = storeData.bpm;
        this.genre = storeData.genre;
        this.paletteId = storeData.paletteId;
        this.variationIndex = storeData.variationIndex;
        this.barsPerClip = storeData.barsPerClip;
        
        console.log('[Store] Loaded global settings from localStorage:', settings);
      }
      
      // Load sections data
      const sectionsJson = localStorage.getItem(STORAGE_KEYS.SECTIONS_METADATA);
      if (!sectionsJson) {
        console.log('[Store] No saved sections found in localStorage');
        return [];
      }
      
      console.log('[Store] Found sections data in localStorage');
      const loadedSections = JSON.parse(sectionsJson);
      console.log('[Store] Raw sections data:', loadedSections);
      
      // Process each section to load additional data like images
      const processedSections = loadedSections.map(section => {
        // Check if this section has a stored image
        if (section.hasStoredImage) {
          const storedImage = localStorage.getItem(`${STORAGE_KEYS.IMAGES}_${section.id}`);
          if (storedImage) {
            section.capturedImage = storedImage;
          }
        }
        
        // Log serverFileId for each section
        console.log(`[Store] Loaded section ${section.id}, serverFileId: ${section.serverFileId || 'none'}, status: ${section.status}`);
        
        // Make sure any section with serverFileId has its status set appropriately
        if (section.serverFileId) {
          // This section has a server audio file reference, mark it for loading
          section.audioNeedsRegeneration = false;
          
          // If status was 'ready', keep it, and let sectionManager attempt to load the audio
          if (section.status !== 'ready') {
            section.status = 'selected'; // Status will be updated to 'ready' after audio is loaded
          }
        } else if (section.status === 'ready') {
          // This section was 'ready' but has no server file ID, mark it for regeneration
          section.audioNeedsRegeneration = true;
          section.status = 'selected';
        }
        
        return section;
      });
      
      // Update the storeData directly
      storeData.sections = processedSections;
      
      // Update the direct property
      this.sections = processedSections;
      
      console.log(`[Store] Successfully loaded ${processedSections.length} sections from localStorage`);
      // Notify listeners about the loaded data
      this.notify();
      
      return processedSections;
    } catch (error) {
      console.error('[Store] Error loading sections from localStorage:', error);
      return [];
    }
  },
  
  /**
   * Clear all stored data from localStorage
   */
  clearLocalStorage() {
    try {
      if (!window.localStorage) {
        console.warn('localStorage not available for clearing');
        return;
      }
      
      // Clear sections metadata
      localStorage.removeItem(STORAGE_KEYS.SECTIONS_METADATA);
      
      // Clear all section images
      for (const section of this.sections) {
        localStorage.removeItem(`${STORAGE_KEYS.IMAGES}_${section.id}`);
      }
      
      // Clear global settings
      localStorage.removeItem(STORAGE_KEYS.GLOBAL_SETTINGS);
      
      console.log('[Store] Cleared all stored data from localStorage');
    } catch (error) {
      console.error('[Store] Error clearing localStorage:', error);
    }
  }
};
