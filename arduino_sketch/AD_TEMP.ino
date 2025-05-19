// Arduino Sketch for Section-Based Music Generator Interface

#include <Wire.h>         // Required for I2C communication (OLED)
#include <U8g2lib.h>      // For SSD1306 OLED display
#include <Arduino_JSON.h> // For parsing JSON data from frontend

// --- OLED Display Setup ---
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, /* reset=*/ U8X8_PIN_NONE);

// --- Pin Definitions (Based on User Image) ---
// Buttons are wired to connect to +5V when pressed (HIGH = pressed)
const int buttonPins[] = {24, 28, 32, 36, 40, 6, 7}; // Inst1/Bass, Inst2/Guitar, Inst3/Drums, Inst4/Keys, Action/Generate + Sound Effect (40), Clear All (6), Image Capture (7)
const int NUM_BUTTONS = sizeof(buttonPins) / sizeof(buttonPins[0]);
bool buttonStates[NUM_BUTTONS] = {false}; // Current button states (HIGH/LOW)
bool lastButtonStates[NUM_BUTTONS] = {false}; // Previous button states for detecting changes
unsigned long lastButtonDebounceTime[NUM_BUTTONS] = {0}; // Last time button state changed
const unsigned long DEBOUNCE_DELAY = 30; // 30 milliseconds - more responsive

// For long press detection
unsigned long buttonPressStartTime = 0;
const unsigned long LONG_PRESS_DURATION = 800; // 800ms for long press
bool buttonHeld = false;
int activeButton = -1;

// LEDs (OUTPUT)
const int ledPins[] = {26, 30, 34, 38, 42}; // LED for Inst1, Inst2, Inst3, Inst4, Action/Status
const int NUM_LEDS = sizeof(ledPins) / sizeof(ledPins[0]);

// Instrument selection state (0-3 are instruments, 4 is action button)
// true = selected, false = not selected
bool instrumentSelected[NUM_BUTTONS] = {false, false, false, false, false, false, false};
bool ledStateOverride[NUM_LEDS] = {false}; // Track when we need to override LED state from frontend

// --- Serial Communication ---
const unsigned long BAUD_RATE = 115200;
char serialBuffer[256]; // Buffer for incoming serial data

// --- LCD Display Content ---
char lcdLine1[21] = "Connecting..."; // Max 20 chars + null
char lcdLine2[21] = "Please wait";   // Max 20 chars + null

// --- VU Meter ---
int vuLevel = 0; // 0-100

// --- Popup Message System ---
bool showPopup = false;
char popupMessage[41] = ""; // Up to 40 chars
unsigned long popupStartTime = 0;
unsigned long popupDuration = 0;

// --- Button Names for Feedback ---
const char* buttonNames[] = {"Bass", "Guitar", "Drums", "Keys", "Generate", "Clear", "Capture"};

// --- State Tracking Improvements ---
unsigned long lastSelectionUpdateTime = 0;
const unsigned long MIN_UPDATE_INTERVAL = 50; // Min time between updates (ms)
bool pendingSelectionUpdate = false;
int lastActiveButton = -1;

// --- Setup ---
void setup() {
  // Initialize serial communication
  Serial.begin(BAUD_RATE);
  
  // Initialize Button Pins - using INPUT mode as specified in the comment above 
  // that buttons are wired to connect to +5V when pressed (HIGH = pressed)
  for (int i = 0; i < NUM_BUTTONS; i++) {
    pinMode(buttonPins[i], INPUT);
    buttonStates[i] = LOW;
    lastButtonStates[i] = LOW;
    lastButtonDebounceTime[i] = 0;
  }
  
  // Initialize LED Pins
  for (int i = 0; i < NUM_LEDS; i++) {
    pinMode(ledPins[i], OUTPUT);
    digitalWrite(ledPins[i], LOW); // Turn all LEDs off initially
    ledStateOverride[i] = false;
  }
  
  // Initialize instrument selected state
  for (int i = 0; i < NUM_BUTTONS; i++) {
    instrumentSelected[i] = false;
  }
  
  // Initialize OLED Display
  u8g2.begin();
  u8g2.setFont(u8g2_font_6x10_tf); // Choose a font
  u8g2.setFontRefHeightExtendedText();
  u8g2.setDrawColor(1);
  u8g2.setFontPosTop();
  u8g2.setFontDirection(0);
  
  // Set initial display text
  strcpy(lcdLine1, "Music Generator");
  strcpy(lcdLine2, "Connect in browser");
  
  // Flash all LEDs to indicate the sketch is ready
  flashAllLEDs();
  
  // Send initial message via serial
  Serial.println("{\"text\":\"Arduino Ready. Click Connect button in browser.\"}");
  
  // Send a helpful tip on startup
  showPopupMessage("Click 'Connect' in browser", 3000);
  
  // Initial update of the display
  updateDisplay();
}

