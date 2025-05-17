# System Architecture: Camera-driven Section-based Music Generator

This document outlines the architecture for rebuilding the camera-driven music generation system, focusing on a section-based approach that allows for progressive composition as described in the audio_doc.md.

## 1. Folder Structure

```
/
├── src/
│   ├── core/
│   │   ├── hardware.js       # Web Serial (Arduino) interface
│   │   ├── audio.js          # Audio engine (Tone.js wrapper)
│   │   ├── api.js            # External API clients (GPT-4o, StableAudio, Tonn)
│   │   ├── store.js          # Session state management
│   │   └── beatSystem.js     # Beat matching and timing functionality
│   ├── ui/
│   │   ├── App.jsx           # Main React application
│   │   ├── Camera.jsx        # Camera component
│   │   ├── Visualizer.jsx    # Audio visualization 
│   │   ├── SectionManager.jsx # Section control interface
│   │   └── InstrumentPicker.jsx # Instrument selection modal
│   ├── utils/
│   │   ├── audioExport.js    # Stem and mix export utilities
│   │   ├── promptBuilder.js  # AI prompt construction logic
│   │   └── visualEffects.js  # Camera visual filters
│   └── styles/
│       ├── main.css          # Core styles
│       └── components.css    # Component-specific styles
├── server/
│   ├── server.py             # FastAPI server for Tonn integration
│   ├── mixer.py              # Tonn API client (from existing codebase)
│   ├── config.py             # Server configuration
│   └── routes/
│       ├── health.py         # Health check endpoints
│       ├── uploads.py        # Section upload handling
│       └── mixing.py         # Mix creation and retrieval
│       └── audio_utils.py    # Audio processing utilities (e.g., stitching)
├── public/
│   ├── index.html
│   └── assets/               # Static assets
└── tests/
    ├── test-client.html      # Standalone test client
    └── test-tonn-mixer.py    # Tonn mixer tests
```

## 2. Core Components

### 2.1 Hardware Interface (`core/hardware.js`)

Simplified Web Serial API interface for Arduino communication.

**Key functionality:**
- Connect to Arduino devices using the Web Serial API
- Read encoder data for wheel/platter control
- Read button presses for instrument selection and capture
- Send LED/display data to Arduino

**From existing code:**
- Adapt Arduino connection handling from `serial.js`
- Use the simplified module pattern as suggested

```javascript
// Pseudocode structure
export const hw = (() => {
  let port, reader, writer;
  
  async function connect() {
    // Establish connection
  }
  
  async function send(frame) {
    // Send data to Arduino
  }
  
  function readLoop(onMsg) {
    // Read data from Arduino and emit events
  }
  
  return { connect, send, readLoop };
})();
```

### 2.2 Audio Engine (`core/audio.js`)

Tone.js wrapper for all audio handling, focusing on section-based composition.

**Key functionality:**
- Section management with proper start/end times
- Crossfades between sections
- Beat matching and BPM synchronization
- Instrument track grouping and mixing
- Exporting sections as WAV files

**From existing code:**
- Adapt the section handling from `audio.js`
- Use the beat matching system from `audio.js`
- Simplified Tone.js wrapper as suggested

```javascript
// Pseudocode structure
export const audio = (() => {
  const sections = [];
  
  function setBpm(bpm) {
    // Set global BPM
  }
  
  function addSection(buffer, instruments, startTime) {
    // Add a new section to the timeline
  }
  
  function createCrossfade(section1, section2) {
    // Handle smooth transitions between sections
  }
  
  function exportSectionWav(sectionIndex) {
    // Export a section as WAV file
  }
  
  function start() {
    // Start playback
  }
  
  return { setBpm, addSection, createCrossfade, exportSectionWav, start };
})();
```

### 2.3 API Client (`core/api.js`)

Unified client for all external API calls (GPT-4o, StableAudio, Tonn).

**Key functionality:**
- Image captioning with GPT-4o Vision
- Audio generation with StableAudio
- Mix creation and retrieval with Tonn API
- Error handling and fallbacks

**From existing code:**
- Adapt the API calls from `api.js`
- Use the prompt construction technique from existing code

