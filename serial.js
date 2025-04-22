/**
 * Serial Communication Interface for Arduino Controller
 * 
 * This script handles the communication between the web application and an Arduino-based hardware controller.
 * It uses the Web Serial API which is currently only supported in Chrome and Chrome-based browsers.
 */

// Global variables for serial connection
let port;
let reader;
let writer;
let readableStreamClosed;
let writableStreamClosed;
let isConnected = false;

// Connection status element for UI
let statusElement = null;

// Connect to Arduino
async function connectToArduino() {
    try {
        // Request a port from the user
        port = await navigator.serial.requestPort();
        
        // Open the port with the correct baud rate (matching Arduino)
        await port.open({ baudRate: 9600 });
        
        // Create a reader and writer for the port
        const textDecoder = new TextDecoderStream();
        readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
        reader = textDecoder.readable.getReader();
        
        const textEncoder = new TextEncoderStream();
        writableStreamClosed = textEncoder.readable.pipeTo(port.writable);
        writer = textEncoder.writable.getWriter();
        
        // Update connection status
        isConnected = true;
        updateStatus("Connected to Arduino");
        
        // Start reading from Arduino
        readFromArduino();
        
        return true;
    } catch (error) {
        console.error("Error connecting to Arduino:", error);
        updateStatus("Connection failed: " + error.message);
        return false;
    }
}

// Disconnect from Arduino
async function disconnectFromArduino() {
    if (!port) return;
    
    try {
        // Close the reader and writer
        if (reader) {
            await reader.cancel();
            await readableStreamClosed;
            reader = null;
        }
        
        if (writer) {
            await writer.close();
            await writableStreamClosed;
            writer = null;
        }
        
        // Close the port
        await port.close();
        port = null;
        
        // Update connection status
        isConnected = false;
        updateStatus("Disconnected from Arduino");
    } catch (error) {
        console.error("Error disconnecting from Arduino:", error);
        updateStatus("Disconnect error: " + error.message);
    }
}

// Read data from Arduino continuously
async function readFromArduino() {
    while (port && port.readable && isConnected) {
        try {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            
            // Process the received data
            processArduinoMessage(value.trim());
        } catch (error) {
            console.error("Error reading from Arduino:", error);
            break;
        }
    }
}

// Process messages from Arduino
function processArduinoMessage(message) {
    console.log("Arduino says:", message);
    
    // Debug all button elements
    const buttons = {
        drums: document.getElementById("btn-drums"),
        bass: document.getElementById("btn-bass"),
        guitar: document.getElementById("btn-guitar"),
        keys: document.getElementById("btn-keys"),
        vocals: document.getElementById("btn-vocals"),
        fx: document.getElementById("btn-fx"),
        capture: document.getElementById("capture-button")
    };
    
    // Log button existence status only once
    if (!window.buttonStatusLogged) {
        console.log("Button status:", Object.entries(buttons).map(([name, elem]) => `${name}: ${!!elem}`).join(", "));
        window.buttonStatusLogged = true;
    }
    
    try {
        // Process different Arduino messages with more flexible matching
        if (message.includes("You took a photo!")) {
            console.log("Attempting to trigger photo capture...");
            
            // Detailed debug info about the capture button
            if (buttons.capture) {
                console.log("Capture button found:", buttons.capture);
                console.log("Capture button onclick:", buttons.capture.onclick);
                console.log("Capture button event listeners cannot be inspected directly");
                
                // Try three different ways to trigger the button
                
                // 1. Traditional click
                buttons.capture.click();
                console.log("Method 1: Capture button clicked");
                
                // 2. Dispatch a mouse event
                const mouseEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                });
                buttons.capture.dispatchEvent(mouseEvent);
                console.log("Method 2: Mouse event dispatched");
                
                // 3. Try to directly access the handleCapture function
                if (typeof window.handleCapture === 'function') {
                    console.log("Found global handleCapture function, calling directly");
                    window.handleCapture();
                } else {
                    console.log("No global handleCapture function found");
                }
                
                // 4. Simulate spacebar press (common shortcut for capture)
                simulateKeyEvent(' '); // Space character
                console.log("Method 4: Simulated spacebar press");
            } else {
                console.error("Capture button not found");
            }
        } 
        else if (message.includes("added the last generated sound")) {
            console.log("Adding sound to loop");
            
            // Play the last generated audio
            if (typeof window.playLastGeneratedAudio === 'function') {
                const success = window.playLastGeneratedAudio();
                if (success) {
                    console.log("Started playing and looping the last generated sound");
                } else {
                    console.log("No audio available to play or audio not fully loaded yet");
                }
            } else {
                console.error("playLastGeneratedAudio function not found");
            }
        }
        else if (message.includes("instrument 1")) {
            console.log("Selecting DRUMS instrument");
            // Try both clicking the button and simulating keyboard press
            if (buttons.drums) {
                buttons.drums.click();
                console.log("Drums button clicked");
            } else {
                console.error("Drums button not found");
            }
            // Simulate pressing 'Q' key (for drums)
            simulateKeyEvent('Q');
        }
        else if (message.includes("instrument 2")) {
            console.log("Selecting BASS instrument");
            if (buttons.bass) {
                buttons.bass.click();
                console.log("Bass button clicked");
            } else {
                console.error("Bass button not found");
            }
            // Simulate pressing 'W' key (for bass)
            simulateKeyEvent('W');
        }
        else if (message.includes("instrument 3")) {
            console.log("Selecting GUITAR instrument");
            if (buttons.guitar) {
                buttons.guitar.click();
                console.log("Guitar button clicked");
            } else {
                console.error("Guitar button not found");
            }
            // Simulate pressing 'E' key (for guitar)
            simulateKeyEvent('E');
        }
        else if (message.includes("Rewinding")) {
            console.log("Cycling filter backward");
            cycleFilter(-1);
        }
        else if (message.includes("FastFW")) {
            console.log("Cycling filter forward");
            cycleFilter(1);
        }
    } catch (err) {
        console.error("Error processing Arduino message:", err);
    }
}

