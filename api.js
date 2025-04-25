// --- GPT-4 Vision API ---

const OPENAI_API_KEY = ""; // <-- IMPORTANT: Replace with your actual key or use a secure method
const GPT4V_ENDPOINT = "https://api.openai.com/v1/chat/completions";

const PROMPT_TEMPLATE = `Describe this scene in ≤ 50 chars;
describe the scene with one emotion; suggest genre in 3 words;
estimate BPM if rhythmic. No experimental. Respond in JSON format: {"description": "", "genre": "", "bpm": null | number}`; // Modified for JSON output

async function describeScene(frameDataUrl) {
    if (OPENAI_API_KEY === "YOUR_OPENAI_API_KEY") {
        console.warn("OpenAI API Key not set in api.js. Using mock data.");
        // Return mock data for development without a key
        return {
            description: "Mock: A cozy desk setup",
            objects: ["keyboard", "monitor", "lamp"],
            genre: "lo-fi hip-hop",
            bpm: 85
        };
        // Or throw an error: throw new Error("OpenAI API Key not configured in api.js");
    }

    console.log("Sending frame to GPT-4 Vision...");

    try {
        const response = await fetch(GPT4V_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o", // Use gpt-4o as specified, it includes vision
                messages: [
                    {
                        role: "system",
                        content: "You are a concise scene‑music describer. Respond ONLY with a valid JSON object matching the requested format."
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "image_url",
                                // Ensure the data URL prefix is included if not already present
                                image_url: { url: frameDataUrl, detail: "low" } // Use low detail for cost efficiency
                            },
                            {
                                type: "text",
                                text: PROMPT_TEMPLATE
                            }
                        ]
                    }
                ],
                max_tokens: 150 // Adjust as needed
            })
        });

        if (!response.ok) {
            const errorBody = await response.json();
            console.error("GPT-4 Vision API Error:", errorBody);
            throw new Error(`API request failed with status ${response.status}: ${errorBody.error?.message || 'Unknown error'}`);
        }

        const data = await response.json();
        console.log("GPT-4 Vision Raw Response:", data);

        if (!data.choices || data.choices.length === 0 || !data.choices[0].message?.content) {
             console.error("Invalid response structure from GPT-4 Vision:", data);
             throw new Error("Failed to parse description from GPT-4 Vision response.");
        }

        // Attempt to parse the JSON content from the response
        try {
            // Extract JSON content from potential markdown code blocks
            let contentToParse = data.choices[0].message.content.trim();
            
            // Check if content is wrapped in markdown code blocks and extract the JSON part
            if (contentToParse.startsWith("```") && contentToParse.endsWith("```")) {
                // Remove the first line (```json) and the last line (```)
                const lines = contentToParse.split("\n");
                contentToParse = lines.slice(1, lines.length - 1).join("\n");
            }
            
            const content = JSON.parse(contentToParse);
            console.log("Parsed GPT-4 Vision Scene Description:", content);
            return content; // Should match {description, objects, genre, bpm}
        } catch (parseError) {
            console.error("Failed to parse JSON from GPT-4 Vision response content:", parseError);
            console.error("Raw content:", data.choices[0].message.content);
            // Provide a fallback or re-throw
             return { // Fallback structure
                description: "Error parsing response",
                objects: [],
                genre: "unknown",
                bpm: null
            };
            // throw new Error("Could not parse JSON response from GPT-4 Vision.");
        }

    } catch (error) {
        console.error("Error calling GPT-4 Vision:", error);
        // Return a default/error object or re-throw
        return { // Fallback structure
            description: "API Error",
            objects: [],
            genre: "error",
            bpm: null
        };
        // throw error; // Re-throw if the caller should handle it
    }
}


// --- Stable Audio API ---

const STABLE_AUDIO_API_KEY = ""; // <-- IMPORTANT: Replace with your actual key or use a secure method
const SA_GENERATE_ENDPOINT = "http://localhost:3000/api/generate-audio"; // URL to your Node.js proxy server

/**
 * Generates audio based on a text prompt and BPM
 * @param {string} prompt - Text prompt describing the desired audio
 * @param {number} bpm - Beats per minute for the audio
 * @param {number} duration - Duration of audio in seconds (default: 12s)
 * @returns {Promise<Object>} - Audio data including blob, BPM, key, duration
 */
