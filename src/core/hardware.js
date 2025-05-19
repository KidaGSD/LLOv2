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
  let connectionAttempts = 0;
  let reconnectTimer = null;
  let heartbeatChecker = null;
  let lastHeartbeatReceived = 0;
  let serialBuffer = ""; // Buffer for accumulating incoming serial data
  let lastPingSent = 0;
  let consecutiveNoResponsePings = 0; // Tracks consecutive ping failures
  let callbacks = {
    message: null,
    status: null
  };

  // Configuration
  const config = {
    baudRate: 115200,
    bufferSize: 512,
    reconnectDelay: 3000,
    heartbeatTimeout: 10000, // 10 seconds timeout for heartbeat
    pingInterval: 5000,      // 5 seconds between pings when no heartbeat
    maxConsecutivePingFailures: 3 // Disconnect after this many consecutive ping failures
  };

  /**
   * Connect to an Arduino device via Web Serial API
   * @param {Object} options - Connection options
   * @param {boolean} options.autoReconnect - Whether to automatically attempt reconnection
   */
  async function connect(options = { autoReconnect: true }) {
    try {
      // Check if Web Serial API is available
      if (!navigator.serial) {
        throw new Error("Web Serial API not supported in this browser. Try Chrome or Edge.");
      }

      // Clear any existing reconnect timer
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      // If we're already connected, disconnect first
      if (isConnected) {
        await disconnect();
      }

      // Reset connection state
      connectionAttempts = 0;
      consecutiveNoResponsePings = 0;

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
      lastHeartbeatReceived = Date.now();
      
      // Start heartbeat monitoring
      startHeartbeatMonitoring();
      
      // Notify about connection status
      updateStatus("Connected to Arduino");
      
      // Send initial ping to verify connection
      await send({ action: "ping", source: "web_app" });
      
      // Start reading from Arduino
      readLoop();
      
      return true;
    } catch (error) {
      updateStatus(`Connection failed: ${error.message}`);
      
      // Implement auto-reconnect if enabled
      if (options.autoReconnect && connectionAttempts < 3) {
        connectionAttempts++;
        updateStatus(`Reconnect attempt ${connectionAttempts} in ${config.reconnectDelay / 1000}s...`);
        
        reconnectTimer = setTimeout(() => {
          connect(options);
        }, config.reconnectDelay);
      }
      
      return false;
    }
  }

  /**
   * Monitor Arduino heartbeats to detect disconnection
   */
  function startHeartbeatMonitoring() {
    // Clear existing heartbeat checker if running
    if (heartbeatChecker) {
      clearInterval(heartbeatChecker);
    }
    
    // Initialize last heartbeat received time
    lastHeartbeatReceived = Date.now();
    lastPingSent = 0;
    consecutiveNoResponsePings = 0;
    
    // Check for heartbeats regularly
    heartbeatChecker = setInterval(() => {
      const now = Date.now();
      const timeSinceLastHeartbeat = now - lastHeartbeatReceived;
      
      // If no heartbeat for too long and we think we're connected, handle disconnect
      if (isConnected && timeSinceLastHeartbeat > config.heartbeatTimeout) {
        // If we haven't pinged recently, try sending a ping
        if (now - lastPingSent > config.pingInterval) {
          lastPingSent = now;
          console.log(`[Arduino] No heartbeat for ${(timeSinceLastHeartbeat/1000).toFixed(1)}s, sending ping...`);
          
          // Try to send a ping to check connection
          send({ action: "ping", source: "web_app" })
            .then(pingSuccess => {
              if (!pingSuccess) {
                consecutiveNoResponsePings++;
                console.warn(`[Arduino] Ping failed (${consecutiveNoResponsePings}/${config.maxConsecutivePingFailures})`);
                
                if (consecutiveNoResponsePings >= config.maxConsecutivePingFailures) {
                  console.warn(`[Arduino] Too many failed pings, connection appears lost`);
                  handleDisconnection(true);
                }
              } else {
                // Reset counter if ping succeeds
                consecutiveNoResponsePings = 0;
              }
            })
            .catch(() => {
              consecutiveNoResponsePings++;
              console.warn(`[Arduino] Ping error (${consecutiveNoResponsePings}/${config.maxConsecutivePingFailures})`);
              
              if (consecutiveNoResponsePings >= config.maxConsecutivePingFailures) {
                handleDisconnection(true);
              }
            });
        }
      }
    }, config.heartbeatTimeout / 4); // Check more frequently
  }

  function handleDisconnection(forceReconnect = false) {
    if (heartbeatChecker) clearInterval(heartbeatChecker);
    heartbeatChecker = null;
    if (isConnected) {
      isConnected = false;
      updateStatus("Arduino connection lost");
      if (forceReconnect) {
          console.log("[Arduino] Forcing reconnect attempt due to ping failure or timeout.")
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            // Try to auto-connect to previously paired device
            autoConnect().catch(() => {}); // Ignore errors in auto-connect
          }, config.reconnectDelay);
      }
    }
  }

  /**
   * Disconnect from Arduino device
   */
  async function disconnect() {
    if (!port) return;
    
    // Clear reconnect timer if active
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    
    if (heartbeatChecker) {
      clearInterval(heartbeatChecker);
      heartbeatChecker = null;
    }
    
    try {
      // Close reader
      if (reader) {
        await reader.cancel();
        await readableStreamClosed.catch(() => {});
        reader = null;
      }
      
      // Close writer
      if (writer) {
        await writer.close();
        await writableStreamClosed.catch(() => {});
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
      
      // Force reset of connection state
      isConnected = false;
      port = null;
      reader = null;
      writer = null;
      
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
      
      // If this was a ping, track it for heartbeat monitoring
      if (typeof data === 'object' && data.action === 'ping') {
        lastPingSent = Date.now();
      }
      
      return true;
    } catch (error) {
      updateStatus(`Send error: ${error.message}`);
      
      // Don't auto-reconnect here; let heartbeat monitor detect and handle it
      // to avoid connect/disconnect loops on transient send errors.
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
        if (done) {
            // Reader has been cancelled or stream closed
            if(isConnected) handleDisconnection(true); // If we thought we were connected, treat as disconnect
            break;
        }
        
        serialBuffer += value; // Append new data to buffer
        let newlineIndex;
        while ((newlineIndex = serialBuffer.indexOf('\n')) >= 0) {
          const line = serialBuffer.substring(0, newlineIndex).trim();
          serialBuffer = serialBuffer.substring(newlineIndex + 1);
          if (line) processMessage(line);
        }

      } catch (error) {
        updateStatus(`Read error: ${error.message}`);
        if (isConnected) handleDisconnection(true);
        break;
      }
    }
    // If loop exits and we thought we were connected, it's a disconnect
    if (isConnected) {
        handleDisconnection(true);
    }
  }

  /**
   * Process incoming messages from Arduino
   * @param {string} message - The received message
   */
  function processMessage(message) {
    if (!message || message.length === 0) return;
    
    try {
      // Try to parse as JSON
      const data = JSON.parse(message);
      
      // Handle special message types
      if (data.status === "arduino_heartbeat") {
        lastHeartbeatReceived = Date.now();
        consecutiveNoResponsePings = 0; // Reset failed ping counter on any successful communication
        // No need to forward heartbeats to application
        return;
      }
      
      // Handle ping responses
      if (data.action === "ping_response" || data.action === "pong") {
        lastHeartbeatReceived = Date.now();
        consecutiveNoResponsePings = 0; // Reset failed ping counter
        // No need to forward ping responses to application
        return;
      }
      
      if (data.status === "arduino_connect_attempt") {
        // Arduino is trying to connect, send initial state
        send({
          lcd_l1: "Web App Ready",
          lcd_l2: "Syncing...",
          leds: [0,0,0,0,0],
          vu: 0
        });
        
        // Update connection status
        updateStatus("Arduino (re)connected");
        lastHeartbeatReceived = Date.now(); // Treat connect attempt as a heartbeat
        consecutiveNoResponsePings = 0; // Reset failed ping counter
        if(!isConnected) isConnected = true; // Ensure isConnected is true
        return;
      }
      
      // Regular message - if we have a callback, call it with the parsed data
      if (callbacks.message) {
        // Any received message is a sign of life - update heartbeat time
        lastHeartbeatReceived = Date.now();
        consecutiveNoResponsePings = 0; // Reset failed ping counter
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

  /**
   * Auto-connect to the Arduino without user prompt
   * (only works if previously connected in the same browser session)
   */
  async function autoConnect() {
    try {
      // Check if Web Serial API is available
      if (!navigator.serial) {
        console.warn("Web Serial API not supported.");
        return false;
      }
      
      // Get list of previously connected ports
      const ports = await navigator.serial.getPorts();
      
      if (ports.length === 0) {
        console.log("No previously connected Arduino.");
        return false;
      }
      
      // Try to connect to the first available port
      port = ports[0];
      
      // Reset connection state
      connectionAttempts = 0;
      consecutiveNoResponsePings = 0;
      
      // Open port with correct baud rate
      await port.open({ baudRate: config.baudRate });
      
      // Set up reader and writer
      const textDecoder = new TextDecoderStream();
      readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
      reader = textDecoder.readable.getReader();
      
      const textEncoder = new TextEncoderStream();
      writableStreamClosed = textEncoder.readable.pipeTo(port.writable);
      writer = textEncoder.writable.getWriter();
      
      // Update state
      isConnected = true;
      lastHeartbeatReceived = Date.now();
      
      // Start heartbeat monitoring
      startHeartbeatMonitoring();
      
      // Notify about connection status
      updateStatus("Auto-connected to Arduino");
      
      // Send initial ping to verify connection
      await send({ action: "ping", source: "web_app_auto" });
      
      // Start reading from Arduino
      readLoop();
      
      return true;
    } catch (error) {
      console.warn("Auto-connect failed:", error.message);
      return false;
    }
  }

  // Public API
  return {
    connect,
    disconnect,
    send,
    onMessage,
    onStatus,
    getConnectionStatus,
    autoConnect
  };
})();

