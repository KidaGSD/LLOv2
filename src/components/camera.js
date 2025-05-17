// Create a new file: src/components/Camera.js
export class Camera {
    constructor(options = {}) {
      this.videoElement = options.videoElement || document.createElement('video');
      this.canvasElement = options.canvasElement || document.createElement('canvas');
      this.stream = null;
      this.isActive = false;
      
      // Set up canvas and video
      this.videoElement.autoplay = true;
      this.videoElement.muted = true;
      this.canvasElement.width = 640;
      this.canvasElement.height = 480;
      
      // Bind methods
      this.start = this.start.bind(this);
      this.stop = this.stop.bind(this);
      this.capture = this.capture.bind(this);
    }
    
    async start() {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
        
        this.videoElement.srcObject = this.stream;
        this.isActive = true;
        return true;
      } catch (error) {
        console.error('Error starting camera:', error);
        return false;
      }
    }
    
    stop() {
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.isActive = false;
      }
    }
    
    capture() {
      if (!this.isActive) return null;
      
      const context = this.canvasElement.getContext('2d');
      context.drawImage(
        this.videoElement, 
        0, 0, 
        this.canvasElement.width, 
        this.canvasElement.height
      );
      
      // Return the image as a data URL
      return this.canvasElement.toDataURL('image/jpeg', 0.8);
    }
  }