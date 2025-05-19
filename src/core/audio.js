/**
 * audio.js - Continuous Playback Engine
 * 
 * Handles seamless looping, hot-swapping, and transitioning between 
 * raw sections and mixed versions without interrupting audio flow.
 */

import { getAudioContext } from '../audio/audioContext.js';

class ContinuousPlaybackEngine {
  constructor() {
    this.audioContext = getAudioContext();
    this.sections = [];
    this.mixedVersion = null;
    this.isPlaying = false;
    this.currentSectionIndex = 0;
    this.loopCount = 0;
    this.scheduledSources = [];
    this.nextSwapSections = null;
    this.lookaheadTime = 0.5; // seconds
    this.nextSectionStartTime = 0;
    this.transitionScheduled = false;
    this.onLoopCallback = null;
    this.onSectionChangeCallback = null;
    this.crossfadeDuration = 0.2; // seconds (default, will be updated based on BPM)
    this.masterGain = null;
    this.analyserNode = null;
    this.mixedBuffer = null;
    this.pendingMixTransition = false;
    this.isInMixedMode = false;
    this.onMixTransitionCallback = null;
    this.nextScheduleTime = 0;
    this.mixTransitionType = null;
    this.transitionImmediate = false;
    this.lastTransitionId = null;
    
    // Track the last attempted mastering task ID to avoid repeated attempts
    this.lastMasteringTaskId = null;
  }

  /**
   * Initialize audio nodes
   */
  initialize() {
    // Create master gain node
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 1.0;
    
    // Create analyzer for visualization
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    
    // Connect master chain
    this.masterGain.connect(this.analyserNode);
    this.analyserNode.connect(this.audioContext.destination);
    
    return this;
  }

  /**
   * Set the sections to be played
   * @param {Array} sections Array of {buffer, id} objects
   */
  setSections(sections) {
    this.sections = sections;
    console.log(`[ContinuousPlaybackEngine] Set ${sections.length} sections for playback`);
    return this;
  }

  /**
   * Update crossfade duration based on BPM
   * @param {number} bpm Beats per minute
   */
  setCrossfadeDuration(bpm) {
    // Increase to 2 beats crossfade for smoother transitions
    const beatsPerSecond = bpm / 60;
    this.crossfadeDuration = 2 / beatsPerSecond; // 2 beats instead of 1
    
    // Ensure a minimum crossfade duration of 0.3 seconds for all BPMs
    this.crossfadeDuration = Math.max(0.3, this.crossfadeDuration);
    
    console.log(`[ContinuousPlaybackEngine] Set crossfade duration to ${this.crossfadeDuration.toFixed(3)}s based on ${bpm} BPM`);
    return this;
  }

  /**
   * Set callback for loop completion
   * @param {Function} callback Function to call when loop completes
   */
  onLoop(callback) {
    this.onLoopCallback = callback;
    return this;
  }

  /**
   * Set callback for section change
   * @param {Function} callback Function to call when section changes
   */
  onSectionChange(callback) {
    this.onSectionChangeCallback = callback;
    return this;
  }

  /**
   * Check if it's time to schedule more audio
   * @private
   */
  _checkScheduling() {
    if (!this.isPlaying) return;
    
    const now = this.audioContext.currentTime;
    
    // If it's time to schedule more audio
    if (now >= this.nextScheduleTime && this.sections.length > 0) {
      // If we've reached or passed the next section start time, schedule the next section
      if (this.nextSectionStartTime <= now + this.lookaheadTime) {
        this.scheduleNextSections();
      }
      
      // Update the next schedule time
      this.nextScheduleTime = now + this.lookaheadTime * 0.5;
    }
    
    // Check if we need to transition to the mixed version at loop boundary
    if (this.pendingMixTransition && this.currentSectionIndex === 0) {
      this._checkForMixTransition();
    }
    
    // Check if a hot swap is pending
    if (this.nextSwapSections && this.currentSectionIndex === 0) {
      console.log('[ContinuousPlayback] Performing hot-swap of content at loop boundary');
      this.sections = [...this.nextSwapSections];
      this.nextSwapSections = null;
    }
    
    // Schedule our next check
    if (this.isPlaying) {
      setTimeout(() => this._checkScheduling(), 100); // Check every 100ms
    }
  }

