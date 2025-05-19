// Arduino Sketch for Section-Based Music Generator Interface
// Integrates with web application for hardware control and visualization

#include <Wire.h>         // Required for I2C communication
#include <U8g2lib.h>      // For OLED display
#include <Arduino_JSON.h> // For parsing JSON data

// --- OLED Display Setup ---
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, /* reset=*/ U8X8_PIN_NONE);

// --- Pin Definitions ---
// Buttons (using standard Arduino pins - adjust if needed)
const int buttonPins[] = {22, 26, 30, 34, 40, 5, 6, 7}; // 0-3: Instruments, 4: Effects, 5: Clear, 6: Mute, 7: Capture
const int NUM_BUTTONS = sizeof(buttonPins) / sizeof(buttonPins[0]);

// LEDs (OUTPUT)
const int ledPins[] = {24, 28, 32, 36, 9, 10, 11, 12}; // LEDs match buttons - first 4 are for instruments
const int NUM_LEDS = sizeof(ledPins) / sizeof(ledPins[0]);

// --- Button State Tracking ---
bool lastButtonStates[NUM_BUTTONS];  // Last read state
bool buttonStates[NUM_BUTTONS];      // Current debounced state
bool instrumentSelected[4] = {false, false, false, false}; // Track instrument selection
unsigned long lastDebounceTime[NUM_BUTTONS];
unsigned long buttonPressStartTime[NUM_BUTTONS]; // For long press detection
bool buttonLongPressHandled[NUM_BUTTONS];        // Flag to handle long press only once
bool isMuted = false;  // Track mute state

// --- Timing Constants ---
const unsigned long DEBOUNCE_DELAY = 30;      // Reduced debounce delay for better responsiveness
const unsigned long LONG_PRESS_TIME = 2000;   // Long press detection threshold (2 seconds)
const unsigned long EFFECT_PRESS_TIME = 500;  // Button 4 effect long press threshold (500ms)

// --- Serial Communication ---
const unsigned long BAUD_RATE = 115200;
char serialBuffer[512]; // Buffer for incoming serial data
unsigned long lastHeartbeat = 0;
const unsigned long HEARTBEAT_INTERVAL = 3000; // Send heartbeat every 3 seconds

// --- LCD Display Content ---
char lcdLine1[21] = "Ready..."; // Max 20 chars + null
char lcdLine2[21] = "Connect Web App";   // Max 20 chars + null
char tempMessage[21] = "";           // For temporary status messages
unsigned long tempMessageTime = 0;   // When the temp message was set
const unsigned long TEMP_MESSAGE_DURATION = 1500; // Shorter temp message

// --- VU Meter ---
int vuLevel = 0; // 0-100
const unsigned long VU_UPDATE_INTERVAL = 50; // Reduced from 100ms for smoother updates

// --- Animation Variables ---
unsigned long lastAnimationTime = 0;
int animationFrame = 0;
bool effectActive = false;           // Tracks if sound effect is active
unsigned long effectStartTime = 0;   // When the effect was triggered
unsigned long effectDuration = 2000; // Default effect duration

// --- Connection Status ---
bool webAppConnected = false;
unsigned long lastPacketReceived = 0;
const unsigned long CONNECTION_TIMEOUT = 5000; // Consider disconnected after 5 seconds of no data

// --- Waveform Data ---
byte waveData[SCREEN_WIDTH]; // For 128 points of waveform data
bool newWaveDataAvailable = false;
unsigned long lastWaveformUpdate = 0; // To manage waveform display updates
unsigned long forceDisplayUpdateTime = 0; // To force updates periodically

// --- LCD Display & Visualization Global Flag (Replaces duplicated specific display variables) ---
bool displayRefreshNeeded = true; // Flag to trigger display update
int lastVuLevelSentToDisplay = 0;

// --- Setup ---
void setup() {
  Serial.begin(BAUD_RATE);

  // Initialize Button Pins
  for (int i = 0; i < NUM_BUTTONS; i++) {
    pinMode(buttonPins[i], INPUT_PULLUP); // Use INPUT_PULLUP for more reliable button reading
    lastButtonStates[i] = HIGH; // Initial state is HIGH (not pressed) when using INPUT_PULLUP
    buttonStates[i] = HIGH;
    lastDebounceTime[i] = 0;
    buttonPressStartTime[i] = 0;
    buttonLongPressHandled[i] = false;
  }

  // Initialize LED Pins
  for (int i = 0; i < NUM_LEDS; i++) {
    pinMode(ledPins[i], OUTPUT);
    digitalWrite(ledPins[i], LOW); // Turn all LEDs off initially
  }
  
  // Test all LEDs at startup
  testLEDs();

  // Initialize OLED Display
  u8g2.begin();
  u8g2.setFont(u8g2_font_5x7_tf); // Using a smaller font for more status info
  u8g2.setFontRefHeightExtendedText();
  u8g2.setDrawColor(1);
  u8g2.setFontPosTop();
  u8g2.setFontDirection(0);

  // Initialize waveData to flat line
  for(int i=0; i<SCREEN_WIDTH; i++) {
    waveData[i] = 0; // Represents zero amplitude
  }
  
  // Show startup message
  sendConnectionAttempt();
  updateDisplay(); // Initial display after setup
  forceDisplayUpdateTime = millis();
}

