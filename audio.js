// --- Tone.js Setup ---

// Create variables in global scope
let masterVolume, limiter, sidechainCompressor;
let players = {};
let crossFades = {};
let trackListElement;
let toneAvailable = false;
let audioContextReady = false;

// Audio Library to store generated sounds
let audioLibrary = [];
let lastGeneratedAudio = null;

// Helper function to ensure audio context is running
async function ensureAudioContext() {
    if (!toneAvailable) return false;
    
    try {
        // Start the audio context if not already started
        if (Tone.context.state !== "running") {
            console.log("Starting Tone AudioContext...");
            await Tone.start();
            // Add a small delay to ensure context is fully initialized
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        if (Tone.context.state === "running") {
            audioContextReady = true;
            console.log("AudioContext is running");
            return true;
        } else {
            console.warn("AudioContext still not running:", Tone.context.state);
            return false;
        }
    } catch (err) {
        console.error("Error starting audio context:", err);
        return false;
    }
}

// Wait for window load event to ensure everything is ready
window.addEventListener('load', function() {
    console.log("audio.js: Window loaded. Checking for Tone.js...");
    
    // Check if Tone.js is available
    if (typeof Tone !== 'undefined') {
        console.log("Tone.js found in global scope:", Tone.version);
        toneAvailable = true;
        
        // Setup audio components when Tone is available
        setupAudioComponents();
        
        // Setup user interface elements
        setupUIElements();
    } else {
        console.error("Tone.js is not available in the global scope!");
        
        // Show error message
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.innerHTML = '<strong>ERROR:</strong> Tone.js library not loaded. Audio playback will not work.';
        errorDiv.style.color = 'red';
        errorDiv.style.padding = '10px';
        errorDiv.style.margin = '10px';
        errorDiv.style.border = '1px solid red';
        document.body.prepend(errorDiv);
        
        // Set up a retry mechanism
        setTimeout(function() {
            if (typeof Tone !== 'undefined') {
                console.log("Tone.js found after delay, initializing...");
                toneAvailable = true;
                errorDiv.remove();
                setupAudioComponents();
                setupUIElements();
            }
        }, 2000);
    }
});

// Setup all Tone.js components
function setupAudioComponents() {
    if (!toneAvailable) {
        console.error("Cannot setup audio components - Tone.js not available");
        return;
    }
    
    console.log("Setting up Tone.js audio components...");
    
    try {
        // Master volume and limiter for safety
        masterVolume = new Tone.Volume(-6).toDestination(); 
        limiter = new Tone.Limiter(-1).connect(masterVolume);
    
        // Sidechain Compressor Setup
        sidechainCompressor = new Tone.Compressor({
            threshold: -24,
            ratio: 6,
            attack: 0.01,
            release: 0.2
        }).connect(limiter);
    
        // Transport setup
        Tone.Transport.bpm.value = 90;
        Tone.Transport.timeSignature = 4;
        
        console.log("Tone.js audio components ready. Context state:", Tone.context.state);
    } catch (error) {
        console.error("Error setting up Tone.js components:", error);
        toneAvailable = false;
    }
}

// Setup UI elements and event listeners
function setupUIElements() {
    trackListElement = document.getElementById('track-list');
    
    // Setup test sound button
    const testSoundButton = document.getElementById('test-sound-button');
    if (testSoundButton) {
        testSoundButton.addEventListener('click', async () => {
            console.log("Test sound button clicked");
            
            if (!toneAvailable) {
                console.error("Cannot play test sound - Tone.js not available");
                alert("Audio system not available. Please reload the page.");
                return;
            }
            
            // Play a simple test sound
            try {
                // Ensure audio context is running
                const contextReady = await ensureAudioContext();
                if (!contextReady) {
                    alert("Failed to start audio context. Please click again or try a different browser.");
                    return;
                }
                
                // Play a simple test beep using HTML5 Audio API
                playTestBeep();
            } catch (e) {
                console.error("Error playing test sound:", e);
                alert("Failed to play test sound: " + e.message);
            }
        });
    }
}

// Function to play a test beep using HTML5 Audio API
function playTestBeep() {
    // Create a test beep (A4 - 440Hz)
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    // Configure nodes
    oscillator.type = 'sine';
    oscillator.frequency.value = 440;
    gainNode.gain.value = 0.3;
    
    // Add fade-out
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.5);
    
    // Connect and start
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.5);
    
    console.log("Playing test beep (A4) using HTML5 Audio API");
}

