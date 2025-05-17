# Music Creation Pipeline

> **One-sentence overview**: Press Shutter → GPT-4 Vision describes scene → Select 1-3 instruments → Stable Audio 2 generates 15s section with consistent BPM/genre → sections are automatically looped with real-time crossfades → new sections seamlessly integrate into ongoing playback → Tonn `/mixpreview` auto-triggers after new section generation → final mix replaces raw sections at next loop boundary.

---

## 1. Workflow Overview

| # | Stage | Input | API Call / Local Action | Output |
| - | ----- | ----- | ----------------------- | ------ |
| ① | **Capture** | `imageFrame` | — | — |
| ② | **Caption** | `imageFrame` | **GPT-4 Vision** | `caption` |
| ③ | **Instrument Selection** | `caption` | User selects 1-3 instruments | `instruments[]` |
| ④ | **Generate v1** *(first section)* | `caption + instruments[]` | **Stable Audio 2** `/v1/generate` | `section_1.wav` (15s) |
| ⑤ | **Store & Begin Loop** | `section_1.wav` | Decode to AudioBuffer, Store, Begin Continuous Playback | `Section#1` looping |
| ⑥ | **Capture again** | `imageFrame₂` | — | — |
| ⑦ | **Caption₂** | `imageFrame₂` | GPT-4 Vision | `caption₂` |
| ⑧ | **Instrument Selection₂** | `caption₂` | User selects 1-3 instruments | `instruments₂[]` |
| ⑨ | **Generate v2 (Progression)** | `caption₂ + instruments₂[] + variationTag` | **Stable Audio 2** `/v1/generate` | `section_2.wav` (same BPM/genre, progressive) |
| ⑩ | **Add to Loop** | `section_2.wav` | Decode to AudioBuffer, Add to Continuous Playback | `Section#1+2` looping |
| ⑪ | **Auto-Trigger Preview Mix** | All sections | **Tonn** `/mixpreview` via Python | Mixing job starts |
| ⑫ | **Mix Progress Monitoring** | — | Webhook or Polling | Mix status updates |
| ⑬ | **Auto-Replace with Mixed Version** | Completed mix | Load mixed version at next loop boundary | Seamless transition to mixed audio |
| ⑭ | **Iterate Capture → Generate** | — | Repeat ⑥-⑬ | New sections → Auto-Mixed loop |
| ⑮ | **Final Mix (Optional)** | All sections | **Tonn** `/mix` via Python | `finalMix.wav` *(full track master)* |

> **Note**: From stage ⑨ onward, *Progressive Prompt Logic* is used: the system generates a `variationTag` for each new section, and adds `paletteId` to the prompt, ensuring progressive development while maintaining the same BPM/genre.

### 1.1 Continuous Playback & Auto-Mixing Flow

1. **Immediate Looping**: As soon as the first section is generated, it begins looping automatically.
2. **Seamless Additions**: New sections are automatically added to the playback loop with crossfades.
3. **Background Mixing**: When new sections are added, automatic mixing via Tonn is triggered without interrupting playback.
4. **Smart Transitions**: When a mix is complete, the system schedules a transition from raw sections to the mixed version at the next loop boundary.
5. **Real-time Feedback**: Visual indicators show current playback position, mixing status, and upcoming transitions.

### 1.2 Interaction Points

1. **Ongoing Creation Phase**: User continuously captures images → generates sections → system handles integration into playback.
2. **Mix Auto-management**: System automatically tracks mix tasks and transitions to improved audio versions.
3. **User Controls**: Pause/Resume, Volume, Loop Count, and Mix Quality settings provide user control without interrupting workflow.
4. **Optional Final Polish**: User can trigger a high-quality final mix for download and export.

---

## 2. Caption → Prompt → Music Generation

### 2.1 Improved Image Description Template

> **Goal**: Generate *arrangeable* music prompts from each photo, including section intent, mood, and beat information, for section-based composition.

