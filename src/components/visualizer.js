/**
 * Audio Visualizer component
 * Provides real-time visualization of audio data
 */

/**
 * Create an audio visualizer
 * @param {Object} options - Visualizer options
 * @param {HTMLCanvasElement} options.canvas - Canvas element to draw on
 * @param {AnalyserNode} options.analyzer - Web Audio API analyzer node
 * @param {string} options.mode - Visualization mode (waveform, frequency, circle)
 * @param {Object} options.colors - Color configuration
 * @returns {Object} Visualizer instance with control methods
 */
export function createVisualizer(options) {
  const canvas = options.canvas;
  if (!canvas) {
    console.error('Canvas element is required for visualizer');
    return null;
  }
  
  const analyzer = options.analyzer;
  if (!analyzer) {
    console.error('Analyzer node is required for visualizer');
    return null;
  }
  
  // Get drawing context
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.error('Could not get canvas 2D context');
    return null;
  }
  
  // Default visualization mode
  const mode = options.mode || 'waveform';
  
  // Default colors
  const colors = options.colors || {
    background: 'rgba(0, 0, 0, 0.2)',
    primary: 'rgb(0, 160, 255)',
    secondary: 'rgb(255, 100, 200)',
    gradient: ['rgba(0, 160, 255, 1)', 'rgba(255, 100, 200, 0.6)']
  };
  
  
  // Buffers for analyzer data
  const bufferLength = analyzer.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  // Animation frame ID for cancellation
  let animationId = null;
  let isActive = false;
  
  // Resize canvas to match display size
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }
  
  // Call resize initially
  resizeCanvas();
  
  // Add resize event listener
  window.addEventListener('resize', resizeCanvas);
  
  /**
   * Draw waveform visualization
   */
  function drawWaveform() {
    // Get current analyzer data
    analyzer.getByteTimeDomainData(dataArray);
    
    // Clear canvas
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Set up line style
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.primary;
    
    // Begin drawing path
    ctx.beginPath();
    
    const sliceWidth = canvas.width / bufferLength;
    let x = 0;
    
    // Draw waveform
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = v * canvas.height / 2;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      
      x += sliceWidth;
    }
    
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
  }
  
  /**
   * Draw frequency bar visualization
   */
  function drawFrequency() {
    // Get current analyzer data
    analyzer.getByteFrequencyData(dataArray);
    
    // Clear canvas
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, colors.gradient[0]);
    gradient.addColorStop(1, colors.gradient[1]);
    
    // Draw bars
    const barWidth = (canvas.width / bufferLength) * 2.5;
    let x = 0;
    
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * canvas.height;
      
      ctx.fillStyle = gradient;
      ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
      
      x += barWidth + 1;
    }
  }
  
  /**
   * Draw circular visualization
   */
  function drawCircle() {
    // Get current analyzer data
    analyzer.getByteFrequencyData(dataArray);
    
    // Clear canvas
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Set circle center
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    // Create gradient
    const gradient = ctx.createRadialGradient(
      centerX, centerY, 50, 
      centerX, centerY, canvas.width / 2
    );
    gradient.addColorStop(0, colors.gradient[0]);
    gradient.addColorStop(1, colors.gradient[1]);
    
    // Draw outer circle
    const radius = Math.min(canvas.width, canvas.height) / 2.5;
    
    // Draw frequency data as circular bars
    const barCount = 180;
    const angleStep = (Math.PI * 2) / barCount;
    
    for (let i = 0; i < barCount; i++) {
      const dataIndex = Math.floor(i * bufferLength / barCount);
      const value = dataArray[dataIndex];
      
      const barHeight = (value / 255) * (radius * 0.7);
      const angle = i * angleStep;
      
      const x1 = centerX + Math.cos(angle) * radius;
      const y1 = centerY + Math.sin(angle) * radius;
      const x2 = centerX + Math.cos(angle) * (radius + barHeight);
      const y2 = centerY + Math.sin(angle) * (radius + barHeight);
      
      // Draw line for each frequency bin
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    
    // Draw inner circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  
  /**
   * Main draw function - chooses visualization based on mode
   */
  function draw() {
    if (!isActive) return;
    
    // Choose visualization mode
    switch (mode) {
      case 'waveform':
        drawWaveform();
        break;
      case 'frequency':
        drawFrequency();
        break;
      case 'circle':
        drawCircle();
        break;
      default:
        drawWaveform();
    }
    
    // Continue animation loop
    animationId = requestAnimationFrame(draw);
  }
  
  /**
   * Start the visualizer
   */
  function start() {
    isActive = true;
    
    // Cancel existing animation if needed
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    
    // Start animation loop
    animationId = requestAnimationFrame(draw);
  }
  
  /**
   * Stop the visualizer
   */
  function stop() {
    isActive = false;
    
    // Cancel animation
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  
  /**
   * Change visualization mode
   * @param {string} newMode - New visualization mode
   */
  function setMode(newMode) {
    if (['waveform', 'frequency', 'circle'].includes(newMode)) {
      options.mode = newMode;
    }
  }
  
  /**
   * Update visualizer colors
   * @param {Object} newColors - New color configuration
   */
  function setColors(newColors) {
    Object.assign(colors, newColors);
  }
  
  /**
   * Clean up resources
   */
  function destroy() {
    stop();
    window.removeEventListener('resize', resizeCanvas);
  }
  
  // Return public API
  return {
    start,
    stop,
    setMode,
    setColors,
    destroy
  };
}

/**
 * Create a static visualization from audio data
 * @param {HTMLCanvasElement} canvas - Canvas element to draw on
 * @param {Array} audioData - Array of audio data points
 * @param {Object} options - Visualization options
 * @returns {Object} Visualizer instance
 */
export function createStaticVisualizer(canvas, audioData, options = {}) {
  if (!canvas || !audioData) {
    console.error('Canvas and audio data are required for static visualizer');
    return null;
  }
  
  // Get drawing context
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.error('Could not get canvas 2D context');
    return null;
  }
  
  // Default colors
  const colors = options.colors || {
    background: 'rgba(0, 0, 0, 0.2)',
    line: 'rgb(0, 160, 255)',
    area: 'rgba(0, 160, 255, 0.5)'
  };
  
  // Resize canvas to match display size
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    draw(); // Redraw after resize
  }
  
  // Add resize event listener
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  
  /**
   * Draw the visualization
   */
  function draw() {
    // Clear canvas
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Nothing to draw if no data
    if (!audioData || audioData.length === 0) return;
    
    // Calculate dimensions
    const width = canvas.width;
    const height = canvas.height;
    const dataLength = audioData.length;
    const stepSize = width / dataLength;
    
    // Get min/max values for scaling
    const maxValue = Math.max(...audioData);
    const minValue = Math.min(...audioData);
    const valueRange = maxValue - minValue;
    const scaleFactor = valueRange > 0 ? height / valueRange : 1;
    
    // Draw area
    ctx.beginPath();
    ctx.moveTo(0, height);
    
    for (let i = 0; i < dataLength; i++) {
      const x = i * stepSize;
      const normalizedValue = (audioData[i] - minValue) / valueRange;
      const y = height - (normalizedValue * height * 0.8);
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    
    ctx.lineTo(width, height);
    ctx.closePath();
    
    // Fill area under line
    ctx.fillStyle = colors.area;
    ctx.fill();
    
    // Draw line
    ctx.beginPath();
    
    for (let i = 0; i < dataLength; i++) {
      const x = i * stepSize;
      const normalizedValue = (audioData[i] - minValue) / valueRange;
      const y = height - (normalizedValue * height * 0.8);
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  
  /**
   * Update the visualization with new data
   * @param {Array} newData - New audio data
   */
  function updateData(newData) {
    if (Array.isArray(newData)) {
      audioData = newData;
      draw();
    }
  }
  
  /**
   * Update colors
   * @param {Object} newColors - New colors
   */
  function setColors(newColors) {
    Object.assign(colors, newColors);
    draw();
  }
  
  /**
   * Clean up resources
   */
  function destroy() {
    window.removeEventListener('resize', resizeCanvas);
  }
  
  // Initial draw
  draw();
  
  // Return public API
  return {
    draw,
    updateData,
    setColors,
    destroy
  };
} 