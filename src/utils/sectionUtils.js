/**
 * Section utilities for working with musical sections
 */

/**
 * Get available section types with metadata
 * @returns {Array} Array of section types with metadata
 */
export function getSectionTypes() {
  return [
    {
      id: 'intro',
      name: 'Intro',
      description: 'Opening section that establishes the song',
      defaultDuration: 30,
      order: 0
    },
    {
      id: 'verse',
      name: 'Verse',
      description: 'Main narrative section of the song',
      defaultDuration: 30,
      order: 1
    },
    {
      id: 'chorus',
      name: 'Chorus',
      description: 'Repeated section with the main hook',
      defaultDuration: 30,
      order: 2
    },
    {
      id: 'bridge',
      name: 'Bridge',
      description: 'Contrasting section that provides relief from main sections',
      defaultDuration: 15,
      order: 3
    },
    {
      id: 'outro',
      name: 'Outro',
      description: 'Closing section of the song',
      defaultDuration: 15,
      order: 4
    }
  ];
}

/**
 * Get section type data by ID
 * @param {string} typeId - The section type ID
 * @returns {Object|null} Section type data or null if not found
 */
export function getSectionTypeById(typeId) {
  const types = getSectionTypes();
  return types.find(type => type.id === typeId) || null;
}

/**
 * Get available instrument options for sections
 * @returns {Array} Array of instrument options
 */
export function getInstrumentOptions() {
  return [
    {
      id: 'drums',
      name: 'Drums',
      description: 'Percussion and rhythm instruments',
      category: 'rhythm'
    },
    {
      id: 'bass',
      name: 'Bass',
      description: 'Low frequency instruments providing foundation',
      category: 'rhythm'
    },
    {
      id: 'guitar',
      name: 'Guitar',
      description: 'String instruments for chords and melodies',
      category: 'melodic'
    },
    {
      id: 'piano',
      name: 'Piano',
      description: 'Keyboard instruments for harmony and melodies',
      category: 'melodic'
    },
    {
      id: 'synth',
      name: 'Synth',
      description: 'Synthesized electronic sounds',
      category: 'electronic'
    },
    {
      id: 'strings',
      name: 'Strings',
      description: 'Orchestral string instruments',
      category: 'orchestral'
    },
    {
      id: 'brass',
      name: 'Brass',
      description: 'Trumpets, trombones, and other brass instruments',
      category: 'orchestral'
    },
    {
      id: 'woodwinds',
      name: 'Woodwinds',
      description: 'Flutes, saxophones, and other wind instruments',
      category: 'orchestral'
    },
    {
      id: 'vocals',
      name: 'Vocals',
      description: 'Human voice samples',
      category: 'voice'
    }
  ];
}

/**
 * Get instrument data by ID
 * @param {string} instrumentId - The instrument ID
 * @returns {Object|null} Instrument data or null if not found
 */
export function getInstrumentById(instrumentId) {
  const instruments = getInstrumentOptions();
  return instruments.find(inst => inst.id === instrumentId) || null;
}

/**
 * Group instruments by category
 * @returns {Object} Object with categories as keys and arrays of instruments as values
 */
export function getInstrumentsByCategory() {
  const instruments = getInstrumentOptions();
  return instruments.reduce((groups, instrument) => {
    const category = instrument.category;
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(instrument);
    return groups;
  }, {});
}

/**
 * Get recommended instrument combinations for different section types
 * @param {string} sectionType - The section type ID
 * @returns {Array} Array of recommended instrument combinations
 */
export function getRecommendedInstruments(sectionType) {
  const recommendations = {
    intro: [['drums', 'synth'], ['piano'], ['guitar', 'bass']],
    verse: [['drums', 'bass', 'guitar'], ['piano', 'bass'], ['drums', 'synth', 'bass']],
    chorus: [['drums', 'bass', 'guitar', 'synth'], ['drums', 'bass', 'piano'], ['drums', 'bass', 'strings']],
    bridge: [['piano', 'strings'], ['guitar', 'synth'], ['drums', 'bass', 'synth']],
    outro: [['piano'], ['guitar', 'strings'], ['synth', 'strings']]
  };
  
  return recommendations[sectionType] || [['drums', 'bass', 'guitar']];
}

/**
 * Calculate the total duration of all sections
 * @param {Array} sections - Array of section objects
 * @returns {number} Total duration in seconds
 */
export function calculateTotalDuration(sections) {
  return sections.reduce((total, section) => {
    // Use actual duration if available, otherwise fall back to default for section type
    const sectionType = getSectionTypeById(section.type);
    const duration = section.duration || (sectionType ? sectionType.defaultDuration : 30);
    return total + duration;
  }, 0);
}

/**
 * Get recommended BPM ranges for different genres
 * @param {string} genre - The genre name
 * @returns {Object} Min and max recommended BPM values
 */
export function getRecommendedBPM(genre) {
  const bpmRanges = {
    'pop': { min: 100, max: 130 },
    'rock': { min: 110, max: 140 },
    'electronic': { min: 120, max: 150 },
    'hiphop': { min: 85, max: 100 },
    'jazz': { min: 80, max: 120 },
    'classical': { min: 60, max: 100 },
    'ambient': { min: 60, max: 80 }
  };
  
  return bpmRanges[genre.toLowerCase()] || { min: 80, max: 140 };
}

/**
 * Validate the sections arrangement for completeness and logical flow
 * @param {Array} sections - Array of section objects
 * @returns {Object} Validation result with isValid flag and messages
 */
export function validateSectionArrangement(sections) {
  if (!sections || sections.length === 0) {
    return {
      isValid: false,
      messages: ['No sections found in arrangement']
    };
  }
  
  const messages = [];
  
  // Check for at least one verse and one chorus
  const hasVerse = sections.some(section => section.type === 'verse');
  const hasChorus = sections.some(section => section.type === 'chorus');
  
  if (!hasVerse) {
    messages.push('Arrangement has no verse sections');
  }
  
  if (!hasChorus) {
    messages.push('Arrangement has no chorus sections');
  }
  
  // Check for logical flow (intro at start, outro at end)
  if (sections[0].type !== 'intro') {
    messages.push('Arrangement does not start with an intro');
  }
  
  if (sections[sections.length - 1].type !== 'outro') {
    messages.push('Arrangement does not end with an outro');
  }
  
  // Check if all sections have instruments selected
  const sectionsWithoutInstruments = sections.filter(
    section => !section.instruments || section.instruments.length === 0
  );
  
  if (sectionsWithoutInstruments.length > 0) {
    messages.push(`${sectionsWithoutInstruments.length} section(s) have no instruments selected`);
  }
  
  return {
    isValid: messages.length === 0,
    messages
  };
} 