```text
You are Scene-Music Captioner v2. Return **valid JSON only** with these keys:
  description   – ≤40 chars vivid summary
  objects       – up to 3 salient nouns
  mood          – 2-3 adjectives (e.g. "warm, nostalgic")
  section       – one of [intro, verse, chorus, bridge, outro]
  genre         – 1-3 words (e.g. "lo-fi hip-hop")
  bpm           – integer 60-180 (estimate or null)
Example output:
{"description":"Orange sunset over calm sea","objects":["sea","sky"],"mood":"warm, dreamy","section":"intro","genre":"ambient chill","bpm":90}
```

* The **section** field tells the system the clip's role in the song structure; default to "verse" if hard to judge.
* **mood** controls timbre and effects; can be mapped to Stable Audio style words.

### 2.2 Prompt Construction Rules

```js
function buildPrompt({description, mood, genre, section}, instruments, clipIndex){
  // Join selected instruments into a single string
  const instrumentsText = instruments.join(", ");
  
  // Base prompt including all instruments
  const base = `${instrumentsText} section, ${description}, ${mood}, ${genre}`;
  
  // Get structure hint based on section type
  const struct = section==='chorus' ? 'higher energy, catchy hook' :
                 section==='bridge' ? 'transitional feel' :
                 section==='outro'  ? 'winding down' : 'steady groove';
  
  // Get variation tag based on clip index
  const vary = clipIndex === 0 ? '' :
               clipIndex % 4 === 1 ? 'subtle variation' :
               clipIndex % 4 === 2 ? 'motif development' : 
               'dynamic evolution';
  
  // Add palette ID for consistency if not the first section
  const palette = clipIndex > 0 ? ', same sound palette as previous section' : '';
  
  // Combine all elements
  return `${base}, ${struct}${vary ? ', ' + vary : ''}${palette}`;
}
```

* **First section (v1)**: `prompt = buildPrompt(json, instruments, 0)` → `/v1/generate` with 15s duration.
* **Subsequent sections (vN)**: `prompt = buildPrompt(json, instruments, clipIndex)` → `/v1/generate`; keep `tempo_bpm` consistent with `session.bpm`.

### 2.3 Progressive Prompt Logic

> Each new section builds on previous sections using variation tags to ensure musical development while maintaining consistency.

```js
// Variation tags cycle to create musical development
const variationTags = [
  'steady groove',       // First section (though not explicitly added)
  'subtle variation',    // Minor changes, same structure
  'motif development',   // Add complexity, evolve themes
  'dynamic evolution'    // Change energy level, peak or valley
];

// Get variation tag based on section position
function getVariationTag(sectionIndex) {
  if (sectionIndex === 0) return ''; // First section has no variation
  return variationTags[sectionIndex % variationTags.length];
}
```

* **steady groove**: Base section establishes the feel.
* **subtle variation**: Keep same key and rhythm, change 10-20% of melody.
* **motif development**: Introduce additional harmony or counter-melody.
* **dynamic evolution**: Increase density or energy (recommended for bridge/chorus).

System flow:
1. Each new section uses the appropriate variation tag based on its position.
2. Call `/v1/generate` with `tempo_bpm = session.bpm`, `duration_seconds = 15`.
3. Frontend compares returned WAV with first section (key detection) to ensure no major harmonic drift; prompts user to reshoot if key clash detected.

### 2.4 Example: Three-section Progressive Generation

| Round | Prompt | Description |
|-------|--------|-------------|
| 1 | "drums, bass, guitar section, orange sunset..., warm dreamy, ambient chill, steady groove" | Intro 15s |
| 2 | "keys, vocals section, purple neon..., moody lush, ambient chill, steady groove, subtle variation, same sound palette as previous section" | Verse 15s |
| 3 | "drums, synth, guitar section, vibrant art..., energetic bright, ambient chill, higher energy, catchy hook, motif development, same sound palette as previous section" | Chorus 15s |

This way, Stable Audio creates cohesive sections that progress naturally while maintaining the same overall sonic character.

---

## 3. Continuous Playback & Auto-Mixing Architecture

### 3.1 Playback Engine

The continuous playback engine maintains an uninterrupted audio stream by:

