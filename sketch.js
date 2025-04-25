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

// Add global variables to store previous prompts and sounds
let globalBPM = null;
let globalGenre = null;
let globalScale = null;
let previousPrompts = [];
let previousInstruments = new Set();

// Add new global variables for custom input
let customPrompt = '';
let customImage = null;

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

    // Initialize custom input UI
    initializeCustomInput();

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
    
    // Add download button for the captured image
    addImageDownloadButton(frameDataUrl);
    
    // Call the API function from api.js
    sendToBackend(frameDataUrl, selectedInstrument);
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
        
        // Always use the first scale detected, or the current global scale
        const scale = globalScale || sceneData.scale;
        if (!globalScale && sceneData.scale) {
            globalScale = sceneData.scale;
            window.currentScale = sceneData.scale;
            console.log("Set initial scale to:", globalScale);
        }
        
        // Create the prompt
        let finalAudioPrompt = `${sceneData.description}`;
        
        // Add genre if available
        if (genre) {
            finalAudioPrompt += `, ${genre} style`;
        }
        
        // Always add the consistent scale to the prompt
        if (scale) {
            finalAudioPrompt += `, in ${scale} scale`;
        }
        
        // Add instrument-specific part
        finalAudioPrompt += `, ${instrumentPromptPart}`;
        
        // Clean up extra commas or leading/trailing commas
        finalAudioPrompt = finalAudioPrompt.replace(/,\s*,/g, ',').replace(/^,\s*|,\s*$/g, '').trim();

        // Use global BPM if set, otherwise use the scene BPM
        const targetBpm = globalBPM || sceneData.bpm;

        // Store the prompt and BPM for later use
        window.currentPrompt = finalAudioPrompt;
        window.currentBpm = targetBpm;
        window.currentInstrument = instrumentName;

        // Display the prompt in the UI
        displayPrompt(finalAudioPrompt, targetBpm, instrumentName, scale);

    } catch (error) {
        console.error("Error in sendToBackend flow:", error);
    } finally {
        // Re-enable button
        select('#capture-button').removeAttribute('disabled');
        select('#capture-button').html('Capture');
    }
}

// Function to initialize custom input UI
function initializeCustomInput() {
    // Create or get the prompt container
    let promptContainer = document.getElementById('prompt-container');
    if (!promptContainer) {
        promptContainer = document.createElement('div');
        promptContainer.id = 'prompt-container';
        promptContainer.style.margin = '20px 0';
        promptContainer.style.padding = '15px';
        promptContainer.style.backgroundColor = '#f8f9fa';
        promptContainer.style.borderRadius = '5px';
        
        // Insert after camera container
        const cameraContainer = document.getElementById('camera-container');
        if (cameraContainer) {
            cameraContainer.after(promptContainer);
        } else {
            document.body.appendChild(promptContainer);
        }
    }

    // Get the current genre and scale, use default scale if none specified
    const genre = globalGenre || 'Not specified';
    const scale = globalScale || 'Not specified';

    // Display the initial custom input UI
    promptContainer.innerHTML = `
        <h3>Custom Input</h3>
        <p><strong>Genre:</strong> ${genre}</p>
        <p><strong>Scale:</strong> ${scale}</p>
        <div style="margin: 15px 0;">
            <h4>Input Options</h4>
            <div style="margin-bottom: 10px;">
                <label for="custom-prompt">Custom Prompt:</label>
                <textarea id="custom-prompt" style="width: 100%; height: 60px; margin-top: 5px;"></textarea>
            </div>
            <div style="margin-bottom: 10px;">
                <label for="custom-image">Custom Image:</label>
                <input type="file" id="custom-image" accept="image/*" style="margin-top: 5px;">
            </div>
            <button id="use-custom-input" style="
                padding: 8px 15px;
                background-color: #6c757d;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                margin-right: 10px;
            ">Use Custom Input</button>
            <button id="generate-audio-button" style="
                padding: 10px 20px;
                background-color: #4CAF50;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
            ">Generate Audio</button>
        </div>
    `;

    // Add event listeners
    const generateButton = document.getElementById('generate-audio-button');
    const useCustomButton = document.getElementById('use-custom-input');
    const customPromptInput = document.getElementById('custom-prompt');
    const customImageInput = document.getElementById('custom-image');

    generateButton.addEventListener('click', generateAudioFromPrompt);
    useCustomButton.addEventListener('click', handleCustomInput);
    customImageInput.addEventListener('change', handleImageUpload);
}