  /**
   * Start playback
   */
  start() {
    if (this.isPlaying || this.sections.length === 0) return this;
    
    console.log('[ContinuousPlayback] Starting playback with', this.sections.length, 'sections');
    
    this.isPlaying = true;
    
    // Initialize the audio context
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    
    // Create master gain if it doesn't exist
    if (!this.masterGain) {
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 1.0;
      
      // Create analyzer node if it doesn't exist
      if (!this.analyserNode) {
        this.analyserNode = this.audioContext.createAnalyser();
        this.analyserNode.fftSize = 256;
        this.analyserDataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
      }
      
      // Connect master gain to analyzer and then to destination
      this.masterGain.connect(this.analyserNode);
      this.analyserNode.connect(this.audioContext.destination);
    }
    
    // Reset counters
    this.currentSectionIndex = 0;
    this.loopCount = 0;
    
    // Start scheduling
    this.nextSectionStartTime = this.audioContext.currentTime + 0.1; // Small delay to ensure everything is ready
    this.nextScheduleTime = this.audioContext.currentTime;
    
    // Start the scheduling loop
    this._checkScheduling();
    
    return this;
  }

  /**
   * Stop playback
   */
  stop() {
    if (!this.isPlaying) return this;
    
    console.log("[ContinuousPlaybackEngine] Stopping playback");
    
    // Cancel all scheduled sources
    this.scheduledSources.forEach(source => {
      try {
        source.stop();
        source.disconnect();
      } catch (e) {
        // Source might already be stopped
      }
    });
    
    this.scheduledSources = [];
    this.isPlaying = false;
    this.currentSectionIndex = 0;
    
    return this;
  }

  /**
   * Schedule the next sections for playback with lookahead
   * This is the core function for continuous playback
   */
  scheduleNextSections() {
    if (!this.isPlaying || this.sections.length === 0) return;
    
    // Get current section
    const currentIndex = this.currentSectionIndex;
    const currentSection = this.sections[currentIndex];
    
    if (!currentSection || !currentSection.buffer) {
      console.error(`[ContinuousPlaybackEngine] Invalid section at index ${currentIndex}`);
      this.stop();
      return;
    }
    
    // Create source node for current section
    const source = this.audioContext.createBufferSource();
    source.buffer = currentSection.buffer;
    
    // Create gain node for volume/fade control
    const gainNode = this.audioContext.createGain();
    
    // Connect nodes
    source.connect(gainNode);
    gainNode.connect(this.masterGain);
    
    // Get current time and section duration
    const startTime = this.nextSectionStartTime;
    const duration = currentSection.buffer.duration;
    
    // Calculate next section index and determine if we're at loop boundary
    const nextIndex = (currentIndex + 1) % this.sections.length;
    const isLoopBoundary = nextIndex === 0;
    
    // Apply fades with improved curve
    this.applyFades(gainNode, startTime, duration);
    
    // Start the source
    source.start(startTime);
    this.scheduledSources.push(source);
    
    // Calculate next start time accounting for crossfade
    // Make sure sections overlap properly for seamless transition
    this.nextSectionStartTime = startTime + duration - this.crossfadeDuration;
    
    // For mastered audio, we want to make sure transitions are perfect
    if (currentSection.type === 'mastered' || currentSection.type === 'mastered-with-appendage') {
      // For mastered audio, let's log the precise timing
      console.log(`[ContinuousPlaybackEngine] Scheduled mastered audio at ${startTime.toFixed(3)}s, duration: ${duration.toFixed(3)}s, next start: ${this.nextSectionStartTime.toFixed(3)}s`);
    }
    
    // Handle loop boundary
    if (isLoopBoundary && this.onLoopCallback) {
      // Schedule loop callback
      setTimeout(() => {
        this.loopCount++;
        this.onLoopCallback(this.loopCount);
        
        // Check for hot swap at loop boundary
        if (this.nextSwapSections) {
          console.log("[ContinuousPlaybackEngine] Hot-swapping sections at loop boundary");
          this.sections = this.nextSwapSections;
          this.nextSwapSections = null;
        }
        
        // Check for mixed version transition at loop boundary
        if (this.transitionScheduled && this.mixedVersion) {
          console.log("[ContinuousPlaybackEngine] Transitioning to mixed version at loop boundary");
          this.transitionToMixedVersion();
        }
      }, (startTime + duration - this.audioContext.currentTime) * 1000);
    }
    
    // Notify section change
    if (this.onSectionChangeCallback) {
      setTimeout(() => {
        this.onSectionChangeCallback(currentIndex, currentSection.id);
      }, (startTime - this.audioContext.currentTime) * 1000);
    }
    
    // Clean up source when done
    source.onended = () => {
      source.disconnect();
      const index = this.scheduledSources.indexOf(source);
      if (index !== -1) {
        this.scheduledSources.splice(index, 1);
      }
    };
    
    // Update current section index
    this.currentSectionIndex = nextIndex;
    
    // Schedule next section before this one finishes
    // Use setTimeout to avoid call stack issues with very short sections
    const scheduleDelay = Math.max(0, (startTime + duration - this.crossfadeDuration - this.lookaheadTime - this.audioContext.currentTime) * 1000);
    setTimeout(() => {
      if (this.isPlaying) {
        this.scheduleNextSections();
      }
    }, scheduleDelay);
  }