```js
class LoopEngine {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.sections = [];
    this.isPlaying = false;
    this.loopCount = 0;
    this.lookaheadTime = 0.5; // seconds
    this.scheduledSources = [];
    this.transitionScheduled = false;
    this.nextSectionStartTime = 0;
  }

  addSection(section) {
    this.sections.push(section);
    if (this.isPlaying) {
      this.scheduleNextSections();
    }
  }

  start() {
    if (this.sections.length === 0) return;
    
    this.isPlaying = true;
    this.nextSectionStartTime = this.audioContext.currentTime;
    this.scheduleNextSections();
  }

  scheduleNextSections() {
    // Schedule sections with lookahead buffer
    // At loop boundaries, check for mix transitions
  }

  scheduleTransitionToMix(mixedVersion) {
    // Schedule transition at next loop boundary
    this.transitionScheduled = true;
  }
}
```

### 3.2 Automatic Mixing Module

The automatic mixing module manages the background mixing process:

```js
class AutoMixingModule {
  constructor(sectionManager) {
    this.sectionManager = sectionManager;
    this.mixInProgress = false;
    this.lastMixTaskId = null;
  }

  checkAndTriggerMix(newSection) {
    if (!this.mixInProgress && this.sectionManager.sections.length >= 2) {
      this.triggerMix();
    }
  }

  async triggerMix() {
    this.mixInProgress = true;
    
    // Upload sections to Tonn
    const uploadResult = await this.sectionManager.exportSectionsForMixing();
    
    // Create preview mix
    const previewResult = await api.createPreviewMix(uploadResult.sections, store.get('genre'));
    this.lastMixTaskId = previewResult.task_id;
    
    // Monitor status via webhooks or polling
    this.monitorMixStatus(this.lastMixTaskId);
  }

  async monitorMixStatus(taskId) {
    // When complete, schedule transition
    this.sectionManager.scheduleTransitionToMix(mixedVersion);
    this.mixInProgress = false;
  }
}
```

### 3.3 Seamless Transitions

The system handles seamless transitions between audio states by:

1. **Scheduling at Loop Boundaries**: Transitions occur only at natural loop points
2. **Pre-loading**: Mixed audio is fully loaded before transitions occur
3. **Precise Timing**: Transitions are timed to the exact audio sample
4. **Crossfading**: Short crossfades ensure smooth transitions
5. **State Preservation**: Playback position is maintained during transitions

---

## 4. Frontend Integration Key Points

### 4.0 Global Session Manager

> **Core principle**: The first section determines this song's *tempo/genre/key/paletteId*; all subsequent sections must inherit these global attributes to ensure consistent arrangement.

```ts
interface Section {
  buffer: Tone.Buffer;
  startTime: number;
  duration: number;
  caption: CaptionJSON;
  instruments: string[];
}

interface SessionState {
  bpm: number;
  genre: string;
  key?: string;
  paletteId: string;
  sections: Section[];
  lastPreviewAt: number;
  previewTaskId?: string;
  barsPerClip: number;
}
```

1. **Initialization**: When generating the first section, write the caption's estimated `bpm`, `genre`, and generate a `paletteId` to `SessionState`. If `bpm==null`, use Stable Audio's returned `detected_bpm`.
2. **Subsequent Generation**:
   * When requesting `/v1/generate`, fix `tempo_bpm = session.bpm`.
   * Append `in ${session.genre} style` and reference `paletteId` in the prompt.
   * Calculate `barsPerClip = Math.round((15 * session.bpm) / 60 / 4)` for timeline display.
3. **UI Feedback**: Display current BPM, genre, and section count in LED top bar; if user wants to change, start a new Session.
4. **Key Detection**: Use `music_key_estimator` to detect the tonality of each section, compare with `session.key` using the Camelot wheel, and warn if incompatible.

### 4.1 Section Data Structure

```ts
// Section represents a complete musical segment with multiple instruments
type Section = {
  buffer: Tone.Buffer,  // The complete audio for this section
  startTime: number,    // When this section starts in the timeline
  duration: number,     // Duration of this section (typically 15s)
  caption: CaptionJSON, // The original caption data
  instruments: string[] // The 1-3 instruments selected for this section
}

// SessionState manages the entire composition
type SessionState = {
  sections: Section[],
  bpm: number,
  genre: string,
  key: string,
  paletteId: string,
  lastPreviewAt: number,
  barsPerClip: number
}
```

