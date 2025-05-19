Okay, I've reviewed the provided files and your documentation (`audio_doc.md` and `building.md`). Here's an assessment of the current state and a plan for the next steps, focusing on testing sequential playback and then integrating Arduino/LCD functionality.


**Phase 2: Arduino Hardware Integration & LCD/LED Display (New Immediate Focus)**

This phase focuses on bringing the physical hardware interface to life, enabling button input for instrument selection/actions and providing visual feedback via LCD and LEDs.

1.  **Establish Frontend-Arduino Communication Protocol & Pin Mapping:**
    *   **Hardware Pins (from User Image):**
        *   Buttons (Input): Pin 22 (Inst 1), 26 (Inst 2), 30 (Inst 3), 34 (Inst 4), 38 (Action).
        *   LEDs (Output): Pin 24 (Inst 1 LED), 28 (Inst 2 LED), 32 (Inst 3 LED), 36 (Inst 4 LED), 40 (Action/Status LED).
    *   **Frontend to Arduino (JSON via Serial):**
        ```json
        {
          "lcd_l1": "BPM:XXX Genre",  // LCD Line 1 (max ~16-20 chars)
          "lcd_l2": "Sec: Verse 1",   // LCD Line 2 (max ~16-20 chars)
          "leds": [1,0,1,0,1],      // Array for 5 LEDs (Inst1, Inst2, Inst3, Inst4, Action/Status)
          "vu": 75                  // Audio level (0-100) for VU meter display on OLED/LEDs
        }
        ```
    *   **Arduino to Frontend (JSON via Serial):** For button presses (debounced).
        ```json
        {"btn": 0} // Button for Inst 1 (Pin 22) pressed
        {"btn": 1} // Button for Inst 2 (Pin 26) pressed
        // ...
        {"btn": 4} // Action Button (Pin 38) pressed
        ```

2.  **Implement Arduino Sketch Logic (User Task - Detailed Outline Provided Separately):**
    *   Initialize pins (Buttons: INPUT_PULLUP or INPUT; LEDs: OUTPUT), LCD (U8g2), Serial (115200 baud).
    *   **Loop:**
        *   Read button states (debounced). On press, send the corresponding `{"btn": X}` JSON.
        *   Check for incoming Serial data. Parse the JSON from the frontend.
        *   Update LCD with `lcd_l1`, `lcd_l2`.
        *   Set LED states (Pins 24, 28, 32, 36, 40) using the `leds` array from JSON.
        *   Update an LED-based VU meter (on OLED or separate LEDs) using the `vu` value.

3.  **Frontend Implementation (`app.js`, `hardware.js`, `sectionManager.js`):**
    *   **`hardware.js`:** `send(data)` and `processMessage(message)` are suitable for the JSON protocol. Ensure baud rate matches Arduino (115200).
    *   **`sectionManager.js`:** `getAudioLevel()` provides the `vu` value (0-100) from an `AnalyserNode`.
    *   **`app.js` (Main Control Logic):**
        *   **Connection:** UI for Connect/Disconnect; call `hw.connect()`, `hw.onStatus`, `hw.onMessage`.
        *   **State Management:** Add `this.state.isGeneratingAudio` (boolean).
        *   **Button Handling (`processArduinoButtonPress`):** 
            *   `btn 0-3`: Toggle corresponding instrument in `currentSection.instruments` in the `store`. The `instrumentMap` in `app.js` must align with these button IDs.
            *   `btn 4`: Trigger a defined action (e.g., `captureImage()`).
        *   **LED Logic (`getLedStates()`):** This crucial function determines the state of the 5 LEDs.
            *   `leds[0-3]` (Pins 24,28,32,36): Turn ON if the corresponding instrument is in `currentSection.instruments`. OFF otherwise. These reflect the *selection for the currently focused section*.
            *   `leds[4]` (Pin 40 - Action/Status LED): 
                *   Solid ON if `this.state.isGeneratingAudio` is true.
                *   Solid ON if `sectionManager.isPlaying` is true.
                *   (Optional: Could also light briefly on action button press confirmation).
                *   OFF otherwise.
        *   **Sending Data (`sendInfoToArduino()`):** Called periodically and on relevant state changes (instrument selection, playback start/stop, generation start/stop, section change).
            *   Retrieves BPM, genre, section name from `store` for LCD.
            *   Calls `getLedStates()` for the `leds` array.
            *   Calls `sectionManager.getAudioLevel()` for `vu`.
            *   Formats and sends the JSON to Arduino via `hw.send()`.
            *   Avoids redundant sends if key data hasn't changed (unless VU meter or blinking LED needs frequent updates).

4.  **Refine UI for Instrument Selection in `app.js`:**
    *   Ensure instrument selection UI elements in the web interface directly update the `store`, which in turn triggers `sendInfoToArduino` to update hardware LEDs.
    *   Visual feedback in the UI should also reflect selections made via Arduino buttons.