// Function to load audio blob into a Tone.Player - exported to global scope
window.loadAndPlayAudio = async function(audioResult, instrumentType) {
    console.log(`Loading audio for ${instrumentType}...`, audioResult);

    if (!toneAvailable) {
        console.error("Cannot load audio - Tone.js not available");
        alert("Audio system not available. Please reload the page.");
        return;
    }

    if (!audioResult || !audioResult.audioBlob) {
        console.error("Invalid audio data received.");
        alert("Failed to load audio data.");
        return;
    }
    
    try {
        // Ensure audio context is running
        const contextReady = await ensureAudioContext();
        if (!contextReady) {
            alert("Failed to start audio context. Please try again.");
            return;
        }
        
        // Add a download button for the audio
        addDownloadButton(audioResult.audioBlob, instrumentType);
        
        // Create a defensive copy of the blob
        const safeBlob = new Blob([await audioResult.audioBlob.arrayBuffer()], 
            { type: audioResult.audioBlob.type });
        
        // Convert blob to array buffer
        const arrayBuffer = await safeBlob.arrayBuffer();
        if (!arrayBuffer || arrayBuffer.byteLength === 0) {
            throw new Error("Empty audio data");
        }
        
        // Decode the audio data
        const audioBuffer = await Tone.context.decodeAudioData(arrayBuffer);
        if (!audioBuffer) {
            throw new Error("Failed to decode audio data");
        }
        
        console.log(`Successfully decoded audio for ${instrumentType}, duration:`, audioBuffer.duration);

        // COMPLETELY NEW APPROACH: Use a built-in HTML5 audio element instead of Tone.Player
        // This is more reliable and avoids the complex Tone.js buffer handling
        const audioUrl = URL.createObjectURL(safeBlob);
        const audioElement = new Audio(audioUrl);
        audioElement.loop = true;
        
        // Create a simple gain node for volume control
        const gainNode = Tone.context.createGain();
        gainNode.gain.value = 0.8;
        
        // Create a simple HTML audio element based player
        const simplePlayer = {
            audioElement: audioElement,
            gainNode: gainNode,
            url: audioUrl,
            buffer: audioBuffer,
            mute: false,
            playing: false,
            start() {
                if (!this.playing) {
                    this.audioElement.play().catch(e => console.error("Error playing audio:", e));
                    this.playing = true;
                }
            },
            stop() {
                this.audioElement.pause();
                this.audioElement.currentTime = 0;
                this.playing = false;
            },
            dispose() {
                this.stop();
                URL.revokeObjectURL(this.url);
                this.audioElement.remove();
            },
            volume: {
                value: 0.8,
                rampTo(value, time) {
                    // Simple volume fade
                    const startTime = Tone.now();
                    const endTime = startTime + time;
                    const startVolume = this.value;
                    
                    const fadeInterval = setInterval(() => {
                        const now = Tone.now();
                        if (now >= endTime) {
                            this.value = value;
                            audioElement.volume = value > -40 ? Math.pow(10, value/20) : 0;
                            clearInterval(fadeInterval);
                        } else {
                            const progress = (now - startTime) / time;
                            const currentVolume = startVolume + progress * (value - startVolume);
                            this.value = currentVolume;
                            audioElement.volume = currentVolume > -40 ? Math.pow(10, currentVolume/20) : 0;
                        }
                    }, 50);
                }
            }
        };

        // Update BPM if provided
        if (audioResult.bpm && typeof audioResult.bpm === 'number' && audioResult.bpm > 30) {
            Tone.Transport.bpm.value = audioResult.bpm;
            console.log(`Transport BPM set to ${audioResult.bpm} from API.`);
        } else {
            console.warn(`Invalid or missing BPM from API (${audioResult.bpm}). Using default 120 BPM`);
            Tone.Transport.bpm.value = 120;
        }

        // --- Simple crossfade logic ---
        if (players[instrumentType]) {
            // Existing player found, prepare crossfade
            console.log(`Crossfading new ${instrumentType} loop.`);
            const oldPlayer = players[instrumentType];

            // Simple crossfade approach
            try {
                // Start new player
                simplePlayer.start();
                console.log(`Started new ${instrumentType} player`);
                
                // Fade out old player manually
                if (oldPlayer.volume && oldPlayer.volume.rampTo) {
                    oldPlayer.volume.rampTo(-40, 0.5); // Fade out
                } else {
                    // Simple fallback
                    oldPlayer.audioElement.volume = 0;
                }
                
                // Schedule cleanup
                setTimeout(() => {
                    if (oldPlayer) {
                        oldPlayer.stop();
                        oldPlayer.dispose();
                        console.log(`Disposed old ${instrumentType} player.`);
                    }
                }, 600);
            } catch (fadeError) {
                console.error(`Error during crossfade for ${instrumentType}:`, fadeError);
                // Fallback
                if (oldPlayer && oldPlayer.stop) oldPlayer.stop();
                simplePlayer.start();
            }
        } else {
            // First time loading this instrument
            console.log(`Starting initial ${instrumentType} loop.`);
            simplePlayer.start();
        }

        // Update the players object
        players[instrumentType] = simplePlayer;

        // Update Mixer UI
        updateMixerUI(instrumentType, audioResult);

    } catch (error) {
        console.error(`Error loading or playing audio for ${instrumentType}:`, error);
        alert(`Failed to process audio for ${instrumentType}. ${error.message}`);
    }
};