```javascript
// Pseudocode structure
// Direct API calls without unnecessary abstraction
export async function captionImage(imageData) {
  // Call GPT-4o Vision API to analyze the image
}

export async function generateAudio(prompt, bpm, instruments) {
  // Call StableAudio API to generate audio
}

export async function createPreviewMix(stems) {
  // Call Tonn API via backend for mix preview
}

export async function createFinalMix(taskId) {
  // Call Tonn API via backend for final mix
}
```

### 2.4 Session Store (`core/store.js`)

Lightweight state management for the application.

**Key functionality:**
- Track sections and their metadata
- Maintain global session parameters (BPM, genre, palette)
- Provide history and undo capabilities

```javascript
// Pseudocode structure
export const S = {
  // Session data
  bpm: 0,
  genre: "",
  paletteId: "",
  sections: [],
  
  // Session methods
  set(data) {
    Object.assign(this, data);
  },
  
  addSection(section) {
    this.sections.push(section);
  },
  
  removeSection(index) {
    this.sections.splice(index, 1);
  }
};
```

### 2.5 Beat System (`core/beatSystem.js`) - DEFERRED/SIMPLIFIED

Handles beat matching, synchronization and section transitions.

**Key functionality (Original Plan):**
- Beat detection and tracking
- Section scheduling based on beats
- Beat snapping and quantization
- Wheel/platter control for beat alignment

**Current Status (Simplified):**
- Basic automated crossfades are handled in `sectionManager.js` using Web Audio API `GainNode` ramps.
- With consistent BPM across sections, the immediate need for complex beat detection and manual platter-based alignment is reduced.
- Full implementation of a dedicated `beatSystem.js` for advanced beat matching and platter control is **deferred** until Arduino hardware integration for platter control is prioritized.

## 3. UI Components

### 3.1 Main App (`ui/App.jsx`)

Main React application that coordinates all components.

**Key functionality:**
- Initialize hardware, audio engine
- Manage overall application flow
- Handle global events
- Coordinate between components

### 3.2 Camera Component (`ui/Camera.jsx`)

Handles camera feed, filters, and capture functionality.

**Key functionality:**
- Access webcam
- Apply visual filters
- Capture frames for processing
- Instrument overlay visualization

**From existing code:**
- Adapt camera handling from `sketch.js`
- Incorporate visual filters

### 3.3 Visualizer Component (`ui/Visualizer.jsx`)

Audio visualization for sections and beat tracking.

**Key functionality:**
- Waveform visualization for active and upcoming sections
- Beat grid and markers
- LED-style visualization for hardware display
- Playback position indicator

**From existing code:**
- Adapt the visualizer from `visual-dna.js`

### 3.4 Section Manager (`ui/SectionManager.jsx`)

Interface for managing music sections.

**Key functionality:**
- Display all sections in timeline
- Allow rearrangement of sections
- Control section parameters
- Preview and playback controls

### 3.5 Instrument Picker (`ui/InstrumentPicker.jsx`)

Modal for selecting instruments for a section.

**Key functionality:**
- Display available instruments
- Allow selection of 1-3 instruments per section
- Show instrument categories
- Connect to hardware buttons

## 4. Server Components

### 4.1 FastAPI Server (`server/server.py`)

Python backend server for Tonn API integration.

**Key functionality:**
- File upload handling
- Tonn API integration
- Mix creation and monitoring
- Health checks

**From existing code:**
- Adapt the FastAPI setup from `server.py`
- Reuse CORS configuration

### 4.2 Tonn Mixer (`server/mixer.py`)

Tonn API client for stem mixing.

**Key functionality:**
- Process section uploads (for Tonn internal use if mixing stems within a section)
- Create preview mixes (for stems within a section)
- Generate final mixes (for stems within a section)
- Handle Tonn API authentication

**Note on Tonn Usage:** Tonn excels at mixing concurrent stems within a single audio piece. For sequencing multiple, distinct audio sections one after another (additive mixing), a separate process is used (see `audio_utils.py` and the stitching endpoint in `server.py`).

**From existing code:**
- Reuse the `mixer.py` from the `tonn` directory, primarily for its Tonn API communication logic if per-section stem mixing is implemented.

### 4.2.1 Audio Utilities (`server/audio_utils.py`)

Python utilities for audio manipulation tasks outside of Tonn.