// Function to display the prompt and add generate button
function displayPrompt(prompt, bpm, instrument, scale) {
    // Create or get the prompt container
    let promptContainer = document.getElementById('prompt-container');
    if (!promptContainer) {
        promptContainer = document.createElement('div');
        promptContainer.id = 'prompt-container';
        promptContainer.style.margin = '20px 0';
        promptContainer.style.padding = '15px';
        promptContainer.style.backgroundColor = '#f8f9fa';
        promptContainer.style.borderRadius = '5px';
        
        // Insert after camera container
        const cameraContainer = document.getElementById('camera-container');
        if (cameraContainer) {
            cameraContainer.after(promptContainer);
        } else {
            document.body.appendChild(promptContainer);
        }
    }

    // Get the current genre and scale
    const genre = globalGenre || 'Not specified';
    const displayScale = scale || globalScale || 'Not specified';

    // Display the prompt and metadata
    promptContainer.innerHTML = `
        <h3>Generated Prompt</h3>
        <p><strong>Prompt:</strong> ${prompt}</p>
        <p><strong>BPM:</strong> ${bpm}</p>
        <p><strong>Instrument:</strong> ${instrument}</p>
        <p><strong>Genre:</strong> ${genre}</p>
        <p><strong>Scale:</strong> ${displayScale}</p>
        <div style="margin: 15px 0;">
            <h4>Custom Input Options</h4>
            <div style="margin-bottom: 10px;">
                <label for="custom-prompt">Custom Prompt:</label>
                <textarea id="custom-prompt" style="width: 100%; height: 60px; margin-top: 5px;"></textarea>
            </div>
            <div style="margin-bottom: 10px;">
                <label for="custom-image">Custom Image:</label>
                <input type="file" id="custom-image" accept="image/*" style="margin-top: 5px;">
            </div>
            <button id="use-custom-input" style="
                padding: 8px 15px;
                background-color: #6c757d;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                margin-right: 10px;
            ">Use Custom Input</button>
            <button id="generate-audio-button" style="
                padding: 10px 20px;
                background-color: #4CAF50;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
            ">Generate Audio</button>
        </div>
    `;

    // Add event listeners
    const generateButton = document.getElementById('generate-audio-button');
    const useCustomButton = document.getElementById('use-custom-input');
    const customPromptInput = document.getElementById('custom-prompt');
    const customImageInput = document.getElementById('custom-image');

    generateButton.addEventListener('click', generateAudioFromPrompt);
    useCustomButton.addEventListener('click', handleCustomInput);
    customImageInput.addEventListener('change', handleImageUpload);
}

// Function to generate audio from the stored prompt
async function generateAudioFromPrompt() {
    if (!window.currentPrompt || !window.currentBpm || !window.currentInstrument) {
        console.error("No prompt data available");
        return;
    }

    try {
        // Disable the generate button while processing
        const generateButton = document.getElementById('generate-audio-button');
        generateButton.disabled = true;
        generateButton.textContent = 'Generating...';

        // Call generateAudio with the stored prompt
        const audioResult = await generateAudio(window.currentPrompt, window.currentBpm);

        if (audioResult && audioResult.audioBlob) {
            console.log("Received audio data from Stable Audio API call.");
            
            // Store the BPM if it's not already set
            if (!globalBPM && audioResult.bpm) {
                globalBPM = audioResult.bpm;
                console.log(`Stored global BPM: ${globalBPM}`);
            }
            
            // Load audio into library without playing
            loadAudioToLibrary(audioResult, window.currentInstrument);
            
            // Add download button for the WAV file
            addWavDownloadButton(audioResult.audioBlob, window.currentInstrument);
            
            // Update UI to show connected instruments
            updateConnectedInstrumentsUI();
        }

    } catch (error) {
        console.error("Error generating audio:", error);
        alert("Failed to generate audio. Please try again.");
    } finally {
        // Re-enable the generate button
        const generateButton = document.getElementById('generate-audio-button');
        generateButton.disabled = false;
        generateButton.textContent = 'Generate Audio';
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

// Function to handle custom image upload
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            customImage = e.target.result;
            console.log("Custom image loaded");
        };
        reader.readAsDataURL(file);
    }
}