// --- Main Loop ---
void loop() {
  handleSerialInput();
  handleButtons();          
  updateConnectionStatus(); 

  // Clear temporary message if it's time
  if (tempMessage[0] != '\0' && millis() - tempMessageTime > TEMP_MESSAGE_DURATION) {
    tempMessage[0] = '\0'; 
    displayRefreshNeeded = true;
  }
  
  // Handle effect animation
  if (effectActive) {
    if (millis() - lastAnimationTime > 100) { 
        lastAnimationTime = millis();
        animationFrame = (animationFrame + 1) % 4;
        digitalWrite(ledPins[4], animationFrame % 2 == 0 ? HIGH : LOW);
        if (millis() - effectStartTime > effectDuration) {
          effectActive = false;
          digitalWrite(ledPins[4], LOW); 
        }
        displayRefreshNeeded = true; 
    }
  } 
  
  // Refresh display conditions:
  // 1. If new wave data is available
  // 2. If VU level is active and time since last update exceeds interval
  // 3. If VU level has gone to zero but display hasn't been updated
  // 4. Force refresh at least every 250ms to ensure continuous updates
  if (newWaveDataAvailable || 
      (vuLevel > 0 && (millis() - lastWaveformUpdate > VU_UPDATE_INTERVAL)) || 
      (vuLevel == 0 && lastVuLevelSentToDisplay != 0) ||
      (millis() - forceDisplayUpdateTime > 250)) {
    displayRefreshNeeded = true;
    forceDisplayUpdateTime = millis();
  }

  if (displayRefreshNeeded) {
    updateDisplay();
    displayRefreshNeeded = false;
    lastWaveformUpdate = millis(); 
    if (vuLevel == 0) lastVuLevelSentToDisplay = 0;
    else lastVuLevelSentToDisplay = vuLevel;
    newWaveDataAvailable = false; // Reset flag after updating display
  }

  if (millis() - lastHeartbeat > HEARTBEAT_INTERVAL) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }
  delay(5); 
}

