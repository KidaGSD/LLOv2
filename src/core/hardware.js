/**
 * hardware.js - Web Serial interface for Arduino communication
 * 
 * A lightweight wrapper around the Web Serial API for communicating with Arduino hardware.
 * Based on the revealing module pattern for clean public API exposure.
 */

export const hw = (() => {
  // Private variables
  let port = null;
  let reader = null;
  let writer = null;
  let readableStreamClosed = null;
  let writableStreamClosed = null;
  let isConnected = false;
  let callbacks = {
    message: null,
    status: null
  };

  // Configuration
  const config = {
    baudRate: 115200,
    bufferSize: 255
  };

  /**
   * Connect to an Arduino device via Web Serial API
   */
  async function connect() {
    try {
      // Check if Web Serial API is available
      if (!navigator.serial) {
        throw new Error("Web Serial API not supported in this browser. Try Chrome or Edge.");
      }

      // Request port from user
      port = await navigator.serial.requestPort();
      
      // Open port with correct baud rate
      await port.open({ baudRate: config.baudRate });
      
      // Set up reader
      const textDecoder = new TextDecoderStream();
      readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
      reader = textDecoder.readable.getReader();
      
      // Set up writer
      const textEncoder = new TextEncoderStream();
      writableStreamClosed = textEncoder.readable.pipeTo(port.writable);
      writer = textEncoder.writable.getWriter();
      
      // Update state
      isConnected = true;
      
      // Notify about connection status
      updateStatus("Connected to Arduino");
      
      // Start reading from Arduino
      readLoop();
      
      return true;
    } catch (error) {
      updateStatus(`Connection failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Disconnect from Arduino device
   */
  async function disconnect() {
    if (!port) return;
    
    try {
      // Close reader
      if (reader) {
        await reader.cancel();
        await readableStreamClosed;
        reader = null;
      }
      
      // Close writer
      if (writer) {
        await writer.close();
        await writableStreamClosed;
        writer = null;
      }
      
      // Close port
      await port.close();
      port = null;
      
      // Update state
      isConnected = false;
      updateStatus("Disconnected from Arduino");
      
      return true;
    } catch (error) {
      updateStatus(`Disconnect error: ${error.message}`);
      return false;
    }
  }

  /**
   * Send data to the Arduino
   * @param {string|object} data - Data to send (string or object to be JSON-stringified)
   */
  async function send(data) {
    if (!isConnected || !writer) {
      return false;
    }
    
    try {
      // Convert object to JSON string if needed
      const message = typeof data === 'object' ? JSON.stringify(data) : data;
      
      // Add newline for Arduino readLine() function
      await writer.write(message + "\n");
      return true;
    } catch (error) {
      updateStatus(`Send error: ${error.message}`);
      return false;
    }
  }

  /**
   * Continuously read data from Arduino
   */
  async function readLoop() {
    while (port && port.readable && isConnected) {
      try {
        const { value, done } = await reader.read();
        if (done) break;
        
        // Process received data
        processMessage(value.trim());
      } catch (error) {
        updateStatus(`Read error: ${error.message}`);
        break;
      }
    }
  }

  /**
   * Process incoming messages from Arduino
   * @param {string} message - The received message
   */
  function processMessage(message) {
    try {
      // Try to parse as JSON
      const data = JSON.parse(message);
      
      // If we have a callback, call it with the parsed data
      if (callbacks.message) {
        callbacks.message(data);
      }
    } catch (e) {
      // Not JSON, treat as plain text
      if (callbacks.message) {
        callbacks.message({ text: message });
      }
    }
  }

  /**
   * Update connection status and notify
   * @param {string} status - Status message
   */
  function updateStatus(status) {
    if (callbacks.status) {
      callbacks.status(status);
    }
  }

  /**
   * Register a callback for incoming messages
   * @param {function} callback - Function to call with message data
   */
  function onMessage(callback) {
    callbacks.message = callback;
  }

  /**
   * Register a callback for status updates
   * @param {function} callback - Function to call with status message
   */
  function onStatus(callback) {
    callbacks.status = callback;
  }

  /**
   * Check if currently connected to Arduino
   * @returns {boolean} Connection status
   */
  function getConnectionStatus() {
    return isConnected;
  }

  // Public API
  return {
    connect,
    disconnect,
    send,
    onMessage,
    onStatus,
    getConnectionStatus
  };
})();