async function generateAudio(prompt, bpm, duration = 12) {
    console.log(`Requesting audio generation: "${prompt}", BPM: ${bpm}, Duration: ${duration}s`);
    
    // Check if we're running in development without the Node.js server
    const isDevMode = !window.location.href.includes('localhost:3000');
    
    if (isDevMode) {
        console.warn("Running in development mode. Using mock audio.");
        return generateMockAudio(prompt, bpm, duration);
    }
    
    try {
        // Call the backend proxy server
        const response = await fetch(SA_GENERATE_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text_prompt: prompt,
                bpm: bpm || 120, // Ensure a default BPM value
                duration_seconds: duration
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Stable Audio Proxy Error:", errorText);
            
            // Check for payment required error
            if (response.status === 402 || (errorText && errorText.includes('402'))) {
                alert("Stability AI API requires payment! You need to add credits to your Stability AI account to generate audio.");
                throw new Error("Stable Audio API requires payment (402). Please add credits to your account.");
            } else if (response.status === 500) {
                alert("Server error when generating audio. Check the server logs.");
                throw new Error(`Audio generation request failed with status ${response.status}`);
            } else {
                throw new Error(`Audio generation request failed with status ${response.status}: ${errorText}`);
            }
        }

        // Get audio data as a Blob
        const audioBlob = await response.blob();
        console.log("Received audio blob, size:", audioBlob.size);

        // Get metadata from response headers
        const returnedBpm = response.headers.get('X-Audio-BPM');
        const returnedKey = response.headers.get('X-Audio-Key');
        const returnedDuration = response.headers.get('X-Audio-Duration');

        console.log(`Audio Metadata: BPM=${returnedBpm}, Key=${returnedKey}, Duration=${returnedDuration}`);

        return {
            audioBlob: audioBlob,
            bpm: returnedBpm ? parseInt(returnedBpm, 10) : (bpm || 120),
            key: returnedKey || 'unknown',
            duration: returnedDuration ? parseFloat(returnedDuration) : duration
        };
    } catch (error) {
        console.error("Error generating audio:", error);
        
        // If it's a payment error, show a clear message
        if (error.message && error.message.includes('402')) {
            console.warn("Payment required for Stability AI API. Using mock audio instead.");
        } else {
            alert(`Failed to generate audio: ${error.message}`);
        }
        
        // Fallback to mock audio in case of error
        console.log("Falling back to mock audio generation");
        return generateMockAudio(prompt, bpm, duration);
    }
}

/**
 * Generates a mock audio blob for development and testing
 * @private
 */
function generateMockAudio(prompt, bpm, duration) {
    try {
        // Create a proper WAV audio blob
        const sampleRate = 44100;
        const numChannels = 1; // Mono is simpler and more reliable
        const bitsPerSample = 16;
        const actualBpm = bpm || 120; // Default to 120 if null
        
        // Create WAV header
        const blockAlign = numChannels * bitsPerSample / 8;
        const byteRate = sampleRate * blockAlign;
        const dataSize = sampleRate * duration * blockAlign;
        const headerSize = 44;
        const totalSize = headerSize + dataSize;
        
        // Create a buffer for the WAV file
        const buffer = new ArrayBuffer(totalSize);
        const view = new DataView(buffer);
        
        // Write WAV header
        // "RIFF" chunk descriptor
        writeString(view, 0, 'RIFF');
        view.setUint32(4, totalSize - 8, true);
        writeString(view, 8, 'WAVE');
        
        // "fmt " sub-chunk
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true); // fmt chunk size
        view.setUint16(20, 1, true); // audio format (1 = PCM)
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        
        // "data" sub-chunk
        writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);
        
        // Write audio data - simple sine wave based on BPM
        const frequency = actualBpm / 60; // Base frequency on BPM
        for (let i = 0; i < sampleRate * duration; i++) {
            // Create a simple sine wave at the BPM frequency
            const sampleValue = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.5;
            
            // Convert to 16-bit and write to buffer
            const sampleInt = Math.floor(sampleValue * 32767);
            view.setInt16(headerSize + i * 2, sampleInt, true);
        }
        
        // Create blob from buffer
        const audioBlob = new Blob([buffer], { type: 'audio/wav' });
        
        console.log("Generated valid mock audio WAV blob:", audioBlob);
        
        // Return mock data
        return {
            audioBlob: audioBlob,
            bpm: actualBpm,
            key: 'C Major', // Mock key
            duration: duration
        };
    } catch (error) {
        console.error("Error generating mock audio:", error);
        
        // FALLBACK: Create a tiny valid WAV file
        const fallbackWav = createFallbackWav();
        return {
            audioBlob: fallbackWav,
            bpm: bpm || 120,
            key: 'C Major',
            duration: duration
        };
    }
}

// Helper to write strings to DataView
function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

// Create a minimal valid WAV file as fallback
function createFallbackWav() {
    // Create a minimal valid WAV file (44.1kHz, mono, 16-bit)
    const buffer = new ArrayBuffer(44 + 2 * 4410); // 44 byte header + 0.1s of silence
    const view = new DataView(buffer);
    
    // Write WAV header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + 2 * 4410, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);  // Mono
    view.setUint32(24, 44100, true);  // Sample rate
    view.setUint32(28, 44100 * 2, true);  // Byte rate
    view.setUint16(32, 2, true);  // Block align
    view.setUint16(34, 16, true);  // Bits per sample
    writeString(view, 36, 'data');
    view.setUint32(40, 2 * 4410, true);
    
    // Fill with silence (all zeros)
    for (let i = 0; i < 4410; i++) {
        view.setInt16(44 + i * 2, 0, true);
    }
    
    return new Blob([buffer], { type: 'audio/wav' });
}
