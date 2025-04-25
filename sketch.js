let cam;
let canvas;

// Instrument selection state
let selectedInstrument = 'DRUMS'; // Default changed back to DRUMS
let filterKey = null; // Key currently held down (e.g., 'q', 'w')
let tintCol = null; // Color for tinting

// Map keys to instruments, colors, and specific prompt tails (Section 8)
// Note: Section 8 mentions different tint colors (orange, teal, etc.) than the button colors in the UI image.
// Using the prompt tails from Section 8, but keeping colors consistent with the UI image/CSS for now.
const instrumentMap = {
    'q': { name: 'DRUMS', color: [108, 117, 125], cssColor: '#6c757d', prompt: "boom-bap drums" },       // Key 1 (Q) -> "boom-bap drums" (UI: Gray)
    'e': { name: 'GUITAR', color: [253, 126, 20], cssColor: '#fd7e14', prompt: "clean electric guitar riff" }, // Key E -> Added generic prompt (UI: Orange)
    'r': { name: 'KEYS', color: [13, 202, 240], cssColor: '#0dcaf0', prompt: "dreamy pad chords" }     // Key 3 (R) -> "dreamy pad chords" (UI: Cyan)
};

// Add filter control functions for Arduino integration

// Global variables for filter control
let currentFilterIndex = 0;
const FILTERS = ["NORMAL", "GRAY", "THRESHOLD", "INVERT", "POSTERIZE", "BLUR"];

// Function to set filter by name - called from serial.js
function setFilterByName(filterName) {
  const index = FILTERS.indexOf(filterName);
  if (index !== -1) {
    currentFilterIndex = index;
    updateFilterDisplay();
    console.log(`Filter changed to: ${FILTERS[currentFilterIndex]}`);
  }
}

// Helper function to update filter display
function updateFilterDisplay() {
  const filterNameElement = document.getElementById('filter-name');
  if (filterNameElement) {
    filterNameElement.textContent = FILTERS[currentFilterIndex];
  }
}

// Apply current filter to video
function applyCurrentFilter(capture) {
  switch (FILTERS[currentFilterIndex]) {
    case "GRAY":
      filter(GRAY);
      break;
    case "THRESHOLD":
      filter(THRESHOLD);
      break;
    case "INVERT":
      filter(INVERT);
      break;
    case "POSTERIZE":
      filter(POSTERIZE, 4);
      break;
    case "BLUR":
      filter(BLUR, 3);
      break;
    default:
      // No filter (NORMAL)
      break;
  }
}

// Make functions available globally
window.setFilterByName = setFilterByName;

// Add global variables to store previous prompts and sounds
let globalBPM = null;
let globalGenre = null;
let globalScale = null;
let previousPrompts = [];
let previousInstruments = new Set();

// Add playback state tracking
let isPlaying = false;

function setup() {
    canvas = createCanvas(640, 360);
    canvas.parent('p5-canvas'); // Place canvas in the div

    // Initialize camera with preference for external webcam
    initCamera();

    // Initial UI update
    updateInfoBar();

    // Add event listener for the capture button
    const captureButton = select('#capture-button');
    captureButton.mousePressed(handleCapture);

    // Add event listener for the confirm button to control playback
    const confirmButton = select('#btn-confirm');
    confirmButton.mousePressed(async () => {
        if (selectedInstrument) {
            // Toggle playback state
            if (isPlaying) {
                stopPlayback();
            } else {
                await startPlayback();
            }
        }
    });

    console.log("p5.js setup complete. Camera initialized.");
}

// Function to initialize camera with preference for external webcam
async function initCamera() {
    try {
        // Get list of video devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        
        console.log("Available video devices:", videoDevices.map(d => d.label || `Camera ${d.deviceId.slice(0, 5)}...`));
        
        // Use external camera if available (usually not the first device)
        let selectedDeviceId;
        
        if (videoDevices.length > 1) {
            // Use the second camera in the list (usually external)
            selectedDeviceId = videoDevices[1].deviceId;
            console.log("Using external camera:", videoDevices[1].label || `Camera ${videoDevices[1].deviceId.slice(0, 5)}...`);
        } else {
            // Fall back to default camera
            selectedDeviceId = videoDevices[0]?.deviceId;
            console.log("Using default camera (no external camera detected)");
        }
        
        // Create capture with specific constraints
        if (selectedDeviceId) {
            const constraints = {
                video: {
                    deviceId: { exact: selectedDeviceId }
                }
            };
            
            cam = createCapture(constraints);
            cam.size(640, 360);
            cam.hide();
        } else {
            // Fallback to standard createCapture if no devices found
            cam = createCapture(VIDEO);
            cam.size(640, 360);
            cam.hide();
        }
    } catch (err) {
        console.error("Error initializing camera:", err);
        // Fallback to standard camera initialization
        cam = createCapture(VIDEO);
        cam.size(640, 360);
        cam.hide();
    }
}