// --- Serial Data Handling ---
void handleSerialInput() {
  if (Serial.available() > 0) {
    String incomingString = Serial.readStringUntil('\n');
    incomingString.trim(); 

    if (incomingString.length() > 0 && incomingString.length() < sizeof(serialBuffer)) {
      incomingString.toCharArray(serialBuffer, sizeof(serialBuffer));
      webAppConnected = true;
      lastPacketReceived = millis();
      
      JSONVar jsonObj = JSON.parse(serialBuffer);
      if (JSON.typeof(jsonObj) == "undefined") return;
      
      bool lcdTextChanged = false;
      if (jsonObj.hasOwnProperty("lcd_l1")) {
        String line1 = (const char*)jsonObj["lcd_l1"];
        if (strcmp(lcdLine1, line1.c_str()) != 0) {
        line1.toCharArray(lcdLine1, sizeof(lcdLine1));
            lcdTextChanged = true;
        }
      }
      if (jsonObj.hasOwnProperty("lcd_l2")) {
        String line2 = (const char*)jsonObj["lcd_l2"];
         if (strcmp(lcdLine2, line2.c_str()) != 0) {
        line2.toCharArray(lcdLine2, sizeof(lcdLine2));
            lcdTextChanged = true;
        }
      }
      if (lcdTextChanged) displayRefreshNeeded = true;

      if (jsonObj.hasOwnProperty("leds")) {
        bool ledsActuallyChanged = false;
        for (int i = 0; i < 4; i++) { 
          if (i < jsonObj["leds"].length()) {
            bool webLedSelectedState = ((int)jsonObj["leds"][i] == 1);
            if (instrumentSelected[i] != webLedSelectedState) {
                instrumentSelected[i] = webLedSelectedState;
                ledsActuallyChanged = true;
                // Immediately update the LED to match the new state
                digitalWrite(ledPins[i], instrumentSelected[i] ? HIGH : LOW);
            }
          }
        }
        if (jsonObj["leds"].length() > 4 && !effectActive) { 
            bool statusLedState = ((int)jsonObj["leds"][4] == 1);
            digitalWrite(ledPins[4], statusLedState ? HIGH : LOW); 
            }
        if (ledsActuallyChanged) displayRefreshNeeded = true;
      }

      if (jsonObj.hasOwnProperty("vu")) {
        int newVu = constrain((int)jsonObj["vu"], 0, 100);
        if (newVu != vuLevel) {
            vuLevel = newVu;
            displayRefreshNeeded = true; 
        }
      }

      if (jsonObj.hasOwnProperty("wave")) {
        JSONVar waveArr = jsonObj["wave"];
        if (JSON.typeof(waveArr) == "array") {
          int len = waveArr.length();
          bool waveActuallyChanged = false;
          for (int i = 0; i < SCREEN_WIDTH; i++) {
            byte newPoint = 0; // Default to flat line center
            if (i < len) {
                newPoint = constrain((int)waveArr[i], 0, 15); 
      }
            if (waveData[i] != newPoint) {
                waveData[i] = newPoint;
                waveActuallyChanged = true;
            }
          }
          if (waveActuallyChanged) {
            newWaveDataAvailable = true;
            displayRefreshNeeded = true;
          }
        }
      }
      
      if (jsonObj.hasOwnProperty("message")) {
        const char* msg = (const char*)jsonObj["message"];
        strncpy(tempMessage, msg, sizeof(tempMessage) - 1);
        tempMessage[sizeof(tempMessage) - 1] = '\0'; // Ensure null termination
        tempMessageTime = millis();
        displayRefreshNeeded = true;
      }
      
      if (jsonObj.hasOwnProperty("muted")) {
        bool newMuteState = (bool)jsonObj["muted"];
        if (newMuteState != isMuted) {
            isMuted = newMuteState;
            displayRefreshNeeded = true;
        }
      }
    }
  }
}

// --- Button Handling ---
void handleButtons() {
  unsigned long currentTime = millis();
  
  for (int i = 0; i < NUM_BUTTONS; i++) {
    // Read button state (inverted because of INPUT_PULLUP)
    int reading = !digitalRead(buttonPins[i]); // Active LOW with INPUT_PULLUP = HIGH when pressed
    
    // If button state changed, reset the debounce timer
    if (reading != lastButtonStates[i]) {
      lastDebounceTime[i] = currentTime;
    }
    
    // If debounce period has passed, update the stable state
    if ((currentTime - lastDebounceTime[i]) > DEBOUNCE_DELAY) {
      // If state has changed since the last stable reading
      if (reading != buttonStates[i]) {
        buttonStates[i] = reading;
        
        // Button press actions (when state changes to HIGH/pressed)
        if (buttonStates[i] == HIGH) {
          buttonPressStartTime[i] = currentTime;
          buttonLongPressHandled[i] = false;
          
          // Instrument selection buttons (0-3)
            if (i < 4) {
            toggleInstrument(i);
          } 
          // Sound effect button - short press
          else if (i == 4) {
            if (!effectActive) handleSoundEffect(false);
          } 
          // Mute button
          else if (i == 6) {
            handleMuteToggle();
          } 
          // Capture button
          else if (i == 7) {
            showTempMessage("Capturing...");
            sendCaptureCommand();
          }
        }
      }
      
      // Long press detection logic (for buttons that need it)
      if (buttonStates[i] == HIGH && !buttonLongPressHandled[i]) {
        // Clear All Button (long press)
        if (i == 5 && (currentTime - buttonPressStartTime[i] > LONG_PRESS_TIME)) {
          buttonLongPressHandled[i] = true;
          handleClearAll();
        } 
        // Sound Effect Button (long press)
        else if (i == 4 && (currentTime - buttonPressStartTime[i] > EFFECT_PRESS_TIME)) {
          buttonLongPressHandled[i] = true;
          if (!effectActive) handleSoundEffect(true);
        }
      }
    }
    
    lastButtonStates[i] = reading;
  }
}

// --- Connection Status Management ---
void updateConnectionStatus() {
  // Check if we've lost connection
  if (webAppConnected && millis() - lastPacketReceived > CONNECTION_TIMEOUT) {
    webAppConnected = false;
    // Update display to show disconnection
    strcpy(lcdLine1, "Disconnected");
    strcpy(lcdLine2, "Connect Web App");
    displayRefreshNeeded = true;
  }
            }
            
