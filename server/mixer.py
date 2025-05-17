import os
import requests
import time
import json
import threading
import asyncio
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
            webhook_url: URL for webhooks (defaults to env var TONN_WEBHOOK_URL)
            output_dir: Directory to save output files
        """
        self.api_key = api_key or os.environ.get('TONN_API_KEY')
        self.webhook_url = webhook_url or os.environ.get('TONN_WEBHOOK_URL')
        
        if not self.api_key:
            print("CRITICAL ERROR: TonnMixer could not find TONN_API_KEY from constructor or environment.")
            # You might want to raise an exception here if the API key is absolutely essential for the class to function
            # raise ValueError("TONN_API_KEY is required for TonnMixer.")
        
        if not self.webhook_url:
            # It's critical for Tonn that a webhookURL is provided in the /mixpreview payload.
            # Using a generic webhook.site URL if nothing else is provided is a last resort for testing.
            self.webhook_url = "https://webhook.site/YOUR_OWN_UNIQUE_TEST_URL" # Fallback, but user should override
            print(f"WARNING: TONN_WEBHOOK_URL not set. Using generic fallback: {self.webhook_url}. Please configure a unique one.")

        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Store mix tasks
        self.mix_tasks = {}
        
        # Webhook listener thread
        self.webhook_listener_active = False
        self.webhook_listener_thread = None
        
        self._processed_webhook_requests = set()
        
        api_key_display = f"{self.api_key[:5]}..." if self.api_key else "NOT SET"
        print(f"TonnMixer initialized. API Key: {api_key_display} Webhook: {self.webhook_url}")
        # self._start_webhook_listener() # Start listener on init if desired
    
    async def _make_async_post_request(self, url, headers, json_payload):
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: requests.post(url, headers=headers, json=json_payload))

    async def _make_async_put_request(self, url, data, headers):
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: requests.put(url, data=data, headers=headers))
    
    async def upload_track_async(self, file_path):
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
        
        print(f"[TonnMixer] Getting upload URL for {filename}...")
        
        # Step 1: Get upload URL
        response = await self._make_async_post_request(
            'https://tonn.roexaudio.com/upload',
            headers={'X-API-Key': self.api_key},
            json_payload={'filename': filename, 'contentType': content_type}
        )
        
        if response.status_code != 200:
            raise Exception(f"[TonnMixer] Failed to get upload URL: {response.status_code} - {response.text}")
        
        result = response.json()
        upload_url = result['signed_url']
        readable_url = result['readable_url']
        
        print(f"[TonnMixer] Got upload URL for {filename}. Uploading...")
        
        # Step 2: Upload the file
        with open(file_path, 'rb') as f:
            file_content = f.read()

        upload_response = await self._make_async_put_request(
                upload_url,
            data=file_content,
                headers={'Content-Type': content_type}
            )
        
        if upload_response.status_code != 200:
            raise Exception(f"[TonnMixer] Failed to upload file {filename}: {upload_response.status_code} - {upload_response.text}")
        
        print(f"[TonnMixer] Successfully uploaded {filename}. Readable URL: {readable_url}")
        return readable_url
    
    async def create_preview_mix_async(self, tracks, musical_style="POP"):
        """
        Create a mix with the uploaded tracks
        
        Args:
            tracks: List of dicts with track info:
                   [{"path": "path/to/file.wav", "type": "DRUMS_GROUP"}]
            musical_style: The musical style to apply
            
        Returns:
            task_id: The mix task ID
        """
        print(f"[TonnMixer] Creating preview mix. Tracks: {len(tracks)}, Style: {musical_style}")
        track_data_for_tonn = []
        for track_info in tracks:
            local_path = track_info["path"]
            instrument_group = track_info["type"]
            try:
                readable_url = await self.upload_track_async(local_path)
                track_data_for_tonn.append({
                "trackURL": readable_url,
                    "instrumentGroup": instrument_group,
                "presenceSetting": "NORMAL",
                "panPreference": "CENTRE",
                "reverbPreference": "LOW"
            })
            except Exception as e:
                print(f"[TonnMixer] Failed to upload track {local_path}: {e}")
                raise

        if not track_data_for_tonn:
            raise Exception("[TonnMixer] No tracks were successfully uploaded for mixing.")

        payload = {
            "multitrackData": {
                "trackData": track_data_for_tonn,
                "musicalStyle": musical_style.upper(),
                "webhookURL": self.webhook_url
                # Temporarily omitting returnStems and sampleRate to test Tonn API sensitivity
                # "returnStems": False, 
                # "sampleRate": 44100 
            }
        }
        
        print(f"[TonnMixer] Sending /mixpreview request to Tonn. Payload: {json.dumps(payload, indent=2)}")
        response = await self._make_async_post_request(
            'https://tonn.roexaudio.com/mixpreview',
            headers={'X-API-Key': self.api_key},
            json_payload=payload
        )
        
        print(f"[TonnMixer] /mixpreview response status: {response.status_code}, body: {response.text}")
        if response.status_code != 200:
            raise Exception(f"[TonnMixer] Failed to create Tonn preview mix: {response.status_code} - {response.text}")
        
        result = response.json()
        task_id = result.get('multitrack_task_id')
        
        if not task_id:
            raise Exception("[TonnMixer] No multitrack_task_id returned from Tonn /mixpreview.")
        
        self.mix_tasks[task_id] = {
            "status": "PENDING",
            "created_at": time.time(),
            "webhook_url": self.webhook_url,
            "mix_url": None,
            "stems_urls": {},
            "output_file": None,
            "type": "preview"
        }
        print(f"[TonnMixer] Preview mix task {task_id} initiated and stored as PENDING.")
        
        return task_id
    
    def _start_webhook_listener(self):
        """Start the webhook listener thread"""
        if not self.webhook_listener_thread or not self.webhook_listener_thread.is_alive():
            self.webhook_listener_active = True
            self.webhook_listener_thread = threading.Thread(target=self._webhook_listener_loop, daemon=True)
            self.webhook_listener_thread.start()
            print("[TonnMixer] Webhook listener thread started.")
        else:
            print("[TonnMixer] Webhook listener thread already active.")
    
    def _webhook_listener_loop(self):
        """Background thread to check webhook for mix completion"""
        print("[TonnMixer] Webhook listener loop started...")
        
        # Extract token from webhook URL
        webhook_token = self.webhook_url.split('/')[-1]
        webhook_check_url = f"https://webhook.site/token/{webhook_token}/requests?sorting=newest"
        
        while self.webhook_listener_active:
            # Only check for tasks that are currently PENDING
            pending_task_ids = [tid for tid, tval in self.mix_tasks.items() if tval["status"] == "PENDING"]
            if not pending_task_ids:
                time.sleep(10) # Sleep longer if no pending tasks
                continue
            
            try:
                # print(f"[TonnMixer Webhook] Checking for updates for tasks: {pending_task_ids}")
                # Note: Using `requests` here in a thread. For true async, this should also be async.
                response = requests.get(webhook_check_url, timeout=10) 
                if response.status_code == 200:
                    webhook_data = response.json().get("data", [])
                    for request_item in webhook_data:
                        request_uuid = request_item.get("uuid")
                        if request_uuid in self._processed_webhook_requests:
                            continue # Skip already processed webhook events
                    
                        content_str = request_item.get("content")
                        if not content_str: continue
                    
                        try:
                            mix_result = json.loads(content_str)
                            task_id_from_webhook = mix_result.get("multitrack_task_id")

                            if task_id_from_webhook and task_id_from_webhook in self.mix_tasks and self.mix_tasks[task_id_from_webhook]["status"] == "PENDING":
                                if mix_result.get("state") == "MIX_TASK_PREVIEW_COMPLETED":
                                    print(f"[TonnMixer Webhook] Mix PREVIEW COMPLETED for task {task_id_from_webhook}")
                                    self.mix_tasks[task_id_from_webhook]["status"] = "COMPLETED"
                                    self.mix_tasks[task_id_from_webhook]["mix_url"] = mix_result.get("download_url_preview_mixed")
                                    self._processed_webhook_requests.add(request_uuid) # Mark as processed
                                elif mix_result.get("state") == "MIX_TASK_FINAL_COMPLETED":
                                    print(f"[TonnMixer Webhook] Mix FINAL COMPLETED for task {task_id_from_webhook}")
                                    self.mix_tasks[task_id_from_webhook]["status"] = "COMPLETED"
                                    self.mix_tasks[task_id_from_webhook]["mix_url"] = mix_result.get("download_url_mixed")
                                    self.mix_tasks[task_id_from_webhook]["stems_urls"] = mix_result.get("stems", {})
                                    self._processed_webhook_requests.add(request_uuid)
                                elif "ERROR" in mix_result.get("state", "").upper():
                                    print(f"[TonnMixer Webhook] Mix ERRORED for task {task_id_from_webhook}: {mix_result.get('error_message')}")
                                    self.mix_tasks[task_id_from_webhook]["status"] = "FAILED"
                                    self.mix_tasks[task_id_from_webhook]["error"] = mix_result.get('error_message')
                                    self._processed_webhook_requests.add(request_uuid)
                        except json.JSONDecodeError:
                            print(f"[TonnMixer Webhook] Invalid JSON in webhook content: {content_str[:100]}")
                        except Exception as e_inner:
                            print(f"[TonnMixer Webhook] Error processing webhook item: {e_inner}")
                else:
                    print(f"[TonnMixer Webhook] Failed to fetch from webhook.site: {response.status_code}")
            except requests.exceptions.RequestException as e_req:
                print(f"[TonnMixer Webhook] Request exception while polling webhook.site: {e_req}")
            except Exception as e_outer:
                print(f"[TonnMixer Webhook] Outer error in webhook listener loop: {e_outer}")
            
            time.sleep(10) # Polling interval for webhook.site
        print("[TonnMixer] Webhook listener loop stopped.")
    
    def _download_mix(self, task_id):
        """Download the mix for a completed task"""
        task_info = self.mix_tasks.get(task_id)
        if not task_info or task_info["status"] != "COMPLETED" or not task_info.get("mix_url"):
            print(f"[TonnMixer] Cannot download mix for task {task_id}: Not completed or no mix_url.")
            return None
        
        mix_url = task_info["mix_url"]
        file_extension = Path(mix_url).suffix or ".mp3" # Default to mp3 if no extension
        filename = f"tonn_mix_{task_id}{file_extension}"
        output_path = self.output_dir / filename
        
        print(f"[TonnMixer] Downloading mix for task {task_id} from {mix_url} to {output_path}...")
        try:
            # Using synchronous requests here as this method might be called from various contexts
            response = requests.get(mix_url, stream=True, timeout=60)
            response.raise_for_status() # Raise an exception for bad status codes
            with open(output_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            print(f"[TonnMixer] Mix for task {task_id} downloaded successfully to {output_path}.")
            self.mix_tasks[task_id]["output_file"] = str(output_path)
            return str(output_path)
        except requests.exceptions.RequestException as e:
            print(f"[TonnMixer] Failed to download mix for task {task_id}: {e}")
            self.mix_tasks[task_id]["status"] = "DOWNLOAD_FAILED"
            return None
    
    def get_mix_status(self, task_id):
        """Get the status of a mix task"""
        if task_id not in self.mix_tasks:
            return {"status": "UNKNOWN", "message": f"Task {task_id} not managed by this TonnMixer instance."}
        
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
        print("[TonnMixer] Attempting to cleanup webhook listener...")
        self.webhook_listener_active = False
        if self.webhook_listener_thread and self.webhook_listener_thread.is_alive():
            print("[TonnMixer] Waiting for webhook listener thread to join...")
            self.webhook_listener_thread.join(timeout=5) # Wait for thread to finish
            if self.webhook_listener_thread.is_alive():
                print("[TonnMixer] Webhook listener thread did not terminate in time.")
        print("[TonnMixer] Cleanup complete.")


# Example usage
if __name__ == "__main__":
    mixer = TonnMixer()
    
    # Create a mix
    tracks = [
        {"path": "audio/songs/Last_Hour_Just_Piano_Version_.wav", "type": "KEYS_GROUP"},
        {"path": "audio/songs/The Amazing Digital Circus - Main Theme.wav", "type": "SYNTH_GROUP"}
    ]
    
    try:
        task_id = mixer.create_preview_mix_async(tracks)
        print(f"Mix requested with task ID: {task_id}")
        
        # Wait for the mix to complete
        output_file = mixer.wait_for_mix(task_id)
        print(f"Mix completed and downloaded to: {output_file}")
    except Exception as e:
        print(f"Error creating mix: {str(e)}")
    finally:
        mixer.cleanup()