* **Layer**: Wheel offset ≤ 2 beats, `startTime` remains consistent.
* **Sequence**: Wheel pushed to next section, `startTime = lastSection.startTime + lastSection.duration - crossfadeDuration`.

### 4.3 Section Transitions and Crossfades

(Automated by `sectionManager.playSequence` using Web Audio API GainNode ramps. Crossfade duration is BPM-dependent, e.g., 2 beats.)

```javascript
// Conceptual: Actual implementation in sectionManager.js
async function playSequenceWithCrossfades(sectionIds, bpm) {
  const audioContext = getAudioContext();
  let currentTime = audioContext.currentTime;
  const crossfadeDuration = (2 / (bpm / 60)); // 2 beats

  for (let i = 0; i < sectionIds.length; i++) {
    const sectionId = sectionIds[i];
    const buffer = getAudioBufferForSection(sectionId); // Helper to get buffer
    if (!buffer) continue;

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    const gainNode = audioContext.createGain();

    // Start silent
    gainNode.gain.setValueAtTime(0, currentTime);
    // Fade in (or crossfade in)
    gainNode.gain.linearRampToValueAtTime(1, currentTime + (i === 0 ? Math.min(1, buffer.duration / 2) : crossfadeDuration));
    
    // Fade out
    const fadeOutStartTime = currentTime + buffer.duration - crossfadeDuration;
    if (fadeOutStartTime > currentTime + crossfadeDuration) {
        gainNode.gain.setValueAtTime(1, fadeOutStartTime);
        gainNode.gain.linearRampToValueAtTime(0, currentTime + buffer.duration);
    }

    source.connect(gainNode).connect(audioContext.destination);
    source.start(currentTime);

    if (i < sectionIds.length - 1) {
      currentTime += (buffer.duration - crossfadeDuration); // Overlap for crossfade
    } else {
      currentTime += buffer.duration; // Last section full duration
    }
  }
}
```

---

## 5. Tonn Mixing/Mastering Strategy

### 5.0 Section → TONN Group Mapping

Since sections may contain multiple instruments, we need to adapt the Tonn mapping:

| Section Content | Tonn `instrument_group` |
|-----------------|--------------------------|
| Sections with drums | "DRUMS_GROUP" |
| Sections with bass only | "BASS_GROUP" |
| Sections with guitar | "GUITAR_GROUP" (acoustic/electric based on caption) |
| Sections with keys/synth | "KEYS_GROUP" / "SYNTH_GROUP" |
| Sections with multiple instruments | "FULL_MIX_GROUP" |

**Presence Settings** automatically assigned based on `section` and `mood`:
* intro/verse → `"BACKGROUND"`
* chorus/solo → `"UPFRONT"`
* bridge/outro → `"NORMAL"`
* Override to `"UPFRONT"` when section.mood contains "energetic" OR variationTag is "dynamic evolution"

`musical_style` field directly maps `session.genre.toUpperCase()` to TONN:

| Genre | Tonn `musical_style` |
|-------|----------------------|
| "lo-fi hip-hop" | "HIPHOP" |
| "ambient chill" | "ELECTRONIC" |
| "synthwave" | "ELECTRONIC" |
| "indie rock" | "ROCK_INDIE" |
| All others | "OTHER" |

### 5.1 API Overview

| Endpoint | Purpose | Duration Limit |
|----------|---------|----------------|
| `/mixpreview` | 30s preview master (automatically takes first 30s of song) | Fixed ~30s limit |
| `/mix` | Generate complete master based on preview Task-ID | Full original length |

### 5.2 Call Strategy

* **Real-time Creation**: Meet "3 new sections or 15s idle" → call `/mixpreview` → poll in background, fade in preview when complete.
* **Finalize Work**: Click *Finish* → if preview exists, use its task_id for `/mix`; otherwise generate preview first then full mix.

### 5.3 Cost and Rate Limiting

* `/mixpreview` has low rate; `/mix` only charges the difference.
* Rate limit ≈ 5 req/min; for a 3-min song ≈ 6 sections, each Session only needs 1 preview + 1 full mix; recommend caching preview for 15 min.