function draw() {
    background(20);
    
    // Draw the video feed with current filter applied
    image(cam, 0, 0, width, height);
    
    // Apply current filter
    applyCurrentFilter(cam);
    
    // Draw the selected instrument indicator
    drawInstrumentIndicator();
}

function keyPressed() {
    const lowerKey = key.toLowerCase();
    if (instrumentMap[lowerKey]) {
        filterKey = lowerKey;
        selectedInstrument = instrumentMap[lowerKey].name;
        tintCol = instrumentMap[lowerKey].color;
        updateInfoBar();
        updateButtonStyles(lowerKey); // Highlight active button
        console.log(`Instrument selected: ${selectedInstrument}`);
    }

    // Prevent default browser behavior for spacebar, etc. if needed
    // return false;
}

function keyReleased() {
    const lowerKey = key.toLowerCase();
    if (instrumentMap[lowerKey] && filterKey === lowerKey) {
        filterKey = null;
        tintCol = null;
        updateButtonStyles(null); // Remove highlight
    }
}

function updateInfoBar() {
    select('#instrument-name').html(selectedInstrument);
    // Update filter name based on tint color or default
    const filterName = filterKey ? selectedInstrument : 'GRAY'; // Or derive from color if needed
    select('#filter-name').html(filterName);
}

function updateButtonStyles(activeKey) {
    // Reset all button styles first
    Object.keys(instrumentMap).forEach(k => {
        const button = select(`#btn-${instrumentMap[k].name.toLowerCase()}`);
        if (button) {
            button.style('border', 'none');
            button.style('transform', 'scale(1)');
        }
    });

    // Apply active style
    if (activeKey && instrumentMap[activeKey]) {
        const button = select(`#btn-${instrumentMap[activeKey].name.toLowerCase()}`);
        if (button) {
            button.style('border', `3px solid ${instrumentMap[activeKey].cssColor}`); // Use border for highlight
             button.style('transform', 'scale(1.05)'); // Slightly enlarge
        }
    }
}

async function handleCapture() {
    if (!selectedInstrument) {
        console.log("Please select an instrument first");
        return;
    }
    console.log(`Capture button clicked. Instrument: ${selectedInstrument}`);
    if (!cam.loadedmetadata) {
        console.error("Camera not ready yet.");
        return;
    }

    // Get the current frame from the canvas
    const frameDataUrl = canvas.elt.toDataURL('image/jpeg', 0.8); // Use canvas element
    console.log("Frame captured as data URL (length):", frameDataUrl.length);
    
    // Add download button for the captured image
    addImageDownloadButton(frameDataUrl);
    
    // Call the API function from api.js
    const audioResult = await sendToBackend(frameDataUrl, selectedInstrument);
    
    if (audioResult && audioResult.audioBlob) {
        // Load the audio into the library
        const audioItem = loadAudioToLibrary(audioResult, selectedInstrument);
        
        // Wait for the audio to be loaded
        await new Promise(resolve => {
            const checkLoaded = setInterval(() => {
                if (audioItem.loaded) {
                    clearInterval(checkLoaded);
                    resolve();
                }
            }, 100);
        });
        
        // Play the audio once
        try {
            await ensureAudioContext();
            await playLastGeneratedAudio();
            console.log("Played generated audio once");
        } catch (error) {
            console.error("Error playing generated audio:", error);
        }
    }
}

