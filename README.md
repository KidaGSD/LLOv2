# LLO :camera:

This is a browser-based music generation tool that uses your camera to create musical loops. It's an experiment in using vision to drive audio generation, with support for both web UI controls and an Arduino hardware controller.

## What it does

The app takes snapshots from your camera (either built-in or external webcam), sends them to GPT-4 Vision to analyze the scene, and uses that analysis to generate musical loops with different instruments. 

Main features:
- Select different instruments (drums, bass, guitar, etc.) using keyboard or Arduino
- Apply visual filters to your camera feed
- Capture images and generate matching audio
- Add sounds to a loop with the "Add to Loop" button
- Control everything with either the web UI or a connected Arduino

## Requirements

### For Full API Integration:
- **Node.js and npm** for the server component (required for Stability AI API proxy)
- **API Keys** for OpenAI GPT-4 Vision and Stability AI Stable Audio
- The following npm packages:
  - express
  - cors
  - axios
  - form-data

### Libraries (automatically loaded via CDN):
- p5.js for camera and visual processing
- Tone.js for audio processing
- Meyda.js for audio analysis

## Installation

1. Clone this repo:
```
git clone https://github.com/your-username/camera-driven-groovebox.git
cd camera-driven-groovebox
```

2. API Key Setup:
   - Create a file named `config.js` in the root directory
   - Add your API keys using this format:
   ```javascript
   const CONFIG = {
     OPENAI_API_KEY: "your-openai-api-key-here",
     STABILITY_API_KEY: "your-stability-ai-api-key-here"
   };
   ```
   - Or in the `api.js` and `server.js` directly paste your key there.
   - `const STABILITY_API_KEY` and `const OPENAI_API_KEY`

3. For full API integration, set up the Node.js server:
   ```
   npm install express cors axios form-data
   node server.js
   ```
   The server will run on http://localhost:3000

4. Open `index.html` in a web browser (Chrome or Edge recommended since they support the Web Serial API for Arduino)

5. Click the "Start Audio" button to initialize the audio context

## Arduino Setup

1. Install the Arduino IDE
2. Open the Arduino sketch file located in the `arduino` folder
3. Upload the code to your Arduino board
4. Connect the hardware components as shown in the wiring diagram
5. Click the "Connect Arduino" button in the web app
6. Make sure you're using Chrome or Edge (Web Serial API required)

## How to use

1. Select an instrument with Q, W, E, R, T, or Y keys (or use Arduino controller)
2. Choose a visual filter if you want
3. Click "Capture" to sample the current camera view and generate audio
4. Use "Add to Loop" button (or the corresponding Arduino button) to start playing the generated sound
5. Repeat to build up a multi-instrument loop

## API Usage

The project uses two main APIs:

1. **OpenAI GPT-4 Vision**: Analyzes captured images to extract scene descriptions, detect objects, suggest musical genres, and estimate appropriate BPM for the generated music.

2. **Stability AI Stable Audio**: Generates music based on the GPT-4 analysis and the selected instrument. The prompt is constructed from the scene description, detected musical genre, and the instrument type.

**Important Notes:**
- The OpenAI API can be called directly from the browser (though not recommended for production)
- The Stability AI API requires the Node.js proxy server (`server.js`) due to CORS restrictions and to protect your API key
- Without a Node.js server, the app falls back to mock audio generation with sample sounds

You will need accounts with both services to use the app with real API integration. Free tiers are available for testing purposes.

## Arduino Controller

The Arduino controller gives you:
- Rotary encoder to cycle through visual filters
- Buttons to take photos, add sounds to loops, and select instruments
- Status feedback via serial

When connecting the Arduino, you should see a "Connected to Arduino" message in the bottom right corner.


