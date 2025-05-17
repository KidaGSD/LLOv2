import os
import requests
import time
import json
import threading
from pathlib import Path

class TonnMixer:
    """
    A robust mixer class for the TONN API that handles:
    1. Track uploads
    2. Mix creation
    3. Automatic download of mixed tracks from webhooks
    """
    
    def __init__(self, api_key=None, webhook_url=None, output_dir="output"):
        """
        Initialize the TonnMixer
        
        Args:
            api_key: TONN API key (defaults to env var TONN_API_KEY)
            webhook_url: URL for webhooks (defaults to webhook.site URL that worked)
            output_dir: Directory to save output files
        """
        self.api_key = api_key or os.environ.get('TONN_API_KEY', 'AIzaSyCjKIjKIAew2pjsZcbzopLhw_57ii_rZR4')
        # Use the webhook URL that worked in testTonn.py
        self.webhook_url = webhook_url or "https://webhook.site/355d3e52-f465-411d-a460-2bdfb7b36cbc"
        self.output_dir = output_dir
        
        # Create output directory if it doesn't exist
        os.makedirs(self.output_dir, exist_ok=True)
        
        # Store mix tasks
        self.mix_tasks = {}
        
        # Webhook listener thread
        self.webhook_listener_active = False
        self.webhook_listener_thread = None
        
        print(f"TonnMixer initialized with API key: {self.api_key[:5]}...")
    
    def upload_track(self, file_path):
        """
        Upload a track to the TONN API
        
        Args:
            file_path: Path to the audio file
            
        Returns:
            readable_url: URL to use in other API calls
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Track file not found: {file_path}")
            
        # Determine content type based on file extension
        filename = os.path.basename(file_path)
        if file_path.lower().endswith('.mp3'):
            content_type = 'audio/mpeg'
        elif file_path.lower().endswith('.wav'):
            content_type = 'audio/wav'
        else:
            raise ValueError(f"Unsupported file type: {file_path}")
        
        print(f"Uploading {filename} with content type: {content_type}")
        
        # Step 1: Get upload URL
        response = requests.post(
            'https://tonn.roexaudio.com/upload',
            headers={'X-API-Key': self.api_key},
            json={
                'filename': filename,
                'contentType': content_type
            }
        )
        
        if response.status_code != 200:
            raise Exception(f"Failed to get upload URL: {response.status_code} - {response.text}")
        
        result = response.json()
        upload_url = result['signed_url']
        readable_url = result['readable_url']
        
        # Step 2: Upload the file
        with open(file_path, 'rb') as f:
            upload_response = requests.put(
                upload_url,
                data=f,
                headers={'Content-Type': content_type}
            )
        
        if upload_response.status_code != 200:
            raise Exception(f"Failed to upload file: {upload_response.status_code}")
        
        print(f"Successfully uploaded {filename}")
        return readable_url
    
    def create_mix(self, tracks, musical_style="ROCK_INDIE"):
        """
        Create a mix with the uploaded tracks
        
        Args:
            tracks: List of dicts with track info:
                   [{"path": "path/to/file.wav", "type": "DRUMS_GROUP"}]
            musical_style: The musical style to apply
            
        Returns:
            task_id: The mix task ID
        """
        # Upload tracks
        track_data = []
        for track in tracks:
            if not os.path.exists(track["path"]):
                raise FileNotFoundError(f"Track file not found: {track['path']}")
                
            readable_url = self.upload_track(track["path"])
            
            track_data.append({
                "trackURL": readable_url,
                "instrumentGroup": track["type"],
                "presenceSetting": "NORMAL",
                "panPreference": "CENTRE",
                "reverbPreference": "LOW"
            })
        
        # Create payload - simplified to match working testTonn.py
        payload = {
            "multitrackData": {
                "trackData": track_data,
                "musicalStyle": musical_style,
                "webhookURL": self.webhook_url
            }
        }
        
        print(f"Creating mix with {len(track_data)} tracks...")
        print(f"Webhook URL: {self.webhook_url}")
        print(f"Payload: {json.dumps(payload, indent=2)}")
        
        # Send mix request
        response = requests.post(
            'https://tonn.roexaudio.com/mixpreview',
            headers={'X-API-Key': self.api_key},
            json=payload
        )
        
        print(f"Response status: {response.status_code}")
        print(f"Response body: {response.text}")
        
        if response.status_code != 200:
            raise Exception(f"Failed to create mix: {response.status_code} - {response.text}")
        
        result = response.json()
        task_id = result.get('multitrack_task_id')
        
        if not task_id:
            raise Exception("No task ID returned from API")
        
        # Store task info
        self.mix_tasks[task_id] = {
            "status": "PENDING",
            "created_at": time.time(),
            "webhook_url": self.webhook_url,
            "mix_url": None,
            "stems_urls": {},
            "output_file": None
        }
        
        # Start webhook listener if not already running
        if not self.webhook_listener_active:
            self._start_webhook_listener()
        
        return task_id
    
    def _start_webhook_listener(self):
        """Start the webhook listener thread"""
        if self.webhook_listener_thread and self.webhook_listener_thread.is_alive():
            return
        
        self.webhook_listener_active = True
        self.webhook_listener_thread = threading.Thread(
            target=self._webhook_listener_loop,
            daemon=True
        )
        self.webhook_listener_thread.start()
    
    def _webhook_listener_loop(self):
        """Background thread to check webhook for mix completion"""
        print("Starting webhook listener...")
        
        # Extract token from webhook URL
        webhook_token = self.webhook_url.split('/')[-1]
        webhook_check_url = f"https://webhook.site/token/{webhook_token}/requests?sorting=newest"
        
        # Use timestamp instead of string date for comparison
        last_checked_time = time.time()
        
        while self.webhook_listener_active:
            # Get pending tasks
            pending_tasks = {
                task_id: task_info for task_id, task_info in self.mix_tasks.items()
                if task_info["status"] == "PENDING"
            }
            
            if not pending_tasks:
                # No pending tasks, sleep and check again
                time.sleep(5)
                continue
            
            try:
                # Check webhook.site for responses
                response = requests.get(webhook_check_url)
                
                if response.status_code != 200:
                    print(f"Failed to check webhook: {response.status_code}")
                    time.sleep(5)
                    continue
                
                webhook_data = response.json()
                
                if not webhook_data or not webhook_data.get("data"):
                    # No webhook data yet
                    time.sleep(5)
                    continue
                
                # Process all requests since last check
                current_time = time.time()
                for request in webhook_data["data"]:
                    # Skip if we've already processed this request
                    # Note: webhook.site uses string timestamps, not floats
                    # We'll use the request ID instead for tracking
                    request_id = request.get("uuid", "")
                    
                    # Store processed request IDs
                    if not hasattr(self, '_processed_requests'):
                        self._processed_requests = set()
                    
                    if request_id in self._processed_requests:
                        continue
                    
                    self._processed_requests.add(request_id)
                    
                    content = request.get("content")
                    if not content:
                        continue
                    
                    # Parse the JSON content
                    try:
                        mix_result = json.loads(content)
                        
                        # Check if this is a completed mix
                        if mix_result.get("state") == "MIX_TASK_PREVIEW_COMPLETED":
                            task_id = mix_result.get("multitrack_task_id")
                            
                            if task_id in self.mix_tasks:
                                print(f"Mix completed for task {task_id}")
                                
                                # Update task info
                                self.mix_tasks[task_id]["status"] = "COMPLETED"
                                self.mix_tasks[task_id]["mix_url"] = mix_result.get("download_url_preview_mixed")
                                self.mix_tasks[task_id]["stems_urls"] = mix_result.get("stems", {})
                                
                                # Download the mix
                                output_file = self._download_mix(task_id)
                                self.mix_tasks[task_id]["output_file"] = output_file
                                
                                print(f"Mix downloaded to {output_file}")
                    except json.JSONDecodeError:
                        print(f"Invalid JSON in webhook response")
                
                # Update last checked time
                last_checked_time = current_time
            except Exception as e:
                print(f"Error checking webhook: {str(e)}")
            
            # Sleep before next check
            time.sleep(5)
    
    def _download_mix(self, task_id):
        """Download the mix for a completed task"""
        task_info = self.mix_tasks.get(task_id)
        if not task_info or task_info["status"] != "COMPLETED":
            raise ValueError(f"No completed mix found for task {task_id}")
        
        mix_url = task_info["mix_url"]
        if not mix_url:
            raise ValueError(f"No mix URL found for task {task_id}")
        
        # Create a filename based on the task ID
        filename = f"tonn_mix_{task_id}.mp3"
        output_path = os.path.join(self.output_dir, filename)
        
        # Download the file
        response = requests.get(mix_url, stream=True)
        if response.status_code != 200:
            raise Exception(f"Failed to download mix: {response.status_code}")
        
        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        return output_path
    
    def get_mix_status(self, task_id):
        """Get the status of a mix task"""
        if task_id not in self.mix_tasks:
            return {"status": "UNKNOWN", "message": "Task not found"}
        
        task_info = self.mix_tasks[task_id]
        
        return {
            "status": task_info["status"],
            "created_at": task_info["created_at"],
            "mix_url": task_info.get("mix_url"),
            "output_file": task_info.get("output_file")
        }
    
    def wait_for_mix(self, task_id, timeout=300):
        """
        Wait for a mix to complete
        
        Args:
            task_id: The mix task ID
            timeout: Maximum time to wait in seconds
            
        Returns:
            output_file: Path to the downloaded mix file
        """
        if task_id not in self.mix_tasks:
            raise ValueError(f"Task {task_id} not found")
        
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            task_info = self.mix_tasks[task_id]
            
            if task_info["status"] == "COMPLETED":
                return task_info["output_file"]
            
            # Sleep before checking again
            time.sleep(5)
        
        raise TimeoutError(f"Mix did not complete within {timeout} seconds")
    
    def cleanup(self):
        """Clean up resources"""
        self.webhook_listener_active = False
        if self.webhook_listener_thread:
            self.webhook_listener_thread.join(timeout=1)
        print("TonnMixer cleaned up")


# Example usage
if __name__ == "__main__":
    mixer = TonnMixer()
    
    # Create a mix
    tracks = [
        {"path": "audio/songs/Last_Hour_Just_Piano_Version_.wav", "type": "KEYS_GROUP"},
        {"path": "audio/songs/The Amazing Digital Circus - Main Theme.wav", "type": "SYNTH_GROUP"}
    ]
    
    try:
        task_id = mixer.create_mix(tracks)
        print(f"Mix requested with task ID: {task_id}")
        
        # Wait for the mix to complete
        output_file = mixer.wait_for_mix(task_id)
        print(f"Mix completed and downloaded to: {output_file}")
    except Exception as e:
        print(f"Error creating mix: {str(e)}")
    finally:
        mixer.cleanup()