  /**
   * Apply fade in/out to a gain node
   * @param {GainNode} gainNode The gain node to control
   * @param {number} startTime Start time in seconds
   * @param {number} duration Duration in seconds
   */
  applyFades(gainNode, startTime, duration) {
    // Improved fading curve for smoother transitions
    
    // Start silent
    gainNode.gain.setValueAtTime(0, startTime);
    
    // Calculate fade durations
    const fadeInDuration = Math.min(this.crossfadeDuration, duration / 3);
    
    // Fade in with a slight curve for more natural sound
    gainNode.gain.setValueCurveAtTime(
      new Float32Array([0, 0.2, 0.5, 0.8, 1]), 
      startTime, 
      fadeInDuration
    );
    
    // Calculate fade out start time
    const fadeOutStartTime = startTime + duration - this.crossfadeDuration;
    
    // Maintain full volume until fade out
    gainNode.gain.setValueAtTime(1, fadeOutStartTime);
    
    // Fade out with a curve for smoother ending
    gainNode.gain.setValueCurveAtTime(
      new Float32Array([1, 0.8, 0.5, 0.2, 0]), 
      fadeOutStartTime, 
      this.crossfadeDuration
    );
  }

  /**
   * Schedule a transition to the mixed version at the next loop boundary
   * Enhanced to support seamless transitions and audio type tracking
   * @param {AudioBuffer} mixedBuffer - The mixed audio buffer
   * @param {Object} options - Transition options
   * @param {string} options.type - Type of mix ('stitched', 'preview', 'final', 'mastered')
   * @param {boolean} options.immediate - If true, transition as soon as possible
   * @param {string} options.taskId - Optional task ID for tracking mastering tasks
   */
  scheduleMixTransition(mixedBuffer, options = {}) {
    if (!mixedBuffer || !this.isPlaying) {
      console.log('[ContinuousPlayback] Cannot schedule mix transition: No mixed buffer or not playing');
      return;
    }
    
    // Track all transition requests for debugging
    const transitionId = `transition-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    console.log(`[ContinuousPlayback] [${transitionId}] Scheduling transition to ${options.type || 'unknown'} audio:`, {
      bufferDuration: mixedBuffer.duration,
      currentSections: this.sections.length,
      loopCount: this.loopCount,
      immediate: !!options.immediate,
      sampleRate: mixedBuffer.sampleRate,
      channels: mixedBuffer.numberOfChannels,
      taskId: options.taskId || 'none'
    });
    
    // For mastering tasks, track the task ID to avoid conflicts
    if (options.type === 'mastered' && options.taskId) {
      this.lastMasteringTaskId = options.taskId;
      console.log(`[ContinuousPlayback] [${transitionId}] Tracking mastering task ID: ${options.taskId}`);
    }
    
    // Store the mixed buffer for transition at next loop boundary
    this.mixedBuffer = mixedBuffer;
    this.pendingMixTransition = true;
    this.mixTransitionType = options.type || 'unknown';
    
    // Force mastered audio to always transition at loop boundaries for maximum smoothness
    this.transitionImmediate = options.type === 'mastered' ? false : !!options.immediate;
    
    this.lastTransitionId = transitionId;
    
    // Special handling for mastered audio - always prefer loop boundary transition
    if (options.type === 'mastered') {
      console.log(`[ContinuousPlayback] [${transitionId}] Mastered audio will transition at next loop boundary for smoothness`);
      
      // If there's a standalone audio player playing, ensure it will be stopped at transition time
      if (typeof document !== 'undefined') {
        const audioPlayer = document.getElementById('audio-player');
        if (audioPlayer && !audioPlayer.paused) {
          console.log(`[ContinuousPlayback] [${transitionId}] Will pause standalone audio player at transition`);
          // We'll pause it during the actual transition
        }
      }
      
      return;
    }
    
    // If immediate transition requested or if we're at a good transition point, perform now
    if (this.transitionImmediate) {
      // Find the optimal transition point - either right now or at the next section boundary
      console.log(`[ContinuousPlayback] [${transitionId}] Immediate transition requested, finding optimal point`);
      
      // If we're very close to a section boundary, wait for it
      const now = this.audioContext.currentTime;
      const timeUntilNextSection = this.nextSectionStartTime - now;
      
      if (timeUntilNextSection > 0 && timeUntilNextSection < 0.5) {
        // We're close to a natural section boundary, wait for it
        console.log(`[ContinuousPlayback] [${transitionId}] Section boundary in ${timeUntilNextSection.toFixed(3)}s, waiting for clean transition`);
      } else {
        // We're not close to a section boundary, transition now with crossfade
        console.log(`[ContinuousPlayback] [${transitionId}] Executing immediate transition with crossfade`);
        this._performImmediateTransition(transitionId);
        return;
      }
    }
    
    // If at a loop boundary already or loop is very short, transition immediately
    const now = this.audioContext.currentTime;
    const totalLoopDuration = this.sections.reduce((total, section) => total + (section.buffer ? section.buffer.duration : 0), 0);
    
    if (this.currentSectionIndex === 0 || totalLoopDuration < 1.0) {
      console.log(`[ContinuousPlayback] [${transitionId}] At loop boundary or short loop, transitioning immediately`);
      this._performImmediateTransition(transitionId);
      return;
    }
    
    console.log(`[ContinuousPlayback] [${transitionId}] Transition scheduled for next loop boundary`);
  }
  
  /**
   * Perform an immediate transition to the mixed buffer with crossfade
   * @private
   * @param {string} transitionId - Unique ID for this transition for logging
   */
  _performImmediateTransition(transitionId = 'immediate') {
    if (!this.mixedBuffer) {
      console.warn(`[ContinuousPlayback] [${transitionId}] Cannot perform immediate transition: No mixed buffer available`);
      return;
    }
    
    const now = this.audioContext.currentTime;
    const crossfadeDuration = this.crossfadeDuration;
    
    // Create a source for the mixed buffer
    const mixedSource = this.audioContext.createBufferSource();
    mixedSource.buffer = this.mixedBuffer;
    
    // Create a gain node for volume control
    const mixedGain = this.audioContext.createGain();
    mixedSource.connect(mixedGain);
    mixedGain.connect(this.masterGain);
    
    // Start with gain at 0 and fade in using a curve for smoother transition
    mixedGain.gain.setValueAtTime(0, now);
    
    // Use a curve for smoother fade-in
    mixedGain.gain.setValueCurveAtTime(
      new Float32Array([0, 0.2, 0.5, 0.8, 1]), 
      now, 
      crossfadeDuration
    );
    
    // Start the mixed source immediately
    mixedSource.start(now);
    this.scheduledSources.push(mixedSource);
    
    // Fade out all currently playing sources
    const currentlyPlaying = [...this.scheduledSources]; // Create a copy to avoid modification issues
    currentlyPlaying.forEach(source => {
      if (source !== mixedSource) {
        try {
          // Find the gain node for this source or create one
          let gainNode = source.gainNode;
          if (!gainNode) {
            // If source doesn't have a gainNode, we need to create one
            console.log(`[ContinuousPlayback] [${transitionId}] Creating new gain node for existing source`);
            gainNode = this.audioContext.createGain();
            gainNode.gain.value = 1.0; // Assume it was playing at full volume
            
            // Disconnect source from its current connections
            source.disconnect();
            
            // Reconnect through our new gain node
            source.connect(gainNode);
            gainNode.connect(this.masterGain);
            
            // Store the gain node for later
            source.gainNode = gainNode;
          }
          
          // Fade out using curve for smoother transition
          gainNode.gain.setValueAtTime(gainNode.gain.value, now);
          gainNode.gain.setValueCurveAtTime(
            new Float32Array([gainNode.gain.value, 0.8, 0.5, 0.2, 0]), 
            now, 
            crossfadeDuration
          );
          
          // Schedule source to stop after fade out
          setTimeout(() => {
            try {
              source.stop();
              source.disconnect();
              
              // Remove from scheduled sources array
              const index = this.scheduledSources.indexOf(source);
              if (index !== -1) {
                this.scheduledSources.splice(index, 1);
              }
            } catch (stopError) {
              // Source might already be stopped
              console.warn(`[ContinuousPlayback] [${transitionId}] Error stopping source:`, stopError);
            }
          }, crossfadeDuration * 1000);
        } catch (e) {
          // Source might already be stopped or have other issues
          console.warn(`[ContinuousPlayback] [${transitionId}] Error during fade-out:`, e);
        }
      }
    });
    
    // Store the gain node for later access
    mixedSource.gainNode = mixedGain;
    
    // Update state
    this.isInMixedMode = true;
    this.pendingMixTransition = false;
    
    // Get the type of the new audio (mastered, final, etc.)
    const audioType = this.mixTransitionType || 'unknown';
    
    // Replace sections with the mixed buffer
    this._originalSections = [...this.sections];
    this.sections = [{
      id: `mixed-version-${audioType}-${Date.now()}`,
      buffer: this.mixedBuffer,
      type: audioType,
      taskId: this.lastMasteringTaskId // Include task ID for future reference
    }];
    
    // Reset section index to start from the beginning of the mixed buffer
    this.currentSectionIndex = 0;
    
    // Notify about the transition
    if (this.onMixTransitionCallback) {
      this.onMixTransitionCallback(this.mixedBuffer, audioType);
    }
    
    // Dispatch event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('continuous-playback-mix-transition', {
        detail: {
          mixedBuffer: this.mixedBuffer,
          mixType: audioType,
          loopCount: this.loopCount,
          immediate: true,
          transitionId: transitionId,
          taskId: this.lastMasteringTaskId
        }
      }));
    }
    
    console.log(`[ContinuousPlayback] [${transitionId}] Immediate transition to ${audioType} completed`);
  }
  
  /**
   * Check if a mix transition is pending and perform it at loop boundary
   * @private
   */
  _checkForMixTransition() {
    if (!this.pendingMixTransition || !this.mixedBuffer) return;
    
    // Only transition at loop boundaries (when we're about to start the first section again)
    if (this.currentSectionIndex !== 0) return;
    
    const transitionId = this.lastTransitionId || `loop-${this.loopCount}`;
    console.log(`[ContinuousPlayback] [${transitionId}] Executing transition to ${this.mixTransitionType || 'unknown'} at loop #${this.loopCount}`);
    
    // For mastered audio transitions, we need to ensure the standalone player is paused
    if (this.mixTransitionType === 'mastered' && typeof document !== 'undefined') {
      const audioPlayer = document.getElementById('audio-player');
      if (audioPlayer && !audioPlayer.paused) {
        console.log(`[ContinuousPlayback] [${transitionId}] Pausing standalone audio player to prevent audio conflict`);
        audioPlayer.pause();
      }
      
      // Also hide the audio player container if it exists
      const audioPlayerContainer = document.getElementById('audio-player-container');
      if (audioPlayerContainer) {
        audioPlayerContainer.style.display = 'none';
      }
    }
    
    // Save the original sections for potential restoration
    this._originalSections = [...this.sections];
    
    // Get the type of the new audio (mastered, final, etc.)
    const audioType = this.mixTransitionType || 'unknown';
    
    // Replace sections with the mixed buffer
    this.sections = [{
      id: `mixed-version-${audioType}-${Date.now()}`,
      buffer: this.mixedBuffer,
      type: audioType,
      taskId: this.lastMasteringTaskId // Include task ID for future reference
    }];
    
    // Reset the transition flag
    this.pendingMixTransition = false;
    
    // If we're already in mixed mode and getting another mixed buffer, 
    // we don't need to trigger the transition event again
    if (!this.isInMixedMode) {
      this.isInMixedMode = true;
      
      // Notify that we've transitioned to mixed mode
      if (this.onMixTransitionCallback) {
        this.onMixTransitionCallback(this.mixedBuffer, audioType);
      }
      
      // Dispatch event
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('continuous-playback-mix-transition', {
          detail: {
            mixedBuffer: this.mixedBuffer,
            mixType: audioType,
            loopCount: this.loopCount,
            immediate: false,
            transitionId: transitionId,
            taskId: this.lastMasteringTaskId
          }
        }));
      }
    } else {
      // Still dispatch an event for UI updates even if already in mixed mode
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('continuous-playback-audio-updated', {
          detail: {
            mixedBuffer: this.mixedBuffer,
            mixType: audioType,
            loopCount: this.loopCount,
            taskId: this.lastMasteringTaskId
          }
        }));
      }
    }
    
    console.log(`[ContinuousPlayback] [${transitionId}] Transition to ${audioType} complete. Buffer duration: ${this.mixedBuffer.duration.toFixed(2)}s`);
  }

  /**
   * Transition from sections to the mixed version
   */
  transitionToMixedVersion() {
    if (!this.mixedVersion) return;
    
    // Create source for mixed version
    const source = this.audioContext.createBufferSource();
    source.buffer = this.mixedVersion;
    
    // Create gain node for mixed version
    const gainNode = this.audioContext.createGain();
    source.connect(gainNode);
    gainNode.connect(this.masterGain);
    
    // Start with fade in
    const startTime = this.audioContext.currentTime;
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(1, startTime + this.crossfadeDuration);
    
    // Start the source
    source.start(startTime);
    
    // Stop all currently scheduled sources with fade out
    this.scheduledSources.forEach(existingSource => {
      try {
        // Find the gain node connected to this source
        const connectedGain = existingSource.gainNode;
        if (connectedGain) {
          // Fade out
          connectedGain.gain.setValueAtTime(connectedGain.gain.value, startTime);
          connectedGain.gain.linearRampToValueAtTime(0, startTime + this.crossfadeDuration);
          
          // Stop after fade
          setTimeout(() => {
            existingSource.stop();
            existingSource.disconnect();
          }, this.crossfadeDuration * 1000);
        } else {
          // If no gain node found, just stop immediately
          existingSource.stop();
          existingSource.disconnect();
        }
      } catch (e) {
        // Source might already be stopped
      }
    });
    
    // Reset scheduling
    this.scheduledSources = [source];
    source.gainNode = gainNode; // Store reference to gain node for later manipulation
    
    // Reset transition flag
    this.transitionScheduled = false;
    
    // Switch to mixed playback mode
    this.isPlayingMixedVersion = true;
    
    console.log("[ContinuousPlaybackEngine] Transitioned to mixed version");
    
    return this;
  }

  /**
   * Get current audio level for visualization
   * @returns {number} Audio level from 0-100
   */
  getAudioLevel() {
    if (!this.analyserNode || !this.isPlaying) return 0;
    
    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(dataArray);
    
    // Calculate average level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const average = sum / dataArray.length;
    
    // Scale to 0-100
    return Math.min(100, Math.max(0, (average / 255) * 100 * 1.5));
  }

  /**
   * Prepare new sections for swapping at next loop boundary
   * @param {Array} newSections Array of {buffer, id} objects
   */
  hotSwapContent(newSections) {
    if (!newSections || newSections.length === 0) {
      console.warn("[ContinuousPlaybackEngine] Cannot hot-swap: No new sections provided");
      return this;
    }
    
    this.nextSwapSections = newSections;
    console.log(`[ContinuousPlaybackEngine] Prepared ${newSections.length} new sections for hot-swap at next loop boundary`);
    
    return this;
  }

  /**
   * Add a new section to the current playback queue
   * Enhanced to handle appending to mastered audio
   * @param {Object} section - Section object with buffer and metadata
   * @param {boolean} appendToMastered - Whether to append to mastered audio
   */
  appendSection(section, appendToMastered = false) {
    if (!section || !section.buffer) {
      console.log('[ContinuousPlayback] Cannot append section: No buffer provided');
      return false;
    }

    // Check if we're currently playing a mastered version
    const playingMastered = this.sections.length === 1 && this.sections[0].type === 'mastered';
    
    // Store original sections if we just have mastered version for potential restoration
    if (playingMastered && !this._originalSections) {
      console.log('[ContinuousPlayback] Creating backup of pre-mastered sections');
      this._originalSections = [...this.sections]; // though this may just be mastered audio
    }

    if (appendToMastered && playingMastered) {
      console.log(`[ContinuousPlayback] Appending section to mastered audio`);
      
      // Create a merged audio buffer (mastered + new section)
      const masteredBuffer = this.sections[0].buffer;
      const combinedDuration = masteredBuffer.duration + section.buffer.duration - this.crossfadeDuration;
      
      const combinedBuffer = this.audioContext.createBuffer(
        masteredBuffer.numberOfChannels,
        Math.ceil(combinedDuration * masteredBuffer.sampleRate),
        masteredBuffer.sampleRate
      );
      
      // Copy mastered audio data
      for (let channel = 0; channel < masteredBuffer.numberOfChannels; channel++) {
        const masterData = masteredBuffer.getChannelData(channel);
        const newData = combinedBuffer.getChannelData(channel);
        newData.set(masterData);
      }
      
      // Apply crossfade and copy new section data
      const crossfadeSamples = Math.floor(this.crossfadeDuration * masteredBuffer.sampleRate);
      const masteredEndOffset = masteredBuffer.length - crossfadeSamples;
      
      for (let channel = 0; channel < Math.min(masteredBuffer.numberOfChannels, section.buffer.numberOfChannels); channel++) {
        const newSectionData = section.buffer.getChannelData(channel);
        const combinedData = combinedBuffer.getChannelData(channel);
        
        // Apply crossfade
        for (let i = 0; i < crossfadeSamples; i++) {
          const fadeOutFactor = 1 - (i / crossfadeSamples);
          const fadeInFactor = i / crossfadeSamples;
          
          // Apply crossfade between masteredBuffer and new section
          if (masteredEndOffset + i < combinedData.length) {
            combinedData[masteredEndOffset + i] = 
              (combinedData[masteredEndOffset + i] * fadeOutFactor) + 
              (newSectionData[i] * fadeInFactor);
          }
        }
        
        // Copy the rest of the new section data (after crossfade)
        for (let i = crossfadeSamples; i < newSectionData.length; i++) {
          if (masteredEndOffset + i < combinedData.length) {
            combinedData[masteredEndOffset + i] = newSectionData[i];
          }
        }
      }
      
      // Create a new expanded mastered section
      const expandedMasteredSection = {
        id: `expanded-mastered-${Date.now()}`,
        buffer: combinedBuffer,
        type: 'mastered-with-appendage',
        originalMastered: this.sections[0],
        appendedSection: section
      };
      
      // Replace the current mastered section with the expanded one
      this.hotSwapContent([expandedMasteredSection]);
      
      console.log(`[ContinuousPlayback] Created expanded mastered audio: ${combinedDuration.toFixed(2)}s`);
      return true;
    } else {
      // Normal section append to queue
      console.log(`[ContinuousPlayback] Adding section to playback queue`);
      const updatedSections = [...this.sections, section];
      this.hotSwapContent(updatedSections);
      return true;
    }
  }

  /**
   * Restore original sections if available
   * @returns {boolean} Whether restoration was successful
   */
  restoreOriginalSections() {
    if (!this._originalSections || this._originalSections.length === 0) {
      console.log('[ContinuousPlayback] No original sections to restore');
      return false;
    }
    
    console.log(`[ContinuousPlayback] Restoring ${this._originalSections.length} original sections`);
    this.hotSwapContent([...this._originalSections]);
    return true;
  }

  /**
   * Set mute state without stopping playback
   * @param {boolean} muted - Whether audio should be muted
   * @returns {this} For method chaining
   */
  setMuted(muted) {
    if (!this.masterGain) return this;
    
    // Smoothly transition to prevent clicks
    const audioContext = this.audioContext;
    const now = audioContext.currentTime;
    const transitionTime = 0.1; // 100ms fade
    
    if (muted) {
      // Fade out to silence
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(0, now + transitionTime);
    } else {
      // Fade in to full volume
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(1.0, now + transitionTime);
    }
    
    return this;
  }
  
  /**
   * Toggle mute state
   * @returns {boolean} New mute state
   */
  toggleMute() {
    if (!this.masterGain) return false;
    
    const isMuted = this.masterGain.gain.value < 0.01;
    this.setMuted(!isMuted);
    return !isMuted;
  }
  
  /**
   * Get current mute state
   * @returns {boolean} True if currently muted
   */
  isMuted() {
    if (!this.masterGain) return false;
    return this.masterGain.gain.value < 0.01;
  }
  
  /**
   * Plays a sound effect (stinger, transition, etc.) on top of the current audio
   * @param {string} effectType - Type of effect ('key', 'transition', etc.)
   * @param {object} options - Effect options
   * @returns {this} For method chaining
   */
  playSoundEffect(effectType, options = {}) {
    if (!this.audioContext) return this;
    
    const now = this.audioContext.currentTime;
    
    if (effectType === 'key') {
      // Play a short musical key effect (like a chord stab)
      this._playKeyEffect(now, options);
    } else if (effectType === 'transition') {
      // Play a longer transition effect (like a filter sweep)
      this._playTransitionEffect(now, options);
    }
    
    return this;
  }
  
  /**
   * Play a short musical key effect
   * @private
   */
  _playKeyEffect(startTime, options = {}) {
    const duration = options.duration || 0.3; // Short duration
    const context = this.audioContext;
    
    // Create oscillator for chord
    const chordNotes = options.notes || [261.63, 329.63, 392, 523.25]; // C major by default
    const oscillators = [];
    
    // Create master gain for the effect
    const effectGain = context.createGain();
    effectGain.gain.setValueAtTime(0, startTime);
    effectGain.gain.linearRampToValueAtTime(0.4, startTime + 0.05);
    effectGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    
    // Connect effect to master output, bypassing the main gain to ensure it's heard even when muted
    effectGain.connect(this.analyserNode);
    effectGain.connect(context.destination);
    
    // Create chord oscillators
    chordNotes.forEach(freq => {
      const osc = context.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      
      // Add slight detune for richness
      osc.detune.setValueAtTime(Math.random() * 10 - 5, startTime);
      
      osc.connect(effectGain);
      osc.start(startTime);
      osc.stop(startTime + duration);
      
      oscillators.push(osc);
    });
    
    // Clean up when done
    setTimeout(() => {
      effectGain.disconnect();
    }, (startTime + duration - context.currentTime) * 1000 + 100);
  }
  
  /**
   * Play a longer transition effect
   * @private
   */
  _playTransitionEffect(startTime, options = {}) {
    const duration = options.duration || 2.0; // 2 second default
    const context = this.audioContext;
    
    // Create noise source
    const bufferSize = context.sampleRate * duration;
    const noiseBuffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    
    // Fill with noise
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    
    // Create noise source
    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer;
    
    // Create filter for sweep
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 5.0;
    
    // Create frequency sweep
    filter.frequency.setValueAtTime(100, startTime);
    filter.frequency.exponentialRampToValueAtTime(5000, startTime + duration * 0.5);
    filter.frequency.exponentialRampToValueAtTime(100, startTime + duration);
    
    // Create gain envelope
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.15, startTime + 0.2);
    gain.gain.linearRampToValueAtTime(0.05, startTime + duration * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    
    // Connect
    noise.connect(filter);
    filter.connect(gain);
    
    // Connect effect directly to destination to be heard even when muted
    gain.connect(this.analyserNode);
    gain.connect(context.destination);
    
    // Start
    noise.start(startTime);
    noise.stop(startTime + duration);
    
    // Clean up
    setTimeout(() => {
      gain.disconnect();
    }, (startTime + duration - context.currentTime) * 1000 + 100);
  }

  /**
   * Get current waveform data for visualization
   * @param {number} numPoints - Number of data points to return for the waveform
   * @returns {Uint8Array} Array of waveform data points (scaled 0-15 for Arduino)
   */
  getWaveformData(numPoints = 128) {
    if (!this.analyserNode || !this.isPlaying) {
      // Return a flat line if not playing or no analyser
      const flatLine = new Uint8Array(numPoints);
      for(let i=0; i<numPoints; i++) flatLine[i] = 0; // Max amplitude is 15, so 0 is center
      return flatLine; 
    }
    
    const bufferLength = this.analyserNode.frequencyBinCount; // Usually fftSize / 2
    const timeDomainData = new Uint8Array(bufferLength);
    this.analyserNode.getByteTimeDomainData(timeDomainData);

    const waveform = new Uint8Array(numPoints);
    
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
            sum += timeDomainData[sampleIndex];
            count++;
        }
      }
      let value = count > 0 ? sum / count : 128; // Average value in 0-255 range, default to 128 (silence)
      
      // Scale 0-255 to 0-15 for Arduino (max amplitude 15 for a 32px high wave area, centered)
      // Silence (128) should map to 0 amplitude.
      // Max deviation (0 or 255) should map to 15 amplitude.
      let scaledValue = Math.abs(value - 128) / 128.0 * 15.0; 
      waveform[i] = Math.min(15, Math.max(0, Math.round(scaledValue)));
    }
    return waveform;
  }
}

// Export singleton instance
export const continuousPlaybackEngine = new ContinuousPlaybackEngine().initialize();