// Function to handle custom input
async function handleCustomInput() {
    const customPromptInput = document.getElementById('custom-prompt');
    const customPromptText = customPromptInput.value.trim();
    
    if (customImage) {
        // If we have a custom image, use it to generate a prompt
        try {
            const sceneData = await describeScene(customImage);
            if (sceneData && sceneData.description !== "API Error") {
                // Always use the first scale detected, or the current global scale
                const currentScale = globalScale || sceneData.scale;
                if (!globalScale && sceneData.scale) {
                    globalScale = sceneData.scale;
                    window.currentScale = sceneData.scale;
                    console.log("Set initial scale to:", globalScale);
                }
                
                // Combine the custom prompt with the image description and scale
                let combinedPrompt = sceneData.description;
                
                // Add scale to the prompt
                combinedPrompt += `, in ${currentScale} scale`;
                
                // Add custom prompt text if provided
                if (customPromptText) {
                    combinedPrompt += `, ${customPromptText}`;
                }
                
                // Store the combined prompt and metadata
                window.currentPrompt = combinedPrompt;
                window.currentBpm = sceneData.bpm || globalBPM || 120;
                window.currentInstrument = selectedInstrument;
                
                // Update global genre if available from scene data
                if (sceneData.genre) globalGenre = sceneData.genre;
                
                // Update the prompt display
                const promptContainer = document.getElementById('prompt-container');
                if (promptContainer) {
                    promptContainer.innerHTML = `
                        <h3>Generated Prompt</h3>
                        <p><strong>Prompt:</strong> ${combinedPrompt}</p>
                        <p><strong>BPM:</strong> ${window.currentBpm}</p>
                        <p><strong>Instrument:</strong> ${window.currentInstrument}</p>
                        <p><strong>Genre:</strong> ${globalGenre || 'Not specified'}</p>
                        <p><strong>Scale:</strong> ${currentScale}</p>
                        <div style="margin: 15px 0;">
                            <h4>Custom Input Options</h4>
                            <div style="margin-bottom: 10px;">
                                <label for="custom-prompt">Custom Prompt:</label>
                                <textarea id="custom-prompt" style="width: 100%; height: 60px; margin-top: 5px;">${customPromptText}</textarea>
                            </div>
                            <div style="margin-bottom: 10px;">
                                <label for="custom-image">Custom Image:</label>
                                <input type="file" id="custom-image" accept="image/*" style="margin-top: 5px;">
                            </div>
                            <button id="use-custom-input" style="
                                padding: 8px 15px;
                                background-color: #6c757d;
                                color: white;
                                border: none;
                                border-radius: 4px;
                                cursor: pointer;
                                margin-right: 10px;
                            ">Use Custom Input</button>
                            <button id="generate-audio-button" style="
                                padding: 10px 20px;
                                background-color: #4CAF50;
                                color: white;
                                border: none;
                                border-radius: 4px;
                                cursor: pointer;
                            ">Generate Audio</button>
                        </div>
                    `;
                }
            }
        } catch (error) {
            console.error("Error processing custom image:", error);
            alert("Failed to process custom image. Please try again.");
        }
    } else if (customPromptText) {
        // If we only have a custom prompt, use it directly
        const currentScale = globalScale || 'Not specified';
        
        // Create prompt with scale
        const promptWithScale = `${customPromptText}, in ${currentScale} scale`;
        
        window.currentPrompt = promptWithScale;
        window.currentBpm = globalBPM || 120;
        window.currentInstrument = selectedInstrument;
        
        // Update the prompt display
        const promptContainer = document.getElementById('prompt-container');
        if (promptContainer) {
            promptContainer.innerHTML = `
                <h3>Generated Prompt</h3>
                <p><strong>Prompt:</strong> ${promptWithScale}</p>
                <p><strong>BPM:</strong> ${window.currentBpm}</p>
                <p><strong>Instrument:</strong> ${window.currentInstrument}</p>
                <p><strong>Genre:</strong> ${globalGenre || 'Not specified'}</p>
                <p><strong>Scale:</strong> ${currentScale}</p>
                <div style="margin: 15px 0;">
                    <h4>Custom Input Options</h4>
                    <div style="margin-bottom: 10px;">
                        <label for="custom-prompt">Custom Prompt:</label>
                        <textarea id="custom-prompt" style="width: 100%; height: 60px; margin-top: 5px;">${customPromptText}</textarea>
                    </div>
                    <div style="margin-bottom: 10px;">
                        <label for="custom-image">Custom Image:</label>
                        <input type="file" id="custom-image" accept="image/*" style="margin-top: 5px;">
                    </div>
                    <button id="use-custom-input" style="
                        padding: 8px 15px;
                        background-color: #6c757d;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        margin-right: 10px;
                    ">Use Custom Input</button>
                    <button id="generate-audio-button" style="
                        padding: 10px 20px;
                        background-color: #4CAF50;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    ">Generate Audio</button>
                </div>
            `;
        }
    }
}
