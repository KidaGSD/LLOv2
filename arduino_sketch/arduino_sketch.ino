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
const int buttonPins[] = {22, 26, 30, 34, 38}; // Inst1, Inst2, Inst3, Inst4, Action
const int NUM_BUTTONS = sizeof(buttonPins) / sizeof(buttonPins[0]);
bool lastButtonStates[NUM_BUTTONS];
unsigned long lastButtonDebounceTime[NUM_BUTTONS];
const unsigned long DEBOUNCE_DELAY = 50; // 50 milliseconds

// LEDs (OUTPUT)
const int ledPins[] = {24, 28, 32, 36, 40}; // LED for Inst1, Inst2, Inst3, Inst4, Action/Status
const int NUM_LEDS = sizeof(ledPins) / sizeof(ledPins[0]);

// Instrument selection state (0-3 are instruments, 4 is action button)
// true = selected, false = not selected
bool instrumentSelected[NUM_BUTTONS] = {false, false, false, false, false};

// --- Serial Communication ---
const unsigned long BAUD_RATE = 115200;
char serialBuffer[256]; // Buffer for incoming serial data

// --- LCD Display Content ---
char lcdLine1[21] = "Connecting..."; // Max 20 chars + null
char lcdLine2[21] = "Please wait";   // Max 20 chars + null

// --- VU Meter ---
int vuLevel = 0; // 0-100

// --- Setup ---
void setup() {
  Serial.begin(BAUD_RATE);

  // Initialize Button Pins - using INPUT mode since buttons connect to +5V when pressed
  for (int i = 0; i < NUM_BUTTONS; i++) {
    pinMode(buttonPins[i], INPUT);
    lastButtonStates[i] = digitalRead(buttonPins[i]);
    lastButtonDebounceTime[i] = 0;
  }

  // Initialize LED Pins
  for (int i = 0; i < NUM_LEDS; i++) {
    pinMode(ledPins[i], OUTPUT);
    digitalWrite(ledPins[i], LOW); // Turn all LEDs off initially
  }

  // Initialize OLED Display
  u8g2.begin();
  u8g2.setFont(u8g2_font_6x10_tf); // Choose a font
  u8g2.setFontRefHeightExtendedText();
  u8g2.setDrawColor(1);
  u8g2.setFontPosTop();
  u8g2.setFontDirection(0);

  updateDisplay(); // Initial display
  Serial.println("Arduino Ready.");
}

// --- Main Loop ---
void loop() {
  handleSerialInput();
  handleButtonPresses();
  // The display is updated when new data arrives via serial or if needed for animations
}

// --- Serial Data Handling ---
void handleSerialInput() {
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
            digitalWrite(ledPins[i], ledState == 1 ? HIGH : LOW);
            
            // Update our local tracking of instrument selection (except action button)
            if (i < 4) {
              instrumentSelected[i] = (ledState == 1);
            }
          }
        }
      }

      if (jsonObj.hasOwnProperty("vu")) {
        vuLevel = (int)jsonObj["vu"];
        // Constrain VU level just in case
        vuLevel = constrain(vuLevel, 0, 100);
      }
      
      updateDisplay(); // Update display with new data
    }
  }
}

// --- Button Handling ---
void handleButtonPresses() {
  static int lastStableButtonStates[NUM_BUTTONS] = {LOW, LOW, LOW, LOW, LOW};
  static unsigned long lastDebounceTime[NUM_BUTTONS] = {0, 0, 0, 0, 0};
  const unsigned long DEBOUNCE_DELAY = 80; // Increased to 80ms for better stability
  
  for (int i = 0; i < NUM_BUTTONS; i++) {
    // Read current button state
    int reading = digitalRead(buttonPins[i]);
    
    // If the state has changed, reset the debounce timer
    if (reading != lastButtonStates[i]) {
      lastDebounceTime[i] = millis();
      lastButtonStates[i] = reading; // Update for next comparison
    }
    
    // Check if enough time has passed since the last change
    if ((millis() - lastDebounceTime[i]) > DEBOUNCE_DELAY) {
      // If the reading is stable and different from the last stable state
      if (reading != lastStableButtonStates[i]) {
        lastStableButtonStates[i] = reading; // Update the stable state
        
        // Only process button presses (HIGH), not releases
        if (reading == HIGH) {
          // To prevent hovering issues, add an extra check
          // Read the button again to confirm it's really HIGH
          delay(5);
          if (digitalRead(buttonPins[i]) == HIGH) {
            // Toggle LED state for instrument buttons (0-3)
            if (i < 4) {
              instrumentSelected[i] = !instrumentSelected[i]; // Toggle state
              digitalWrite(ledPins[i], instrumentSelected[i] ? HIGH : LOW); // Update LED
            }
            
            // Send updated information back to frontend
            sendSelectionUpdate(i);
          }
        }
      }
    }
  }
}

// Send a JSON message with the button that was pressed and all instrument selections
void sendSelectionUpdate(int buttonPressed) {
  // Create a JSON array of selected instruments (indices 0-3)
  String selectedArray = "[";
  for (int i = 0; i < 4; i++) {
    selectedArray += instrumentSelected[i] ? "1" : "0";
    if (i < 3) selectedArray += ",";
  }
  selectedArray += "]";
  
  // For the action button (button 4), we don't change its selection state
  // But we still report which button was pressed
  
  // Construct and send the full JSON message
  Serial.print("{\"btn\":");
  Serial.print(buttonPressed);
  Serial.print(",\"selected\":");
  Serial.print(selectedArray);
  Serial.println("}");
}

// --- Display Update ---
void updateDisplay() {
  u8g2.clearBuffer();
  
  // Line 1
  u8g2.drawStr(0, 0, lcdLine1);
  // Line 2
  u8g2.drawStr(0, 12, lcdLine2); // Adjust Y position based on font

  // VU Meter (simple horizontal bar example)
  int barWidth = map(vuLevel, 0, 100, 0, SCREEN_WIDTH - 4); // Map 0-100 to bar width
  u8g2.drawFrame(0, SCREEN_HEIGHT - 12, SCREEN_WIDTH, 10); // VU Meter frame
  u8g2.drawBox(2, SCREEN_HEIGHT - 10, barWidth, 6);    // VU Meter filled bar

  u8g2.sendBuffer();
} 