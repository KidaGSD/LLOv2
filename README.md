# Section-Based Music Generator

A music generation system that allows users to create complete songs by generating sections (intro, verse, chorus, etc.) and mixing them together using AI tools.

## Overview

This system combines multiple technologies to provide a seamless music creation experience:

1. **Frontend**: A web-based UI for creating and managing song sections
2. **Stable Audio API**: For generating individual section audio based on text prompts
3. **Tonn API**: For professional mixing of sections into a cohesive song

The architecture follows a modular, section-based approach where users define sections, select instruments, and generate audio for each section. The system then handles mixing these sections together.

## Project Structure

```
/
├── server/               # Backend server
│   ├── server.py         # FastAPI server implementation
│   └── routes/           # API route modules (future)
├── src/                  # Core implementation
│   ├── core/             # Core functionality
│   │   ├── store.js      # State management
│   │   ├── api.js        # API integration
│   │   └── sectionManager.js # Section management logic
│   ├── utils/            # Utility functions
│   │   ├── promptBuilder.js # AI prompt generation
│   │   └── sectionUtils.js  # Section-related utilities
│   ├── audio/            # Audio processing
│   │   └── audioContext.js  # Web Audio API wrapper
│   └── components/       # UI components
│       └── visualizer.js    # Audio visualization
├── client/               # Client application
│   ├── index.html        # Main HTML interface
│   └── app.js            # Client-side application logic
├── temp/                 # Temporary files storage
│   ├── sections/         # Uploaded section audio
│   └── mixes/            # Generated mixes
└── README.md             # This file
```

## Setup

### Prerequisites

- Python 3.8+ for the backend server
- Node.js 14+ for frontend development (optional, for bundling)
- API keys for Stable Audio and Tonn (for production use)

### Backend Setup

1. Install Python dependencies:

```bash
pip install -r requirements.txt
```

2. Start the server:

```bash
cd server
python server.py
```

The server will start at http://localhost:5000.

### Frontend Setup

Simply open the `client/index.html` file in your browser, or serve it using a local web server.

For development with live reloading:

```bash
npx serve client
```

## Usage

1. **Define Song Settings**: Set genre and BPM
2. **Add Sections**: Add song sections (intro, verse, chorus, etc.)
3. **Select Instruments**: For each section, select 1-3 instruments
4. **Generate Audio**: Enter descriptions and generate audio for each section
5. **Create Mix**: Once all sections are ready, create a mix
6. **Download**: Download the final mix

## Implementation Details

### Section Management

The system uses a section-based approach where each section:
- Has a specific type (intro, verse, chorus, bridge, outro)
- Contains 1-3 instruments
- Has descriptive text for generation
- Maintains its own audio data and visualization

### Audio Generation

For each section, the system:
1. Builds a prompt based on section type, instruments, and description
2. Sends the prompt to the Stable Audio API
3. Processes and displays the generated audio

### Mixing Process

The mixing process:
1. Exports each section as a WAV file
2. Uploads sections to the backend
3. Submits sections to the Tonn API for mixing
4. Monitors mix status and provides the final download

## Development

### Mock Mode

For development without API keys, the system includes a mock mode that:
- Generates placeholder audio instead of calling Stable Audio
- Creates simulated mixes instead of using the Tonn API

To use mock mode, set the `MOCK_MODE` variable in `api.js` to `true`.

### Extending the System

To add new section types or instruments:
1. Update the relevant arrays in `sectionUtils.js`
2. Add any specific prompt logic in `promptBuilder.js`

## Credits

This project uses:
- [FastAPI](https://fastapi.tiangolo.com/) for the backend server
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) for audio processing
- [Stable Audio API](https://stability.ai/stable-audio) for audio generation
- [Tonn API](https://tonn.io) for professional mixing

# Camera-driven Groovebox

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

### For Basic Demo Mode:
- Modern web browser (Chrome or Edge recommended)
- Webcam (built-in or external)
- No server required - runs fully in the browser with mock data

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

# Tonn API Integration Test Suite

This repository contains test files for integrating the Tonn API with the audio system. The test suite provides a minimal setup for validating functionality before implementing in the main application.

## Components

- **test-tonn-integration.py**: A minimal FastAPI server for testing the Tonn API integration
- **test-stem-export.html**: A standalone web page to test exporting audio stems using Tone.js
- **test-client.html**: A simple client for testing the backend API endpoints

## Getting Started

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Start the Backend Server

```bash
python test-tonn-integration.py
```

The server will run at `http://127.0.0.1:5000`.

### 3. Test Stem Export

Open `test-stem-export.html` in a web browser to test:
- Generate test audio (drums, bass, synth)
- Play and preview tracks
- Export tracks as WAV files

### 4. Test API Integration

Open `test-client.html` in a web browser to test:
- Server health status
- Uploading stems to the backend
- Creating a preview mix
- Checking mix status and completion

## Testing Flow

1. Use `test-stem-export.html` to generate and export some test stems
2. Use `test-client.html` to upload these stems to the backend
3. Request a preview mix through the client
4. Monitor the mix status and completion

## Notes

- This is a testing suite only, meant for validation before implementing in the main application
- The API endpoints in `test-tonn-integration.py` simulate processing but don't actually call the Tonn API yet
- The stems are stored in a temporary `temp/stems` directory
- Simulated mixes would be stored in `temp/mixes`

## Next Steps

Once testing is successful, the code can be integrated into the main application:

1. Implement the stem export functionality in the main app's `audio.js`
2. Create the backend endpoints in a proper API structure
3. Integrate the Tonn mixer from `tonn/mixer.py`
4. Implement proper error handling and production security measures