// Function to add a download button for the generated audio
function addDownloadButton(audioBlob, instrumentType) {
    // Create a track download container if it doesn't exist
    let downloadContainer = document.getElementById('download-container');
    if (!downloadContainer) {
        downloadContainer = document.createElement('div');
        downloadContainer.id = 'download-container';
        downloadContainer.style.margin = '10px 0';
        downloadContainer.innerHTML = '<h3>Downloads</h3>';
        
        // Insert after mixer or at end of body
        const mixer = document.getElementById('mixer-container');
        if (mixer) {
            mixer.after(downloadContainer);
        } else {
            document.body.appendChild(downloadContainer);
        }
    }
    
    // Create download button
    const downloadUrl = URL.createObjectURL(audioBlob);
    const downloadButton = document.createElement('a');
    downloadButton.href = downloadUrl;
    downloadButton.download = `${instrumentType.toLowerCase()}_generated.${audioBlob.type.split('/')[1] || 'wav'}`;
    downloadButton.className = 'download-button';
    downloadButton.innerHTML = `Download ${instrumentType} Audio`;
    downloadButton.style.display = 'block';
    downloadButton.style.margin = '5px 0';
    downloadButton.style.padding = '5px 10px';
    downloadButton.style.backgroundColor = '#4CAF50';
    downloadButton.style.color = 'white';
    downloadButton.style.textDecoration = 'none';
    downloadButton.style.borderRadius = '4px';
    downloadButton.style.textAlign = 'center';
    
    // Remove previous download for this instrument type if exists
    const existingDownload = downloadContainer.querySelector(`a[download^="${instrumentType.toLowerCase()}"]`);
    if (existingDownload) {
        URL.revokeObjectURL(existingDownload.href);
        existingDownload.remove();
    }
    
    // Add to container
    downloadContainer.appendChild(downloadButton);
    
    console.log(`Added download button for ${instrumentType} audio`);
}

// Function to update the mixer UI - exported to global scope
window.updateMixerUI = function(instrumentType, audioResult) {
    if (!trackListElement) {
        trackListElement = document.getElementById('track-list');
        if (!trackListElement) return;
    }

    let trackItem = document.getElementById(`track-${instrumentType}`);
    if (!trackItem) {
        trackItem = document.createElement('div');
        trackItem.id = `track-${instrumentType}`;
        trackItem.className = 'track-item';
        trackItem.innerHTML = `
            <div class="track-status"></div>
            <span class="track-name">${instrumentType}</span>
            <span class="track-info">(${audioResult.key || 'N/A'}, ${audioResult.bpm || 'N/A'} BPM)</span>
            <div class="track-controls">
                <button class="mute-button">Mute</button>
                <input type="range" class="volume-slider" min="0" max="100" value="80" />
            </div>
        `;
        trackListElement.appendChild(trackItem);

        // Add mute functionality
        const muteButton = trackItem.querySelector('.mute-button');
        muteButton.addEventListener('click', () => {
            if (!toneAvailable) return;
            
            const player = players[instrumentType];
            if (player) {
                player.mute = !player.mute;
                if (player.audioElement) {
                    player.audioElement.muted = player.mute;
                }
                muteButton.textContent = player.mute ? 'Unmute' : 'Mute';
                trackItem.style.opacity = player.mute ? 0.6 : 1;
            }
        });
        
        // Add volume control
        const volumeSlider = trackItem.querySelector('.volume-slider');
        volumeSlider.addEventListener('input', () => {
            if (!toneAvailable) return;
            
            const player = players[instrumentType];
            if (player && player.audioElement) {
                const value = volumeSlider.value / 100;
                player.audioElement.volume = value;
            }
        });
    } else {
        // Update existing track info
        const infoSpan = trackItem.querySelector('.track-info');
        if (infoSpan) {
            infoSpan.textContent = `(${audioResult.key || 'N/A'}, ${audioResult.bpm || 'N/A'} BPM)`;
        }
    }
};