// --- Send Connection Attempt Message ---
void sendConnectionAttempt() {
  // Send a simple message to notify the web app we're trying to connect
  JSONVar message;
  message["status"] = "arduino_connect_attempt";
  message["version"] = "1.0";
  
  // Send as JSON string
  Serial.println(JSON.stringify(message));
}

// --- Send Heartbeat Message --- 
void sendHeartbeat() {
  JSONVar message;
  message["status"] = "arduino_heartbeat";
  message["uptime"] = millis() / 1000; // Uptime in seconds
  message["instruments"] = JSON.parse("[0,0,0,0]"); // Create array for instruments state
  
  // Add current instrument states to heartbeat for reconnection sync
  for (int i = 0; i < 4; i++) {
    message["instruments"][i] = instrumentSelected[i] ? 1 : 0;
  }
  
  // Send as JSON string
  Serial.println(JSON.stringify(message));
}

// --- Specific Button Actions ---

// Toggle instrument selection & send state
void toggleInstrument(int buttonIndex) {
  if (buttonIndex < 0 || buttonIndex >= 4) return;

  // 1. Toggle local state
  instrumentSelected[buttonIndex] = !instrumentSelected[buttonIndex];
  
  // 2. Update LED immediately for instant feedback
  digitalWrite(ledPins[buttonIndex], instrumentSelected[buttonIndex] ? HIGH : LOW);
  
  // 3. Prepare message for web app
  JSONVar message;
  message["action"] = "instrument_toggle";
  message["instrument_index"] = buttonIndex;
  message["selected"] = instrumentSelected[buttonIndex];
  
  // 4. Send to web app
  Serial.println(JSON.stringify(message));
  
  // 5. Show temporary message on LCD
  char msg[21];
  sprintf(msg, "%s %s", getInstrumentName(buttonIndex), instrumentSelected[buttonIndex] ? "ON" : "OFF");
  showTempMessage(msg);
}

// Send capture command
void sendCaptureCommand() {
  JSONVar message;
  message["btn"] = 7; // Capture button
  message["action"] = "capture";
  
  // Light up all LEDs during capture
  for (int i = 0; i < NUM_LEDS; i++) {
    digitalWrite(ledPins[i], HIGH);
  }
  
  // Animate LEDs in sequence for visual feedback
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < NUM_LEDS; i++) {
      digitalWrite(ledPins[i], HIGH);
      delay(50);
      digitalWrite(ledPins[i], LOW);
    }
  }
  
  // Restore instrument LEDs to their correct states
  for (int i = 0; i < 4; i++) {
    digitalWrite(ledPins[i], instrumentSelected[i] ? HIGH : LOW);
  }
  
  Serial.println(JSON.stringify(message));
}

// Handle clear all sections
void handleClearAll() {
  // Flash all LEDs in warning pattern
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < NUM_LEDS; i++) {
      digitalWrite(ledPins[i], HIGH);
    }
    delay(200);
    for (int i = 0; i < NUM_LEDS; i++) {
      digitalWrite(ledPins[i], LOW);
    }
    delay(200);
  }
  
  // Restore instrument LEDs to their correct states
  for (int i = 0; i < 4; i++) {
    digitalWrite(ledPins[i], instrumentSelected[i] ? HIGH : LOW);
  }
  
  // Send clear command
  JSONVar message;
  message["btn"] = 5;
  message["action"] = "clear_all";
  Serial.println(JSON.stringify(message));
  
  showTempMessage("CLEARING ALL!");
}

// Handle mute toggle
void handleMuteToggle() {
  isMuted = !isMuted;
  
  JSONVar message;
  message["btn"] = 6;
  message["action"] = "mute";
  message["muted"] = isMuted;
  Serial.println(JSON.stringify(message));
  
  showTempMessage(isMuted ? "MUTED" : "UNMUTED");
}

// Handle sound effect
void handleSoundEffect(bool isLongPress) {
  effectActive = true;
  effectStartTime = millis();
  effectDuration = isLongPress ? 2000 : 500; // Longer effect for long press
  
  // Send effect command
  JSONVar message;
  message["btn"] = 4;
  message["action"] = "sound_effect";
  message["type"] = isLongPress ? "transition" : "key";
  Serial.println(JSON.stringify(message));
  
  showTempMessage(isLongPress ? "TRANSITION EFFECT" : "KEY EFFECT");
}

// --- Helper Functions ---

