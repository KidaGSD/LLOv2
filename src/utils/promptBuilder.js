/**
 * promptBuilder.js - Functions for constructing AI prompts
 * 
 * Contains utilities for building prompts for both GPT-4o Vision and Stable Audio
 * based on the section-based progressive composition approach.
 */

// GPT-4o Vision prompt template as described in audio_doc.md
export const VISION_PROMPT_TEMPLATE = `You are Scene-Music Captioner v2. Return **valid JSON only** with these keys:
  description   – ≤40 chars vivid summary
  objects       – up to 3 salient nouns
  mood          – 2-3 adjectives (e.g. "warm, nostalgic")
  section       – one of [intro, verse, chorus, bridge, outro] 
  genre         – 1-3 words (e.g. "lo-fi hip-hop")
  bpm           – integer 60-180 (estimate or null)
Example output:
{"description":"Orange sunset over calm sea","objects":["sea","sky"],"mood":"warm, dreamy","section":"intro","genre":"ambient chill","bpm":90}`;

/**
 * Build a complete prompt for Stable Audio generation
 * 
 * @param {Object} caption - The GPT-4o Vision caption data
 * @param {Array} instruments - Array of selected instruments
 * @param {number} clipIndex - Position in the song (used for variation)
 * @param {Object} options - Additional options (paletteId, genre, etc.)
 * @returns {string} Complete prompt for Stable Audio
 */
export function buildPrompt(caption, instruments, clipIndex, options = {}) {
  // Extract caption data
  const { description, mood, genre, section } = caption;
  
  // Use provided genre or the one from caption
  const activeGenre = options.genre || genre;
  
  // Join selected instruments into a single string
  const instrumentsText = instruments.join(", ");
  
  // Base prompt including all instruments and description
  const base = `${instrumentsText} section, ${description}, ${mood}, ${activeGenre}`;
  
  // Get structure hint based on section type
  const structureHint = section === 'chorus' ? 'higher energy, catchy hook' :
                         section === 'bridge' ? 'transitional feel' :
                         section === 'outro' ? 'winding down' : 
                         'steady groove';
  
  // Get variation tag based on clip index or the provided one
  const variationTag = clipIndex === 0 ? '' :
                       options.variationTag || getVariationTag(clipIndex);
  
  // Add palette ID for consistency if not the first section
  const paletteReference = clipIndex > 0 && options.paletteId ? 
                          ', same sound palette as previous section' : '';
  
  // Combine all elements
  return `${base}, ${structureHint}${variationTag ? ', ' + variationTag : ''}${paletteReference}`;
}

/**
 * Get the appropriate variation tag based on section position
 * 
 * @param {number} sectionIndex - Index of the section in the composition
 * @returns {string} Appropriate variation tag
 */
export function getVariationTag(sectionIndex) {
  // Variation tags cycle to create musical development
  const variationTags = [
    'steady groove',       // First section (though not explicitly added)
    'subtle variation',    // Minor changes, same structure
    'motif development',   // Add complexity, evolve themes
    'dynamic evolution'    // Change energy level, peak or valley
  ];
  
  // First section has no variation
  if (sectionIndex === 0) return '';
  
  // Return the appropriate tag based on position (cycle through them)
  return variationTags[sectionIndex % variationTags.length];
}

/**
 * Generate GPT-4o Vision system message for image captioning
 * 
 * @returns {Object} System message for GPT-4o
 */
export function getVisionSystemMessage() {
  return {
    role: "system",
    content: "You are a concise scene‑music describer. Respond ONLY with a valid JSON object matching the requested format."
  };
}

/**
 * Build a user message for GPT-4o Vision with image and prompt
 * 
 * @param {string} imageUrl - Base64 data URL or regular URL of the image
 * @returns {Object} User message for GPT-4o
 */
export function buildVisionUserMessage(imageUrl) {
  return {
    role: "user",
    content: [
      {
        type: "image_url",
        image_url: { url: imageUrl, detail: "low" } // Using low detail for cost efficiency
      },
      {
        type: "text",
        text: VISION_PROMPT_TEMPLATE
      }
    ]
  };
}

/**
 * Parse caption JSON from GPT-4o response
 * 
 * @param {Object} response - The response from GPT-4o
 * @returns {Object|null} Parsed caption data or null if parsing failed
 */
export function parseCaptionFromResponse(response) {
  try {
    if (!response.choices || response.choices.length === 0) {
      return null;
    }
    
    // Extract the content from the response
    const content = response.choices[0].message.content.trim();
    
    // Check if content is wrapped in markdown code blocks
    let jsonContent = content;
    if (content.startsWith("```") && content.endsWith("```")) {
      // Remove the markdown code blocks
      const lines = content.split("\n");
      jsonContent = lines.slice(1, lines.length - 1).join("\n");
    }
    
    // Parse the JSON
    return JSON.parse(jsonContent);
  } catch (error) {
    console.error("Failed to parse caption from response:", error);
    return null;
  }
}