// --- Meyda.js BPM Estimation (Fallback) ---
async function estimateBpmWithMeyda(audioBuffer) {
    if (typeof Meyda === 'undefined') {
        console.error("Meyda library not loaded.");
        return null;
    }

    console.log("Estimating BPM with Meyda...");

    // Meyda needs specific parameters for tempo analysis
    const bufferSize = 4096;
    const hopSize = bufferSize / 4;
    const sampleRate = audioBuffer.sampleRate;

    // Create an OfflineAudioContext to process the buffer without playback
    const offlineCtx = new OfflineAudioContext(
        audioBuffer.numberOfChannels,
        audioBuffer.length,
        sampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;

    return new Promise((resolve, reject) => {
        try {
            const meydaAnalyzer = Meyda.createMeydaAnalyzer({
                audioContext: offlineCtx,
                source: source,
                bufferSize: bufferSize,
                hopSize: hopSize,
                sampleRate: sampleRate,
                featureExtractors: ["tempo"],
                callback: features => {
                    if (features && features.tempo) {
                        offlineCtx.tempoResult = features.tempo;
                    }
                }
            });

            source.onended = () => {
                    console.log("Meyda offline processing finished.");
                    if (offlineCtx.tempoResult && offlineCtx.tempoResult.bpm > 30) {
                        resolve(Math.round(offlineCtx.tempoResult.bpm));
                    } else {
                        console.warn("Meyda tempo feature did not produce a valid BPM.", offlineCtx.tempoResult);
                        resolve(null);
                    }
            };

            console.log("Starting Meyda analyzer and offline rendering...");
            meydaAnalyzer.start();
            source.start(0);
            offlineCtx.startRendering().catch(reject);

        } catch (error) {
            console.error("Error setting up Meyda analyzer:", error);
            reject(error);
        }
    });
}

// Function to load audio without automatically playing it
function loadAudioToLibrary(audioResult, instrumentName) {
    console.log(`Loading ${instrumentName} audio to library...`);
    
    // Create a new audio item
    const audioItem = {
        id: Date.now(),
        instrument: instrumentName,
        url: URL.createObjectURL(audioResult.audioBlob),
        buffer: null,
        player: null,
        loaded: false
    };
    
    // Store as last generated audio
    lastGeneratedAudio = audioItem;
    
    // Add to library
    audioLibrary.push(audioItem);
    
    // Load into Tone.js buffer but don't play yet
    const player = new Tone.Player().toDestination();
    
    player.load(audioItem.url).then(() => {
        console.log(`${instrumentName} audio loaded and ready to play`);
        audioItem.loaded = true;
        audioItem.player = player;
        
        // Update UI to show the audio is ready
        updateAudioUI(audioItem);
    }).catch(error => {
        console.error("Error loading audio:", error);
    });
    
    return audioItem;
}

// Function to play and loop the last generated audio
async function playLastGeneratedAudio() {
    if (!lastGeneratedAudio || !lastGeneratedAudio.loaded) {
        console.log("No audio ready to play");
        return false;
    }
    
    console.log(`Playing ${lastGeneratedAudio.instrument} audio`);
    
    try {
        // Ensure audio context is running first
        await ensureAudioContext();
        
        if (lastGeneratedAudio.player) {
            // Make sure the player is properly connected to the destination
            if (!lastGeneratedAudio.player.output.destination) {
                console.log("Reconnecting player to destination");
                lastGeneratedAudio.player.disconnect();
                lastGeneratedAudio.player.toDestination();
            }
            
            // Stop first in case it's already playing
            try {
                lastGeneratedAudio.player.stop();
            } catch (e) {
                console.log("Player wasn't running, starting fresh");
            }
            
            // Set to loop
            lastGeneratedAudio.player.loop = true;
            
            // Start playing with safer method
            setTimeout(() => {
                try {
                    lastGeneratedAudio.player.start();
                    console.log("Successfully started audio playback");
                    
                    // Update UI to show it's playing
                    updatePlayingStateUI(lastGeneratedAudio, true);
                } catch (startError) {
                    console.error("Error starting player:", startError);
                    
                    // Fallback to HTML5 Audio API if Tone.js fails
                    playFallbackAudio(lastGeneratedAudio.url);
                }
            }, 100);
            
            return true;
        } else {
            console.error("Player object not available");
            
            // Try fallback if URL is available
            if (lastGeneratedAudio.url) {
                playFallbackAudio(lastGeneratedAudio.url);
                return true;
            }
        }
    } catch (err) {
        console.error("Error playing audio:", err);
        
        // Try fallback if URL is available
        if (lastGeneratedAudio.url) {
            playFallbackAudio(lastGeneratedAudio.url);
            return true;
        }
    }
    
    return false;
}

// Fallback function that uses standard HTML5 Audio API
function playFallbackAudio(audioUrl) {
    console.log("Using fallback HTML5 Audio API");
    
    // Create a basic audio element
    const audio = new Audio(audioUrl);
    audio.loop = true;
    
    // Play with error handling
    audio.play().then(() => {
        console.log("Fallback audio playing successfully");
    }).catch(err => {
        console.error("Fallback audio play failed:", err);
        alert("Your browser blocked autoplay. Please interact with the page first.");
    });
    
    // Store reference for cleanup
    if (!window.fallbackAudios) {
        window.fallbackAudios = [];
    }
    window.fallbackAudios.push(audio);
    
    return audio;
}

// Update the UI to show the audio in library
function updateAudioUI(audioItem) {
    // Get the track list container
    const trackList = document.getElementById('track-list');
    
    if (!trackList) return;
    
    // Create a new track item
    const trackItem = document.createElement('div');
    trackItem.className = 'track-item';
    trackItem.id = `track-${audioItem.id}`;
    
    // Add instrument info and controls
    trackItem.innerHTML = `
        <div class="track-info">
            <span class="track-name">${audioItem.instrument}</span>
            <span class="track-status">Ready</span>
        </div>
        <div class="track-controls">
            <button class="track-play">Play</button>
            <button class="track-stop">Stop</button>
        </div>
    `;
    
    // Add to track list
    trackList.appendChild(trackItem);
    
    // Add event listeners for play/stop buttons
    const playButton = trackItem.querySelector('.track-play');
    const stopButton = trackItem.querySelector('.track-stop');
    
    playButton.addEventListener('click', async () => {
        if (audioItem.player) {
            try {
                // Ensure audio context is running first
                await ensureAudioContext();
                
                // Make sure the player is properly connected to the destination
                if (!audioItem.player.output || !audioItem.player.output.destination) {
                    console.log("Reconnecting player to destination");
                    audioItem.player.disconnect();
                    audioItem.player.toDestination();
                }
                
                // Stop first in case it's already playing
                try {
                    audioItem.player.stop();
                } catch (e) {
                    console.log("Player wasn't running, starting fresh");
                }
                
                // Set to loop
                audioItem.player.loop = true;
                
                // Start playing with safer method
                setTimeout(() => {
                    try {
                        audioItem.player.start();
                        console.log("Successfully started audio playback from UI button");
                        updatePlayingStateUI(audioItem, true);
                    } catch (startError) {
                        console.error("Error starting player from UI:", startError);
                        // Fallback to HTML5 Audio API
                        if (audioItem.url) {
                            const audio = playFallbackAudio(audioItem.url);
                            if (audio) {
                                updatePlayingStateUI(audioItem, true);
                            }
                        }
                    }
                }, 100);
            } catch (err) {
                console.error("Error playing audio from UI button:", err);
                // Try fallback
                if (audioItem.url) {
                    const audio = playFallbackAudio(audioItem.url);
                    if (audio) {
                        updatePlayingStateUI(audioItem, true);
                    }
                }
            }
        } else if (audioItem.url) {
            // No player but we have a URL, use fallback
            const audio = playFallbackAudio(audioItem.url);
            if (audio) {
                updatePlayingStateUI(audioItem, true);
            }
        }
    });
    
    stopButton.addEventListener('click', () => {
        try {
            if (audioItem.player) {
                audioItem.player.stop();
                updatePlayingStateUI(audioItem, false);
            }
            
            // Also stop any fallback audio
            if (window.fallbackAudios) {
                window.fallbackAudios.forEach(audio => {
                    if (audio && audio.src === audioItem.url) {
                        audio.pause();
                        audio.currentTime = 0;
                    }
                });
            }
        } catch (err) {
            console.error("Error stopping audio:", err);
        }
    });
}

// Update the UI to show playing state
function updatePlayingStateUI(audioItem, isPlaying) {
    const trackItem = document.getElementById(`track-${audioItem.id}`);
    
    if (!trackItem) return;
    
    const statusElement = trackItem.querySelector('.track-status');
    
    if (statusElement) {
        statusElement.textContent = isPlaying ? 'Playing' : 'Ready';
        statusElement.style.color = isPlaying ? '#28a745' : '#6c757d';
    }
}

// Make functions globally available
window.loadAudioToLibrary = loadAudioToLibrary;
window.playLastGeneratedAudio = playLastGeneratedAudio;

console.log("audio.js loaded, waiting for window load event...");