// Function to add a download button for the captured image
function addImageDownloadButton(imageDataUrl) {
    // Create a download container if it doesn't exist
    let downloadContainer = document.getElementById('image-download-container');
    if (!downloadContainer) {
        downloadContainer = document.createElement('div');
        downloadContainer.id = 'image-download-container';
        downloadContainer.style.margin = '10px 0';
        downloadContainer.innerHTML = '<h3>Captured Images</h3>';
        
        // Insert after camera container
        const cameraContainer = document.getElementById('camera-container');
        if (cameraContainer) {
            cameraContainer.after(downloadContainer);
        } else {
            document.body.appendChild(downloadContainer);
        }
    }
    
    // Create download button
    const downloadButton = document.createElement('a');
    downloadButton.href = imageDataUrl;
    downloadButton.download = `captured_image_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
    downloadButton.className = 'download-button';
    downloadButton.innerHTML = 'Download Captured Image';
    downloadButton.style.display = 'block';
    downloadButton.style.margin = '5px 0';
    downloadButton.style.padding = '5px 10px';
    downloadButton.style.backgroundColor = '#4CAF50';
    downloadButton.style.color = 'white';
    downloadButton.style.textDecoration = 'none';
    downloadButton.style.borderRadius = '4px';
    downloadButton.style.textAlign = 'center';
    
    // Add to container
    downloadContainer.appendChild(downloadButton);
    
    console.log('Added download button for captured image');
}

// Make handleCapture available globally for serial.js to access
window.handleCapture = handleCapture;

// Function to handle the backend communication flow
async function sendToBackend(imageDataUrl, instrumentKey) {
    console.log("Sending frame to GPT-4 Vision via api.js...");
    try {
        // Disable button while processing
        select('#capture-button').attribute('disabled', '');
        select('#capture-button').html('Processing...');

        const sceneData = await describeScene(imageDataUrl); // Call function from api.js

        if (!sceneData || sceneData.description === "API Error" || sceneData.description === "Error parsing response") {
            //alert("Failed to get scene description from API.");
            select('#capture-button').removeAttribute('disabled');
            select('#capture-button').html('Capture');
            return;
        }

        console.log("Received scene data:", sceneData);

        // --- Prepare for Stable Audio Call ---
        // Determine instrument name and prompt part based on key press or default
        const instrumentName = instrumentMap[instrumentKey]?.name || selectedInstrument;
        const instrumentPromptPart = filterKey ? (instrumentMap[filterKey]?.prompt || instrumentName.toLowerCase()) : instrumentName.toLowerCase();

        // Use global genre and scale if set, otherwise use the scene values
        const genre = globalGenre || (filterKey ? '' : sceneData.genre);
        const scale = globalScale || (filterKey ? '' : sceneData.key);
        
        // Create the prompt
        let finalAudioPrompt = `${sceneData.description}`;
        
        // Add genre if available
        if (genre) {
            finalAudioPrompt += `, ${genre} style`;
        }
        
        // Add scale if available
        if (scale) {
            finalAudioPrompt += `, in ${scale} scale`;
        }
        
        // Add instrument-specific part
        finalAudioPrompt += `, ${instrumentPromptPart}`;
        
        // Clean up extra commas or leading/trailing commas
        finalAudioPrompt = finalAudioPrompt.replace(/,\s*,/g, ',').replace(/^,\s*|,\s*$/g, '').trim();

        // Use global BPM if set, otherwise use the scene BPM
        const targetBpm = globalBPM || sceneData.bpm;

        // Log the exact prompt being sent
        console.log("=== Audio Generation Prompt ===");
        console.log("Full Prompt:", finalAudioPrompt);
        console.log("Target BPM:", targetBpm);
        console.log("Genre:", genre || "Not specified");
        console.log("Scale:", scale || "Not specified");
        console.log("Instrument:", instrumentName);
        console.log("=============================");

        // --- Call generateAudio ---
        const audioResult = await generateAudio(finalAudioPrompt, targetBpm);

        if (audioResult && audioResult.audioBlob) {
            console.log("Received audio data from Stable Audio API call.");
            
            // Store the BPM, genre, and scale if they're not already set
            if (!globalBPM && audioResult.bpm) {
                globalBPM = audioResult.bpm;
                console.log(`Stored global BPM: ${globalBPM}`);
            }
            if (!globalGenre && genre) {
                globalGenre = genre;
                console.log(`Stored global genre: ${globalGenre}`);
            }
            if (!globalScale && scale) {
                globalScale = scale;
                console.log(`Stored global scale: ${globalScale}`);
            }
            
            // Load audio into library without playing
            loadAudioToLibrary(audioResult, instrumentName);
            
            // Add download button for the WAV file
            addWavDownloadButton(audioResult.audioBlob, instrumentName);
            
            // Update UI to show connected instruments, genre, and scale
            updateConnectedInstrumentsUI();
        }

    } catch (error) {
        console.error("Error in sendToBackend flow:", error);
    } finally {
        // Re-enable button
        select('#capture-button').removeAttribute('disabled');
        select('#capture-button').html('Capture');
    }
}

// Function to add a download button for the generated WAV file
function addWavDownloadButton(audioBlob, instrumentName) {
    // Create a download container if it doesn't exist
    let downloadContainer = document.getElementById('wav-download-container');
    if (!downloadContainer) {
        downloadContainer = document.createElement('div');
        downloadContainer.id = 'wav-download-container';
        downloadContainer.style.margin = '10px 0';
        downloadContainer.innerHTML = '<h3>Generated Audio</h3>';
        
        // Insert after mixer container
        const mixerContainer = document.getElementById('mixer-container');
        if (mixerContainer) {
            mixerContainer.after(downloadContainer);
        } else {
            document.body.appendChild(downloadContainer);
        }
    }
    
    // Create download button
    const downloadUrl = URL.createObjectURL(audioBlob);
    const downloadButton = document.createElement('a');
    downloadButton.href = downloadUrl;
    downloadButton.download = `${instrumentName.toLowerCase()}_generated_${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
    downloadButton.className = 'download-button';
    downloadButton.innerHTML = `Download ${instrumentName} Audio`;
    downloadButton.style.display = 'block';
    downloadButton.style.margin = '5px 0';
    downloadButton.style.padding = '5px 10px';
    downloadButton.style.backgroundColor = '#4CAF50';
    downloadButton.style.color = 'white';
    downloadButton.style.textDecoration = 'none';
    downloadButton.style.borderRadius = '4px';
    downloadButton.style.textAlign = 'center';
    
    // Remove previous download for this instrument type if exists
    const existingDownload = downloadContainer.querySelector(`a[download^="${instrumentName.toLowerCase()}"]`);
    if (existingDownload) {
        URL.revokeObjectURL(existingDownload.href);
        existingDownload.remove();
    }
    
    // Add to container
    downloadContainer.appendChild(downloadButton);
    
    console.log(`Added download button for ${instrumentName} audio`);
}

// Function to update UI showing connected instruments, genre, and scale
function updateConnectedInstrumentsUI() {
    const connectedInstrumentsDiv = document.getElementById('connected-instruments');
    if (!connectedInstrumentsDiv) {
        const newDiv = document.createElement('div');
        newDiv.id = 'connected-instruments';
        newDiv.style.margin = '10px 0';
        newDiv.style.padding = '10px';
        newDiv.style.backgroundColor = '#f8f9fa';
        newDiv.style.borderRadius = '5px';
        newDiv.innerHTML = '<h3>Connected Instruments</h3>';
        
        // Insert after mixer container
        const mixerContainer = document.getElementById('mixer-container');
        if (mixerContainer) {
            mixerContainer.after(newDiv);
        } else {
            document.body.appendChild(newDiv);
        }
    }
    
    // Update the list of connected instruments, genre, and scale
    const connectedInstruments = document.getElementById('connected-instruments');
    const instrumentList = Array.from(previousInstruments).join(', ');
    const genreInfo = globalGenre ? `<p>Genre: ${globalGenre}</p>` : '';
    const scaleInfo = globalScale ? `<p>Scale: ${globalScale}</p>` : '';
    connectedInstruments.innerHTML = `
        <h3>Connected Instruments</h3>
        <p>Currently connected: ${instrumentList}</p>
        ${genreInfo}
        ${scaleInfo}
        <p>BPM: ${globalBPM || 'Not set'}</p>
    `;
}

// Ensure Tone.js starts on user interaction
window.addEventListener('DOMContentLoaded', () => {
    const startButton = document.createElement('button');
    startButton.id = 'start-audio-context';
    startButton.textContent = 'Start Audio';
    startButton.style.position = 'absolute';
    startButton.style.top = '10px';
    startButton.style.left = '10px';
    startButton.style.zIndex = '1000';
    startButton.style.padding = '10px';
    startButton.style.fontSize = '16px';
    document.body.appendChild(startButton);

    startButton.addEventListener('click', async () => {
        await Tone.start();
        console.log('AudioContext started');
        startButton.style.display = 'none'; // Hide after click
        // Potentially initialize Tone.js components here if needed immediately
    }, { once: true });
});

// Function to draw the selected instrument indicator in the corner of the canvas
function drawInstrumentIndicator() {
    if (selectedInstrument) {
        // Find the color for the selected instrument
        let instrumentColor;
        
        // Look through the instrumentMap to find the matching instrument
        for (const key in instrumentMap) {
            if (instrumentMap[key].name === selectedInstrument) {
                instrumentColor = instrumentMap[key].color;
                break;
            }
        }
        
        if (instrumentColor) {
            // Set color and draw indicator in the top-left corner
            push();
            noStroke();
            
            // Draw a small colored rectangle in the corner
            fill(instrumentColor[0], instrumentColor[1], instrumentColor[2], 200);
            rect(10, 10, 120, 40, 5);
            
            // Add text
            fill(255);
            textSize(18);
            textAlign(LEFT, CENTER);
            text(selectedInstrument, 20, 30);
            
            pop();
        }
    }
}

async function startPlayback() {
    if (selectedInstrument && lastGeneratedAudio) {
        try {
            // Ensure audio context is running
            await ensureAudioContext();
            
            // Start playback using the existing audio system
            const success = await playLastGeneratedAudio();
            if (success) {
                isPlaying = true;
                console.log(`Started playback for ${selectedInstrument}`);
            }
        } catch (error) {
            console.error("Error starting playback:", error);
        }
    }
}

function stopPlayback() {
    if (lastGeneratedAudio && lastGeneratedAudio.player) {
        try {
            lastGeneratedAudio.player.stop();
            isPlaying = false;
            console.log('Stopped playback');
        } catch (error) {
            console.error("Error stopping playback:", error);
        }
    }
}
