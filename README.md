# Lumia: Camera Music Generator

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