void showPopupMessage(const char* message, unsigned long duration) {
  strcpy(popupMessage, message);
  popupDuration = duration;
  showPopup = true;
  popupStartTime = millis();
  updateDisplay(); // Force update display
}

// --- Main Loop ---
void loop() {
  handleSerialInput();
  handleButtonPresses();
  updateLEDs(); // Continuously update LEDs to ensure they reflect instrument state
  
  // Process any pending selection updates
  if (pendingSelectionUpdate && (millis() - lastSelectionUpdateTime >= MIN_UPDATE_INTERVAL)) {
    sendSelectionUpdate(lastActiveButton);
    pendingSelectionUpdate = false;
  }
  
  // Check if popup needs to be cleared
  if (showPopup && (millis() - popupStartTime > popupDuration)) {
    showPopup = false;
    updateDisplay(); // Refresh display to remove popup
  }
}

// --- Update LEDs based on current selection state ---
void updateLEDs() {
  // Update first 4 LEDs based on instrument selection
  for (int i = 0; i < 4; i++) {
    if (ledStateOverride[i]) {
      digitalWrite(ledPins[i], instrumentSelected[i] ? HIGH : LOW);
    }
  }
  
  // LED 5 is handled separately for action indication
  // Flash if we're in the midst of a long press detection
  if (activeButton == 4 && buttonHeld) {
    // Flash the action LED during long press
    digitalWrite(ledPins[4], (millis() / 100) % 2 ? HIGH : LOW);
  }
}

// --- Serial Data Handling ---
void handleSerialInput() {
  static bool firstConnectionReceived = false;
  
  if (Serial.available() > 0) {
    String incomingString = Serial.readStringUntil('\n');
    incomingString.trim(); // Remove any leading/trailing whitespace

    if (incomingString.length() > 0 && incomingString.length() < sizeof(serialBuffer)) {
      // Copy the string to our buffer
      incomingString.toCharArray(serialBuffer, sizeof(serialBuffer));
      
      // Parse the JSON
      JSONVar jsonObj = JSON.parse(serialBuffer);
      
      if (JSON.typeof(jsonObj) == "undefined") {
        // JSON parsing failed
        return;
      }

      // On first successful communication, clear the "Connecting..." message
      // This ensures we don't stay on the initialization screen
      if (!firstConnectionReceived) {
        firstConnectionReceived = true;
        // Only reset default text if not explicitly provided
        if (!jsonObj.hasOwnProperty("lcd_l1") && !jsonObj.hasOwnProperty("lcd_l2")) {
          strcpy(lcdLine1, "Ready");
          strcpy(lcdLine2, "Waiting for input");
          updateDisplay();
        }
      }

      // Extract data from JSON
      if (jsonObj.hasOwnProperty("lcd_l1")) {
        String line1 = (const char*)jsonObj["lcd_l1"];
        line1.toCharArray(lcdLine1, sizeof(lcdLine1));
      }
      
      if (jsonObj.hasOwnProperty("lcd_l2")) {
        String line2 = (const char*)jsonObj["lcd_l2"];
        line2.toCharArray(lcdLine2, sizeof(lcdLine2));
      }

      if (jsonObj.hasOwnProperty("leds")) {
        for (int i = 0; i < NUM_LEDS; i++) {
          if (i < jsonObj["leds"].length()) {
            int ledState = (int)jsonObj["leds"][i];
            
            // Only update instrument state if not in override mode
            if (i < 4 && !ledStateOverride[i]) {
              instrumentSelected[i] = (ledState == 1);
              digitalWrite(ledPins[i], ledState == 1 ? HIGH : LOW);
            }
            
            // Status LED (index 4) always controlled directly by frontend
            if (i == 4) {
              digitalWrite(ledPins[i], ledState == 1 ? HIGH : LOW);
            }
          }
        }
      }

      if (jsonObj.hasOwnProperty("vu")) {
        vuLevel = (int)jsonObj["vu"];
        // Constrain VU level just in case
        vuLevel = constrain(vuLevel, 0, 100);
      }

      // Handle popup messages
      if (jsonObj.hasOwnProperty("popup")) {
        if (jsonObj["popup"].hasOwnProperty("message")) {
          String message = (const char*)jsonObj["popup"]["message"];
          message.toCharArray(popupMessage, sizeof(popupMessage));
          
          // Set duration, default 2000ms if not specified
          popupDuration = 2000;
          if (jsonObj["popup"].hasOwnProperty("duration")) {
            popupDuration = (unsigned long)jsonObj["popup"]["duration"];
          }
          
          showPopup = true;
          popupStartTime = millis();
        }
      }
      
      updateDisplay(); // Update display with new data
    }
  }
}

