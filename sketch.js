let cam;
let canvas;

// Instrument selection state
let selectedInstrument = 'DRUMS'; // Default
let filterKey = null; // Key currently held down (e.g., 'q', 'w')
let tintCol = null; // Color for tinting

// Map keys to instruments, colors, and specific prompt tails (Section 8)
// Note: Section 8 mentions different tint colors (orange, teal, etc.) than the button colors in the UI image.
// Using the prompt tails from Section 8, but keeping colors consistent with the UI image/CSS for now.
const instrumentMap = {
    'q': { name: 'DRUMS', color: [108, 117, 125], cssColor: '#6c757d', prompt: "boom-bap drums" },       // Key 1 (Q) -> "boom-bap drums" (UI: Gray)
    'w': { name: 'BASS', color: [52, 58, 64], cssColor: '#343a40', prompt: "synth bassline" },          // Key 2 (W) -> "synth bassline" (UI: Dark Gray)
    'e': { name: 'GUITAR', color: [253, 126, 20], cssColor: '#fd7e14', prompt: "clean electric guitar riff" }, // Key E (Not in 1-5) -> Added generic prompt (UI: Orange)
    'r': { name: 'KEYS', color: [13, 202, 240], cssColor: '#0dcaf0', prompt: "dreamy pad chords" },     // Key 3 (R) -> "dreamy pad chords" (UI: Cyan)
    't': { name: 'VOCALS', color: [214, 51, 132], cssColor: '#d63384', prompt: "airy vocal chop" },     // Key 4 (T) -> "airy vocal chop" (UI: Purple)
    'y': { name: 'FX', color: [25, 135, 84], cssColor: '#198754', prompt: "glitch fx sweep" }          // Key 5 (Y) -> "glitch fx sweep" (UI: Green)
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

function handleCapture() {
    console.log(`Capture button clicked. Instrument: ${selectedInstrument}`);
    if (!cam.loadedmetadata) {
        console.error("Camera not ready yet.");
        return;
    }

    // Get the current frame from the canvas
    const frameDataUrl = canvas.elt.toDataURL('image/jpeg', 0.8); // Use canvas element
    console.log("Frame captured as data URL (length):", frameDataUrl.length);
    
    // --- Placeholder for API call ---
    // In the next steps, this data will be sent to the backend/API handler
    // sendToBackend(frameDataUrl, selectedInstrument);
    //alert(`Captured frame for ${selectedInstrument}! Calling API...`); // Update feedback

    // Call the API function from api.js
    sendToBackend(frameDataUrl, selectedInstrument);
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
        //alert(`Scene: ${sceneData.description}\nObjects: ${sceneData.objects.join(', ')}\nGenre: ${sceneData.genre}\nBPM: ${sceneData.bpm || 'N/A'}`);

        // --- Prepare for Stable Audio Call ---
        // Determine instrument name and prompt part based on key press or default
        const instrumentName = instrumentMap[instrumentKey]?.name || selectedInstrument;
        const instrumentPromptPart = filterKey ? (instrumentMap[filterKey]?.prompt || instrumentName.toLowerCase()) : instrumentName.toLowerCase();

        // Determine genre (use GPT's unless overridden by key press)
        const genre = filterKey ? '' : sceneData.genre; // If key pressed, omit GPT genre to focus on instrument prompt
        // Combine scene description, genre (if not overridden), and instrument part
        let finalAudioPrompt = `${sceneData.description}`;
        if (genre) {
            finalAudioPrompt += `, ${genre}`;
        }
        finalAudioPrompt += `, ${instrumentPromptPart}`;
        // Clean up extra commas or leading/trailing commas
        finalAudioPrompt = finalAudioPrompt.replace(/,\s*,/g, ',').replace(/^,\s*|,\s*$/g, '').trim();


        const targetBpm = sceneData.bpm; // Use BPM from GPT-4 if available

        console.log(`Prepared Audio Prompt: "${finalAudioPrompt}", Target BPM: ${targetBpm}`);

        // --- Call generateAudio ---
        // 'instrumentName' is already defined above
        const audioResult = await generateAudio(finalAudioPrompt, targetBpm); // Call function from api.js

        if (audioResult && audioResult.audioBlob) {
            console.log("Received audio data from Stable Audio API call.");
            // Load audio into library without playing (replacing the old loadAndPlayAudio call)
            loadAudioToLibrary(audioResult, instrumentName);
            //alert("Audio generation successful! Added to library. Use the Add to Loop button on Arduino to play.");
        } else {
            //alert("Audio generation failed or returned no data.");
        }

    } catch (error) {
        console.error("Error in sendToBackend flow:", error);
        //alert(`An error occurred: ${error.message}`);
    } finally {
        // Re-enable button
        select('#capture-button').removeAttribute('disabled');
        select('#capture-button').html('Capture');
    }
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