// Simulate keyboard events for instrument selection
function simulateKeyEvent(key) {
    console.log(`Simulating key press: ${key}`);
    
    // Create and dispatch keydown event
    const keydownEvent = new KeyboardEvent('keydown', {
        key: key,
        code: `Key${key}`,
        keyCode: key.charCodeAt(0),
        which: key.charCodeAt(0),
        bubbles: true,
        cancelable: true
    });
    
    // Create and dispatch keyup event
    const keyupEvent = new KeyboardEvent('keyup', {
        key: key,
        code: `Key${key}`,
        keyCode: key.charCodeAt(0),
        which: key.charCodeAt(0),
        bubbles: true,
        cancelable: true
    });
    
    // Dispatch the events to the document
    document.dispatchEvent(keydownEvent);
    
    // Dispatch keyup after a short delay
    setTimeout(() => {
        document.dispatchEvent(keyupEvent);
        console.log(`Simulated key release: ${key}`);
    }, 100);
}

// Cycle through available filters
function cycleFilter(direction) {
    // Get the current filter from the UI
    const filterNameElement = document.getElementById("filter-name");
    if (!filterNameElement) return;
    
    const currentFilter = filterNameElement.textContent;
    
    // Define available filters (must match what's in your sketch.js)
    const filters = ["NORMAL", "GRAY", "THRESHOLD", "INVERT", "POSTERIZE", "BLUR"];
    
    // Find current filter index
    let currentIndex = filters.indexOf(currentFilter);
    if (currentIndex === -1) currentIndex = 0;
    
    // Calculate new index
    let newIndex = (currentIndex + direction) % filters.length;
    if (newIndex < 0) newIndex = filters.length - 1;
    
    // Update filter display
    filterNameElement.textContent = filters[newIndex];
    
    // Apply filter in sketch.js by setting a global variable
    if (window.setFilterByName) {
        window.setFilterByName(filters[newIndex]);
    }
}

// Update connection status in UI
function updateStatus(message) {
    console.log("Arduino Status:", message);
    
    // Create status element if it doesn't exist
    if (!statusElement) {
        statusElement = document.createElement("div");
        statusElement.id = "arduino-status";
        statusElement.style.position = "fixed";
        statusElement.style.bottom = "10px";
        statusElement.style.right = "10px";
        statusElement.style.backgroundColor = "rgba(0,0,0,0.7)";
        statusElement.style.color = "white";
        statusElement.style.padding = "8px";
        statusElement.style.borderRadius = "4px";
        statusElement.style.zIndex = "1000";
        document.body.appendChild(statusElement);
    }
    
    statusElement.textContent = "Arduino: " + message;
}

// Add connect button to UI
function addConnectButton() {
    // Create button if it doesn't exist
    let connectButton = document.getElementById("arduino-connect");
    if (!connectButton) {
        connectButton = document.createElement("button");
        connectButton.id = "arduino-connect";
        connectButton.textContent = "Connect Arduino";
        connectButton.style.position = "fixed";
        connectButton.style.bottom = "40px";
        connectButton.style.right = "10px";
        connectButton.style.zIndex = "1000";
        document.body.appendChild(connectButton);
        
        // Add click event
        connectButton.addEventListener("click", async () => {
            if (isConnected) {
                await disconnectFromArduino();
                connectButton.textContent = "Connect Arduino";
            } else {
                const connected = await connectToArduino();
                if (connected) {
                    connectButton.textContent = "Disconnect Arduino";
                }
            }
        });
    }
}

// Check if Web Serial API is available
function isWebSerialSupported() {
    return 'serial' in navigator;
}

// Initialize Arduino interface
function initArduinoInterface() {
    if (!isWebSerialSupported()) {
        console.error("Web Serial API is not supported in this browser. Try using Chrome or Edge.");
        updateStatus("Error: Web Serial API not supported in this browser");
        return false;
    }
    
    addConnectButton();
    updateStatus("Ready to connect");
    return true;
}

// Initialize Arduino interface when DOM content is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Wait a bit to ensure the UI is loaded
    setTimeout(initArduinoInterface, 1000);
});

// Make functions available globally
window.connectToArduino = connectToArduino;
window.disconnectFromArduino = disconnectFromArduino; 