// --- Button Handling ---
void handleButtonPresses() {
  const unsigned long now = millis();
  
  // Handle active button first (for long press detection)
  if (activeButton != -1) {
    int reading = digitalRead(buttonPins[activeButton]);
    
    if (reading == LOW) { // Button released
      unsigned long pressDuration = now - buttonPressStartTime;
      
      // Only handle release if button was held for minimum debounce time
      if (pressDuration >= DEBOUNCE_DELAY) {
        // Handle release based on which button and press duration
        if (activeButton == 4 && pressDuration >= LONG_PRESS_DURATION) {
          // Long press on Action/Generate button (Sound Effect)
          sprintf(popupMessage, "Playing effect");
          showPopup = true;
          popupStartTime = now;
          popupDuration = 1500;
          
          // Send special JSON with longPress flag
          Serial.print("{\"btn\":");
          Serial.print(activeButton);
          Serial.print(",\"longPress\":true}");
          Serial.println();
        }
        else if (pressDuration < LONG_PRESS_DURATION) {
          // For buttons that we don't need to send on press (already done)
          if (activeButton != 0 && activeButton != 1 && activeButton != 2 && activeButton != 3) {
            sendSelectionUpdate(activeButton);
          }
        }
      }
      
      // If we were tracking LED override for an instrument button, clear it
      if (activeButton >= 0 && activeButton <= 3) {
        // Clear override after a delay to ensure frontend has time to respond
        ledStateOverride[activeButton] = false;
      }
      
      // Reset all tracking state
      activeButton = -1;
      buttonHeld = false;
    }
    else if (activeButton == 4 && !buttonHeld && (now - buttonPressStartTime >= LONG_PRESS_DURATION)) {
      // Just reached long press threshold for Action/Generate button
      buttonHeld = true;
      
      // Provide visual feedback for long press detection
      digitalWrite(ledPins[4], HIGH);
      delay(100);
      digitalWrite(ledPins[4], LOW);
      delay(100);
      digitalWrite(ledPins[4], HIGH);
      
      // Show message on LCD
      sprintf(popupMessage, "Hold for effect...");
      showPopup = true;
      popupStartTime = now;
      popupDuration = 800;
      updateDisplay();
    }
  }
  
  // Check each button for new presses/releases
  for (int i = 0; i < NUM_BUTTONS; i++) {
    // Skip if we're already tracking a button
    if (activeButton != -1) continue;
    
    int reading = digitalRead(buttonPins[i]);
    
    // Check if reading has changed
    if (reading != lastButtonStates[i]) {
      lastButtonDebounceTime[i] = now;
      lastButtonStates[i] = reading;
    }
    
    // Check if button state is stable for debounce period
    if ((now - lastButtonDebounceTime[i]) > DEBOUNCE_DELAY) {
      // If state has changed since we last updated buttonStates[]
      if (reading != buttonStates[i]) {
        buttonStates[i] = reading;
        
        // If button is pressed (HIGH)
        if (buttonStates[i] == HIGH) {
          activeButton = i;
          buttonPressStartTime = now;
          buttonHeld = false;
          lastActiveButton = i;
          
          // Only toggle instrument state for instrument buttons (0-3)
          if (i < 4) {
            // Toggle instrument selection state immediately for responsive UI
            instrumentSelected[i] = !instrumentSelected[i];
            ledStateOverride[i] = true; // Override LED state until frontend acknowledges
            
            // Show popup immediately
            sprintf(popupMessage, "%s %s", buttonNames[i], instrumentSelected[i] ? "added" : "removed");
            showPopup = true;
            popupStartTime = now;
            popupDuration = 1000;
            
            // Schedule selection update to be sent
            pendingSelectionUpdate = true;
            lastSelectionUpdateTime = now;
          }
          // For Clear All and Image Capture, show immediate feedback
          else if (i == 5) {
            sprintf(popupMessage, "Clearing all sections");
            showPopup = true;
            popupStartTime = now;
            popupDuration = 1500;
            
            // Reset instrument states to match expected frontend state
            for (int j = 0; j < 4; j++) {
              instrumentSelected[j] = false;
              ledStateOverride[j] = false;
            }
          }
          else if (i == 6) {
            sprintf(popupMessage, "Capturing image...");
            showPopup = true;
            popupStartTime = now;
            popupDuration = 1500;
            
            // Blink the status LED
            digitalWrite(ledPins[4], HIGH);
            delay(100);
            digitalWrite(ledPins[4], LOW);
          }
          
          updateDisplay();
        }
      }
    }
  }
}