// Test all LEDs at startup
void testLEDs() {
  // Light up LEDs in sequence
  for (int i = 0; i < NUM_LEDS; i++) {
    digitalWrite(ledPins[i], HIGH);
    delay(100);
  }
  
  // Then turn them all off
  for (int i = 0; i < NUM_LEDS; i++) {
    digitalWrite(ledPins[i], LOW);
    delay(50);
  }
}

// Show temporary message on LCD
void showTempMessage(const char* message) {
  strncpy(tempMessage, message, sizeof(tempMessage) - 1);
  tempMessage[sizeof(tempMessage) - 1] = '\0'; // Ensure null termination
  tempMessageTime = millis();
  displayRefreshNeeded = true;
}

// Get instrument name for display
const char* getInstrumentName(int index) {
  switch (index) {
    case 0: return "DRUMS";
    case 1: return "BASS";
    case 2: return "GUITAR";
    case 3: return "KEYS/SYNTH";
    default: return "UNKNOWN";
  }
}

// --- Display Update ---
void updateDisplay() {
  u8g2.clearBuffer();
  
  // Status bar (top 1/4)
  u8g2.drawStr(0, 0, lcdLine1);
  
  // Draw mute indicator if muted
  if (isMuted) {
    u8g2.drawStr(SCREEN_WIDTH - 30, 0, "MUTE");
  }
  
  // Show temp message or normal line 2
  if (tempMessage[0] != '\0') {
    u8g2.drawStr(0, 12, tempMessage);
  } else {
    u8g2.drawStr(0, 12, lcdLine2);
  }
  
  // Connection status indicator
  if (!webAppConnected) {
    // Draw connection status in corner when disconnected
    u8g2.drawStr(SCREEN_WIDTH - 20, 0, "DC");
  }
  
  // Draw instrument status indicators in the status area
  char instrStatus[5] = "    ";
  for (int i = 0; i < 4; i++) {
    instrStatus[i] = instrumentSelected[i] ? '1' : '0';
  }
  u8g2.drawStr(SCREEN_WIDTH - 30, 12, instrStatus);
  
  drawAudioVisualization(); // Draw waveform and VU meter

  u8g2.sendBuffer();
}

void drawAudioVisualization() {
  const int visYOffset = 16; // Start Y for visualization area (after 2 lines of 7px font + 1px space)
  const int visHeight = SCREEN_HEIGHT - visYOffset; 

  // Waveform uses roughly top 2/3 of visHeight
  const int waveDisplayHeight = visHeight * 2 / 3; // Approx 32px for 48px visHeight
  const int waveCenterY = visYOffset + waveDisplayHeight / 2;
  const int waveAmplitudeMax = waveDisplayHeight / 2; // Max deviation from center

  // Always draw something - either the actual waveform or at least a center line
  if (webAppConnected) {
    // Draw waveform data
    for (int x = 0; x < SCREEN_WIDTH; x++) {
      // Scale waveData (0-15) to display height
      int h = map(waveData[x], 0, 15, 0, waveAmplitudeMax);
      
      // Draw mirrored vertical lines (top half)
      if (h > 0) {
        u8g2.drawVLine(x, waveCenterY - h, h);
        // Draw bottom half (mirror)
        u8g2.drawVLine(x, waveCenterY + 1, h > 1 ? h - 1 : 0);
      }
    }
    
    // Add center line if no visible waveform (flat line)
    bool hasVisibleWaveform = false;
    for (int i = 0; i < SCREEN_WIDTH; i++) {
      if (waveData[i] > 0) {
        hasVisibleWaveform = true;
        break;
      }
    }
    
    if (!hasVisibleWaveform) {
      u8g2.drawLine(0, waveCenterY, SCREEN_WIDTH - 1, waveCenterY);
    }
  } else {
    // Draw center line when disconnected
    u8g2.drawLine(0, waveCenterY, SCREEN_WIDTH - 1, waveCenterY);
  }

  // VU Meter at the bottom 1/3 of visHeight
  const int vuBarY = visYOffset + waveDisplayHeight + 2; // Space after waveform
  const int vuBarHeight = visHeight - waveDisplayHeight - 4; // Remaining space, minus some padding
  
  if (vuBarHeight > 4) { // Ensure VU bar is drawable
    // Draw VU meter frame
    u8g2.drawFrame(0, vuBarY, SCREEN_WIDTH, vuBarHeight);
    
    // Fill VU meter based on level
    int vuBarWidth = map(vuLevel, 0, 100, 0, SCREEN_WIDTH - 4);
    if (vuBarWidth > 0) {
      u8g2.drawBox(2, vuBarY + 1, vuBarWidth, vuBarHeight - 2);
    }
  }
} 