**Key functionality:**
- **Additive Section Stitching:** Concatenates multiple audio sections sequentially with defined overlaps and crossfades to create a single song file. Uses libraries like `pydub`.

### 4.3 API Routes (`server/routes/`)

Separated API route handlers for the server. (Note: current implementation is directly in `server.py`)

**Key routes:**
- `/health` - Server status
- `/api/upload-sections` - Upload section WAV files
- `/api/create-preview-mix` - If Tonn is used: Create a preview mix of stems *within a single section*.
- `/api/create-real-mix` - If Tonn is used: Create a final mix of stems *within a single section*.
- `/api/create-stitched-song` - Takes uploaded sections and stitches them additively with crossfades into a final song.
- `/api/check-mix-status` - Check status of mixing or stitching tasks.
- `/api/download-mix/{task_id}` - Download a completed mix or stitched song.

## 5. Implementation Plan

### Phase 1: Core Setup and Testing

1. **Set up folder structure**
2. **Create minimal hardware interface**
   - Implement basic Web Serial communication
   - Test Arduino connectivity
3. **Build foundational audio engine**
   - Initialize Tone.js
   - Create section data structure
   - Implement basic playback
4. **Create minimal API client**
   - Set up GPT-4o Vision API calls
   - Implement StableAudio generation
   - Create backend proxy for API calls
5. **Establish server foundations**
   - Set up FastAPI server
   - Create health check endpoints
   - Test Tonn mixer integration

### Phase 2: Core Implementation (Revised Focus)

1.  **Implement section-based audio processing**
    *   Section creation and management (`app.js`, `store.js`).
    *   Audio generation pipeline (capture -> caption -> prompt -> API call -> AudioBuffer storage via `app.js` & `sectionManager.js`).
    *   BPM & PaletteID consistency (`app.js`, `store.js`).
2.  **Develop robust sequential playback with automated transitions**
    *   Refine `sectionManager.playSequence` for BPM-dependent crossfades and reliable event callbacks.
    *   Thoroughly test end-to-end sequential playback of multiple sections.
3.  **Build foundational frontend UI framework**
    *   Camera component (`app.js` direct integration).
    *   Basic visualization for individual sections (placeholder for Arduino integration, can use `src/components/visualizer.js` concepts).
    *   Section timeline interface (`app.js` rendering `section-list`).
4.  **Basic Arduino Integration (Initial)**
    *   Integrate `hardware.js` for basic connection.
    *   **Define Communication Protocol (JSON over Serial):**
        *   **Frontend to Arduino:** 
            ```json
            {
              "lcd_l1": "BPM:XXX Genre", 
              "lcd_l2": "Section Name",
              "leds": [1,0,1,0,1], // For 5 LEDs (pins 24,28,32,36,40)
              "vu": 75 // Audio level (0-100) for LED VU meter
            }
            ```
        *   **Arduino to Frontend:** `{"btn": X}` (where X is button ID 0-4 for pins 22,26,30,34,38).
    *   **Frontend Implementation (`app.js`, `hardware.js`, `sectionManager.js`):**
        *   `app.js`: Manage Arduino connection (UI buttons, `hw.connect()`, `hw.onStatus`, `hw.onMessage`). Handle incoming button presses to trigger actions (instrument selection, capture). Periodically send display data (BPM, genre, section, LED states, VU level) to Arduino using `hw.send()`.
        *   `hardware.js`: `send()` and `processMessage()` are largely suitable for the JSON protocol.
        *   `sectionManager.js`: Implement `getAudioLevel()` using an `AnalyserNode` connected to the main playback path, returning a 0-100 scaled audio level for the VU meter.
    *   **Arduino Sketch (User Implemented - Conceptual):**
        *   Initialize pins (Buttons: INPUT; LEDs: OUTPUT), LCD.
        *   Loop: Read buttons (debounced), send `{"btn": X}` on press. Listen for serial JSON, parse, update LCD, LEDs, and VU meter.
    *   Send basic track info (BPM, Genre, current section type) to Arduino for LCD display using the defined JSON structure.
    *   Send simplified waveform/level data (`vu` value from `sectionManager.getAudioLevel()`) to Arduino for basic LED/screen visualization.
    *   Handle button presses from Arduino to control UI elements (e.g., instrument selection).