// Send a JSON message with the button that was pressed and all instrument selections
void sendSelectionUpdate(int buttonPressed) {
  if (buttonPressed < 0 || buttonPressed >= NUM_BUTTONS) return;
  
  // Track when we last sent an update
  lastSelectionUpdateTime = millis();
  
  // Create a JSON object with button and selection info
  Serial.print("{\"btn\":");
  Serial.print(buttonPressed);
  Serial.print(",\"selected\":[");
  
  // Include the state of all 4 instrument buttons
  for (int i = 0; i < 4; i++) {
    Serial.print(instrumentSelected[i] ? "1" : "0");
    if (i < 3) Serial.print(",");
  }
  Serial.print("]}");
  Serial.println();
}

// --- Display Update ---
void updateDisplay() {
  u8g2.clearBuffer();
  
  // If popup is active, show it
  if (showPopup && popupMessage[0] != '\0') {
    // Draw a filled rectangle as popup background with a border
    u8g2.drawFrame(4, 20, SCREEN_WIDTH - 8, 24);
    u8g2.drawBox(5, 21, SCREEN_WIDTH - 10, 22);
    
    // Draw popup text with inverted colors
    u8g2.setDrawColor(0);  // Text will be drawn as black (transparent)
    u8g2.setFont(u8g2_font_6x10_tf);
    
    // Center the text
    int textWidth = u8g2.getStrWidth(popupMessage);
    int x = (SCREEN_WIDTH - textWidth) / 2;
    u8g2.drawStr(x, 32, popupMessage);
    
    // Reset draw color to white
    u8g2.setDrawColor(1);
  } else {
    // Normal display content
    // Line 1
    u8g2.drawStr(0, 0, lcdLine1);
    // Line 2
    u8g2.drawStr(0, 12, lcdLine2); // Adjust Y position based on font
  }

  // VU Meter (simple horizontal bar example) - always visible
  int barWidth = map(vuLevel, 0, 100, 0, SCREEN_WIDTH - 4); // Map 0-100 to bar width
  u8g2.drawFrame(0, SCREEN_HEIGHT - 12, SCREEN_WIDTH, 10); // VU Meter frame
  u8g2.drawBox(2, SCREEN_HEIGHT - 10, barWidth, 6);    // VU Meter filled bar

  u8g2.sendBuffer();
}

// Flash all LEDs in sequence to indicate the Arduino is ready
void flashAllLEDs() {
  // First, make sure all LEDs are off
  for (int i = 0; i < NUM_LEDS; i++) {
    digitalWrite(ledPins[i], LOW);
  }

  // Flash each LED in sequence
  for (int i = 0; i < NUM_LEDS; i++) {
    digitalWrite(ledPins[i], HIGH);
    delay(100);
    digitalWrite(ledPins[i], LOW);
  }
  
  // Then flash all LEDs together twice
  for (int j = 0; j < 2; j++) {
    // Turn all on
    for (int i = 0; i < NUM_LEDS; i++) {
      digitalWrite(ledPins[i], HIGH);
    }
    delay(100);
    
    // Turn all off
    for (int i = 0; i < NUM_LEDS; i++) {
      digitalWrite(ledPins[i], LOW);
    }
    delay(100);
  }
} 