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
    
    async def create_final_mix_async(self, preview_task_id):
        """
        Create final mix from preview mix task ID
        
        Args:
            preview_task_id: Task ID of a completed preview mix
        
        Returns:
            task_id: The final mix task ID
        """
        print(f"[TonnMixer] Creating final mix from preview task {preview_task_id}")
        
        # Check if preview mix exists in our cache
        preview_task = self.mix_tasks.get(preview_task_id)
        if not preview_task:
            # Try to get the task information from the Tonn API
            try:
                # Call get_mix_settings to get mix info including the preview_mix_url
                mix_settings_response = await self._make_async_post_request(
                    'https://tonn.roexaudio.com/getmixsettings',
                    headers={'X-API-Key': self.api_key},
                    json_payload={'multitrack_task_id': preview_task_id}
                )
                
                if mix_settings_response.status_code != 200:
                    raise Exception(f"[TonnMixer] Failed to get mix settings: {mix_settings_response.status_code} - {mix_settings_response.text}")
                
                mix_settings = mix_settings_response.json()
                preview_mix_url = mix_settings.get('download_url_preview_mixed')
                
                if not preview_mix_url:
                    raise Exception(f"[TonnMixer] No preview mix URL found for task {preview_task_id}")
                
                # Create a placeholder task entry
                preview_task = {
                    "status": "COMPLETED",
                    "mix_url": preview_mix_url,
                    "created_at": time.time(),
                    "type": "preview"
                }
                self.mix_tasks[preview_task_id] = preview_task
                print(f"[TonnMixer] Created placeholder task for {preview_task_id} with mix URL: {preview_mix_url}")
            except Exception as e:
                print(f"[TonnMixer] Error getting mix settings for preview task {preview_task_id}: {e}")
                raise
        elif preview_task["status"] != "COMPLETED":
            raise Exception(f"[TonnMixer] Preview mix task {preview_task_id} is not completed (status: {preview_task['status']})")
        
        # Get the preview mix URL
        preview_mix_url = preview_task.get("mix_url")
        if not preview_mix_url:
            preview_mix_url = preview_task.get("download_url_preview_mixed") or preview_task.get("download_url")
            
        if not preview_mix_url:
            raise Exception(f"[TonnMixer] No mix URL found for preview task {preview_task_id}")
        
        # Prepare the final mix payload
        payload = {
            "applyAudioEffectsData": {
                "multitrackTaskId": preview_task_id,
                "trackData": [
                    {
                        "trackURL": preview_mix_url,
                        "gainDb": 0.0  # Default to no gain adjustment
                    }
                ],
                "returnStems": False,
                "sampleRate": 44100,
                "webhookURL": self.webhook_url  # Same webhook for final mix notifications
            }
        }
        
        print(f"[TonnMixer] Sending final mix request to Tonn with payload: {json.dumps(payload, indent=2)}")
        response = await self._make_async_post_request(
            'https://tonn.roexaudio.com/applyaudioeffects',
            headers={'X-API-Key': self.api_key},
            json_payload=payload
        )
        
        print(f"[TonnMixer] Final mix response status: {response.status_code}, body: {response.text}")
        if response.status_code != 200:
            raise Exception(f"[TonnMixer] Failed to create final mix: {response.status_code} - {response.text}")
        
        result = response.json()
        task_id = result.get('multitrack_task_id')
        
        if not task_id:
            raise Exception("[TonnMixer] No multitrack_task_id returned from final mix request")
        
        # Store the task info
        self.mix_tasks[task_id] = {
            "status": "PENDING",
            "created_at": time.time(),
            "webhook_url": self.webhook_url,
            "mix_url": None,
            "preview_task_id": preview_task_id,
            "output_file": None,
            "type": "final"
        }
        
        print(f"[TonnMixer] Final mix task {task_id} initiated and stored as PENDING")
        return task_id
    
    async def create_final_mix_from_stitched_async(self, stitched_audio_path, musical_style="POP", use_webhook=True):
        """
        Create a final master from a stitched audio file using album mastering workflow
        
        Args:
            stitched_audio_path: Path to the stitched audio file on the server
            musical_style: The musical style to apply
            use_webhook: Whether to use webhooks or polling (set to False if webhooks are failing)
            
        Returns:
            task_id: The mastering task ID
        """
        if not os.path.exists(stitched_audio_path):
            raise FileNotFoundError(f"Stitched audio file not found: {stitched_audio_path}")
            
        print(f"[TonnMixer] Creating master from stitched audio: {stitched_audio_path}")
        
        # Upload the stitched audio to Tonn
        try:
            # Get the upload URL for the stitched file
            stitched_readable_url = await self.upload_track_async(stitched_audio_path)
            
            # Create an album mastering payload using the stitched audio
            # Based on album_mastering_payload.json example
            payload = {
                "masteringData": {
                    "trackData": [
                        {
                            "trackURL": stitched_readable_url
                        }
                    ],
                    "musicalStyle": musical_style.upper(),
                    "desiredLoudness": "MEDIUM", # Standard for streaming
                    "sampleRate": "44100"
                }
            }
            
            # Only include webhook if requested and available
            if use_webhook and self.webhook_url:
                payload["masteringData"]["webhookURL"] = self.webhook_url
            
            print(f"[TonnMixer] Sending mastering request to Tonn with payload: {json.dumps(payload, indent=2)}")
            
            # Try with exponential backoff for resilience
            max_retries = 3
            retry_delay = 1.0  # Start with 1 second
            
            for attempt in range(max_retries):
                try:
                    response = await self._make_async_post_request(
                        'https://tonn.roexaudio.com/masteringpreview',
                        headers={'X-API-Key': self.api_key},
                        json_payload=payload
                    )
                    
                    # Handle webhook rate limiting specifically
                    if response.status_code == 429 and use_webhook:
                        if attempt < max_retries - 1:
                            print(f"[TonnMixer] Webhook rate limited (429). Retrying without webhook. Attempt {attempt+1}/{max_retries}")
                            # Remove webhook for next attempt
                            if "webhookURL" in payload["masteringData"]:
                                del payload["masteringData"]["webhookURL"]
                            use_webhook = False
                            await asyncio.sleep(retry_delay)
                            retry_delay *= 2  # Exponential backoff
                            continue
                    
                    # For other errors or final attempt, process normally
                    print(f"[TonnMixer] Mastering response status: {response.status_code}, body: {response.text}")
                    
                    if response.status_code != 200:
                        # Get error details from response
                        error_message = "Unknown error"
                        try:
                            error_data = response.json()
                            error_message = error_data.get("message", "Unknown error")
                        except:
                            pass
                        
                        raise Exception(f"[TonnMixer] Failed to create mastering task: {response.status_code} - {response.text}")
                    
                    # Success case
                    result = response.json()
                    task_id = result.get('mastering_task_id')
                    
                    if not task_id:
                        raise Exception("[TonnMixer] No mastering_task_id returned from mastering request")
                    
                    # Store the task info
                    self.mix_tasks[task_id] = {
                        "status": "PENDING",
                        "created_at": time.time(),
                        "webhook_url": self.webhook_url if use_webhook else None,
                        "mix_url": None,
                        "stitched_audio_path": stitched_audio_path,
                        "output_file": None,
                        "type": "mastering",
                        "use_polling": not use_webhook  # Flag to use polling instead of webhooks
                    }
                    
                    print(f"[TonnMixer] Mastering task {task_id} initiated and stored as PENDING")
                    
                    # If we're not using webhooks, start a polling task for this mastering task
                    if not use_webhook:
                        print(f"[TonnMixer] Starting polling for mastering task {task_id} (no webhook)")
                        # Start a background task to poll
                        loop = asyncio.get_event_loop()
                        loop.create_task(self.poll_preview_master(task_id))
                    
                    return task_id
                    
                except Exception as request_error:
                    if attempt < max_retries - 1:
                        print(f"[TonnMixer] Request error on attempt {attempt+1}/{max_retries}: {request_error}. Retrying...")
                        await asyncio.sleep(retry_delay)
                        retry_delay *= 2  # Exponential backoff
                    else:
                        # Final attempt failed
                        raise
            
            # If we get here, all retries failed
            raise Exception("[TonnMixer] All mastering request attempts failed")
            
        except Exception as e:
            print(f"[TonnMixer] Error creating master from stitched audio: {e}")
            raise
    
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
        
        # Store webhook data for debugging and access by other components
        self._webhook_data = {}
        
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
                            # Store the webhook data for later inspection
                            self._webhook_data[request_uuid] = mix_result
                            
                            # Check for mix task ID
                            task_id_from_webhook = mix_result.get("multitrack_task_id")

                            # Also check for mastering task ID if mix task ID is not present
                            if not task_id_from_webhook:
                                task_id_from_webhook = mix_result.get("mastering_task_id")

                            if task_id_from_webhook and task_id_from_webhook in self.mix_tasks and self.mix_tasks[task_id_from_webhook]["status"] == "PENDING":
                                task_type = self.mix_tasks[task_id_from_webhook].get("type", "unknown")
                                
                                # Handle mix preview completion
                                if mix_result.get("state") == "MIX_TASK_PREVIEW_COMPLETED":
                                    print(f"[TonnMixer Webhook] Mix PREVIEW COMPLETED for task {task_id_from_webhook}")
                                    self.mix_tasks[task_id_from_webhook]["status"] = "COMPLETED"
                                    self.mix_tasks[task_id_from_webhook]["mix_url"] = mix_result.get("download_url_preview_mixed")
                                    self._processed_webhook_requests.add(request_uuid) # Mark as processed
                                
                                # Handle mix final completion
                                elif mix_result.get("state") == "MIX_TASK_FINAL_COMPLETED":
                                    print(f"[TonnMixer Webhook] Mix FINAL COMPLETED for task {task_id_from_webhook}")
                                    self.mix_tasks[task_id_from_webhook]["status"] = "COMPLETED"
                                    self.mix_tasks[task_id_from_webhook]["mix_url"] = mix_result.get("download_url_mixed")
                                    self.mix_tasks[task_id_from_webhook]["stems_urls"] = mix_result.get("stems", {})
                                    self._processed_webhook_requests.add(request_uuid)
                                
                                # Handle mastering preview completion
                                elif mix_result.get("state") == "MASTERING_TASK_PREVIEW_COMPLETED" or "PREVIEWMASTER" in mix_result.get("status", "").upper():
                                    print(f"[TonnMixer Webhook] Mastering PREVIEW COMPLETED for task {task_id_from_webhook}")
                                    self.mix_tasks[task_id_from_webhook]["status"] = "COMPLETED"
                                    self.mix_tasks[task_id_from_webhook]["mix_url"] = mix_result.get("download_url_mastered_preview")
                                    self._processed_webhook_requests.add(request_uuid)
                                
                                # Handle mastering final completion
                                elif mix_result.get("state") == "MASTERING_TASK_COMPLETED" or mix_result.get("state") == "MASTERING_TASK_FINAL_COMPLETED" or "FINALMASTER" in mix_result.get("status", "").upper():
                                    print(f"[TonnMixer Webhook] Mastering FINAL/COMPLETED for task {task_id_from_webhook}")
                                    self.mix_tasks[task_id_from_webhook]["status"] = "COMPLETED"
                                    
                                    # Be thorough in looking for the download URL
                                    download_url = None
                                    
                                    # Try all possible field names for the download URL
                                    possible_download_url_fields = [
                                        "download_url_mastered",
                                        "download_url_mastered_preview", 
                                        "download_url",
                                        "downloadUrlMastered",
                                        "audio_download_url"
                                    ]
                                    
                                    for field in possible_download_url_fields:
                                        if field in mix_result and mix_result[field]:
                                            download_url = mix_result[field]
                                            print(f"[TonnMixer Webhook] Found download URL in field: {field}")
                                            break
                                    
                                    # If still no URL, look in nested structures
                                    if not download_url and "results" in mix_result:
                                        results = mix_result["results"]
                                        if isinstance(results, dict):
                                            for field in possible_download_url_fields:
                                                if field in results and results[field]:
                                                    download_url = results[field]
                                                    print(f"[TonnMixer Webhook] Found download URL in results.{field}")
                                                    break
                                    
                                    # Store the found URL
                                    self.mix_tasks[task_id_from_webhook]["mix_url"] = download_url
                                    self._processed_webhook_requests.add(request_uuid)
                                    
                                    # Also print detailed information for debugging mastering issues
                                    print(f"[TonnMixer Webhook] Mastering complete details for task {task_id_from_webhook}:")
                                    print(f"  - download_url_mastered: {mix_result.get('download_url_mastered')}")
                                    print(f"  - download_url_mastered_preview: {mix_result.get('download_url_mastered_preview')}")
                                    print(f"  - download_url: {mix_result.get('download_url')}")
                                    print(f"  - state: {mix_result.get('state')}")
                                    print(f"  - creation_time: {mix_result.get('creation_time')}")
                                    print(f"  - completion_time: {mix_result.get('completion_time')}")
                                    
                                    # Log full webhook payload for debugging
                                    print(f"[TonnMixer Webhook] Full mastering completion payload:")
                                    print(json.dumps(mix_result, indent=2))
                                
                                # Handle error cases
                                elif "ERROR" in mix_result.get("state", "").upper() or "ERROR" in mix_result.get("status", "").upper():
                                    print(f"[TonnMixer Webhook] Task ERRORED for task {task_id_from_webhook}: {mix_result.get('error_message')}")
                                    self.mix_tasks[task_id_from_webhook]["status"] = "FAILED"
                                    self.mix_tasks[task_id_from_webhook]["error"] = mix_result.get('error_message') or mix_result.get('message')
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

    async def poll_preview_master(self, task_id, max_attempts=30, poll_interval=5):
        """
        Poll the /retrievepreviewmaster endpoint until the preview master is ready.
        Based on the batch_album_mastering.py example.

        Args:
            task_id (str): The ID from /masteringpreview that identifies the preview mastering task.
            max_attempts (int): The maximum number of times we'll poll before giving up.
            poll_interval (int): Seconds to wait between each polling attempt.

        Returns:
            dict or None: Dictionary of preview master results if ready, otherwise None.
        """
        # Construct the endpoint and request payload.
        retrieve_url = "https://tonn.roexaudio.com/retrievepreviewmaster"
        retrieve_payload = {
            "masteringData": {
                "masteringTaskId": task_id
            }
        }

        print(f"[TonnMixer] Polling for preview master with task ID: {task_id}")
        for attempt in range(max_attempts):
            # Attempt to call the /retrievepreviewmaster endpoint.
            try:
                response = await self._make_async_post_request(
                    retrieve_url,
                    headers={'X-API-Key': self.api_key},
                    json_payload=retrieve_payload
                )
            except Exception as e:
                print(f"[TonnMixer] Error during POST request to /retrievepreviewmaster: {e}")
                await asyncio.sleep(poll_interval)
                continue

            # If the API responds with 202, the task is still processing.
            if response.status_code == 202:
                try:
                    data = response.json()
                    current_status = data.get("status", "Processing")
                    print(f"[TonnMixer] Attempt {attempt + 1}/{max_attempts}: Task still processing (Status: {current_status}).")
                except Exception:
                    print(f"[TonnMixer] Attempt {attempt + 1}/{max_attempts}: Task still processing.")
                
                # Update task status in our cache
                if task_id in self.mix_tasks:
                    self.mix_tasks[task_id]["status"] = "PROCESSING"

            # If the API responds with 200, the preview master should be ready.
            elif response.status_code == 200:
                try:
                    data = response.json()
                    preview_results = data.get("previewMasterTaskResults")
                    # Check if the relevant key is present.
                    if preview_results:
                        print("[TonnMixer] Preview master is complete.")
                        
                        # Update task status and URL in our cache
                        if task_id in self.mix_tasks:
                            self.mix_tasks[task_id]["status"] = "COMPLETED"
                            self.mix_tasks[task_id]["mix_url"] = preview_results.get("download_url_mastered_preview")
                        
                        return preview_results
                    else:
                        print("[TonnMixer] Received 200 but missing 'previewMasterTaskResults' in the response.")
                except Exception as e:
                    print(f"[TonnMixer] Error parsing JSON response: {e}")
            else:
                # Handle unexpected status codes.
                print(f"[TonnMixer] Unexpected response code: {response.status_code}")
                print(f"[TonnMixer] Response: {response.text}")

            # Wait before next attempt if not yet ready.
            await asyncio.sleep(poll_interval)

        # If we reach here, the preview master didn't become ready in time.
        print("[TonnMixer] Preview master was not available after polling. Please try again later.")
        return None

    async def retrieve_final_master(self, task_id):
        """
        Calls the /retrievefinalmaster endpoint to retrieve the final master.
        Based on the batch_album_mastering.py example.

        Args:
            task_id (str): The mastering task ID returned from /masteringpreview.

        Returns:
            dict or None: The final master task results if ready, else None.
        """
        # Construct the request URL and payload.
        retrieve_url = "https://tonn.roexaudio.com/retrievefinalmaster"
        final_payload = {
            "masteringData": {
                "masteringTaskId": task_id
            }
        }

        print(f"[TonnMixer] Requesting final master for task ID: {task_id}")
        try:
            response = await self._make_async_post_request(
                retrieve_url,
                headers={'X-API-Key': self.api_key},
                json_payload=final_payload
            )
        except Exception as e:
            print(f"[TonnMixer] Error during POST request to /retrievefinalmaster: {e}")
            return None

        # Status code 200 means success in retrieving the final master.
        if response.status_code == 200:
            try:
                data = response.json()
                final_results = data.get("finalMasterTaskResults")
                
                # Update task status and URL in our cache
                if task_id in self.mix_tasks:
                    self.mix_tasks[task_id]["status"] = "COMPLETED"
                    self.mix_tasks[task_id]["mix_url"] = final_results.get("download_url_mastered")
                
                return final_results
            except Exception as e:
                print(f"[TonnMixer] Error parsing final master JSON response: {e}")
                return None
        else:
            # Any code other than 200 indicates some error or missing info.
            print(f"[TonnMixer] Failed to retrieve final master.")
            print(f"[TonnMixer] Status code: {response.status_code}")
            print(f"[TonnMixer] Response: {response.text}")
            return None


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