### Phase 3: Complete Integration & Final Mix Workflow (Revised)

1.  **Implement Additive Song Stitching Workflow**
    *   Client (`sectionManager.js`): Refine `playSequence` for accurate sequential playback with defined crossfades. Implement logic to call the new server endpoint for song stitching.
    *   Server (`server.py`, `audio_utils.py`): Implement `/api/create-stitched-song` endpoint. Use `pydub` (via `audio_utils.py`) to concatenate uploaded sections with specified overlaps and crossfades, creating a single downloadable WAV file.
    *   Ensure consistency in crossfade/overlap parameters between client-side playback and server-side stitching.
    *   **Tonn API Role (Clarified):** Tonn is *not* used for sequencing complete sections. If Tonn integration is pursued, it would be for mixing multiple instrument stems *within each individual section* before those mixed sections are sent for stitching. This specific per-section Tonn mixing is a potential future enhancement if sections become more complex (multi-stem).
2.  **Enhance UI for Final Song Generation & Playback**
    *   Dedicated UI for initiating the final song stitching process.
    *   Display status of song stitching (e.g., uploading, stitching, complete).
    *   Provide a download link for the final stitched song.
    *   Allow playback of the final stitched song within the application.
3.  **Refine Visualization (if needed beyond Arduino)**
    *   More detailed in-browser visualization if required.
4.  **Automated Transitions (Additive Sequencing with Crossfades)**
    *   Client-side: `sectionManager.js` (`playSequence`) handles real-time sequential playback with crossfades between sections.
    *   Server-side: A dedicated process (`/api/create-stitched-song` using `pydub`) replicates this sequencing and crossfading to generate the final downloadable song file.

5.  **Tonn Mixing Integration (Clarified Role)**
    *   Tonn is **not** used for sequencing already-completed sections.
    *   If sections are composed of multiple stems that need mixing *before* sequencing, Tonn could be used for this *per-section* mixing. The resulting mixed sections would then be passed to the additive stitching process.
    *   The current primary path for final song creation is server-side stitching of sections.

6.  **Instrument Selection**
    *   1-3 instruments per section.
    *   Connected to camera captions.

## 6. Key Features from audio_doc.md

The architecture supports key features from audio_doc.md:

1.  **Section-Based Composition**
    *   15-second sections with proper transitions (automated).
    *   Progressive development across sections.
    *   Section role designation (intro, verse, chorus, etc.).

2.  **Progressive Prompt Logic**
    *   Variation tags for musical development.
    *   Sound palette consistency.
    *   BPM/genre consistency across sections.

3.  **Automated Transitions**
    *   Sequential playback with BPM-dependent crossfades (`sectionManager.js`).

4.  **Tonn Mixing Integration**
    *   Preview and final mix generation.
    *   Section upload and processing.
    *   Mix monitoring and retrieval.

5.  **Instrument Selection**
    *   1-3 instruments per section.
    *   Connected to camera captions.

6.  **Arduino/LED Visualization (Planned)**
    *   Display of basic track info and simplified waveform/levels.

## 7. Migration from Existing Codebase

When migrating from the existing codebase:

1.  **From `audio.js` (existing, not the new empty one):**
    *   Review any useful low-level Tone.js patterns if a future refactor is considered. For now, `sectionManager` and `audioContext.js` are primary.
    *   Session data structure concepts (now in `store.js`).
    *   Audio export functionality (to be robustly implemented in `sectionManager.exportSectionsForMixing` or a utility). 

2.  **From `visual-dna.js`:**
    *   Visualization framework concepts (can inform `src/components/visualizer.js` or direct implementation for Arduino).

3.  **From `sketch.js`:**
    *   Camera handling (now in `app.js`).
    *   Frame capture (now in `app.js`).

4.  **From `api.js` (old root file):**
    *   Core API call logic now refined in `src/core/api.js`.

5.  **From `server.py`:** (This refers to the Python backend)
    *   FastAPI setup, endpoint structure, CORS (retained and used).

6.  **From `serial.js` (old file):**
    *   Web Serial concepts now encapsulated in `src/core/hardware.js`.

The modular architecture ensures each component has a clear responsibility and minimal dependencies, making the system more maintainable and extensible.
