import requests
import os
import time
import json

# Set your API key once here
API_KEY = 'AIzaSyCjKIjKIAew2pjsZcbzopLhw_57ii_rZR4'  

def get_upload_url(filename, content_type):
    response = requests.post(
        'https://tonn.roexaudio.com/upload',
        headers={'X-API-Key': API_KEY},
        json={
            'filename': filename,
            'contentType': content_type
        }
    )
    
    # Add better error handling
    if response.status_code != 200:
        print(f"Error getting upload URL: {response.status_code}")
        print(f"Response: {response.text}")
        return None
    
    result = response.json()
    # Validate the response contains the expected fields
    if 'signed_url' not in result or 'readable_url' not in result:
        print(f"Invalid API response: {result}")
        return None
        
    return result

def upload_file(signed_url, file_path, content_type):
    with open(file_path, 'rb') as f:
        response = requests.put(
            signed_url,
            data=f,
            headers={'Content-Type': content_type}
        )
    return response.status_code == 200

# Example usage
def upload_audio_file(file_path, content_type=None):
    filename = os.path.basename(file_path)
    
    # Auto-detect content type based on file extension if not specified
    if content_type is None:
        if file_path.lower().endswith('.mp3'):
            content_type = 'audio/mpeg'
        elif file_path.lower().endswith('.wav'):
            content_type = 'audio/wav'
        elif file_path.lower().endswith('.m4a'):
            content_type = 'audio/m4a'
        else:
            # Default to WAV if unknown
            content_type = 'audio/wav'
            print(f"Warning: Could not determine content type for {filename}, using {content_type}")
    
    print(f"Uploading with content type: {content_type}")
    result = get_upload_url(filename, content_type)
    
    if result is None:
        return None
        
    upload_url = result['signed_url']
    readable_url = result['readable_url']
    
    success = upload_file(upload_url, file_path, content_type)
    
    if success:
        print(f"Successfully uploaded {filename}")
        print(f"Readable URL: {readable_url}")
        return readable_url
    else:
        print(f"Failed to upload {filename}")
        return None

def create_preview_mix(track_urls, webhook_url, musical_style="POP"):
    """
    Create a preview mix with the uploaded tracks
    
    Args:
        track_urls: List of dicts containing track info (url, instrument group, etc)
        webhook_url: URL to receive notifications when the mix is ready
        musical_style: The musical style to apply (default: POP)
    
    Returns:
        multitrack_task_id: ID to track the mix progress
    """
    track_data = []
    
    # If track_urls is a simple list of URLs, convert to proper format
    if isinstance(track_urls[0], str):
        for url in track_urls:
            track_data.append({
                "trackURL": url,
                "instrumentGroup": "VOCAL_GROUP" if "vocal" in url.lower() else "INSTRUMENT_GROUP",
                "presenceSetting": "NORMAL",
                "panPreference": "CENTRE",
                "reverbPreference": "LOW"
            })
    else:
        track_data = track_urls
    
    # Inspect the track data
    print("\nTrack data being sent:")
    for i, track in enumerate(track_data):
        print(f"Track {i+1}:")
        for key, value in track.items():
            print(f"  {key}: {value} (type: {type(value).__name__})")
    
    payload = {
        "multitrackData": {
            "trackData": track_data,
            "musicalStyle": musical_style,
            "returnStems": False,
            "sampleRate": 44100,
            "webhookURL": webhook_url
        }
    }
    
    # Print the entire payload for debugging
    print("\nFull payload:")
    print(json.dumps(payload, indent=2))
    
    response = requests.post(
        'https://tonn.roexaudio.com/mixpreview',
        headers={'X-API-Key': API_KEY},
        json=payload
    )
    
    if response.status_code == 200:
        result = response.json()
        print("Preview mix requested successfully")
        print(f"Multitrack task ID: {result.get('multitrack_task_id')}")
        return result.get('multitrack_task_id')
    else:
        print(f"Failed to request preview mix: {response.status_code}")
        print(response.text)
        return None

def poll_mix_status(task_id, max_attempts=10, sleep_interval=5):
    """
    Poll for the status of a mix task
    
    Args:
        task_id: The multitrack task ID
        max_attempts: Maximum number of polling attempts
        sleep_interval: Seconds to wait between polling attempts
        
    Returns:
        The response data when the mix is complete, or None if timeout
    """
    print(f"\nPolling for mix status (task ID: {task_id})...")
    
    # Try different endpoint formats
    endpoints = [
        f'https://tonn.roexaudio.com/mixstatus/{task_id}',
        f'https://tonn.roexaudio.com/mixstatus?task_id={task_id}',
        f'https://tonn.roexaudio.com/mixstatus?multitrack_task_id={task_id}',
        f'https://tonn.roexaudio.com/status/{task_id}'
    ]
    
    for attempt in range(max_attempts):
        print(f"\nAttempt {attempt+1}/{max_attempts}")
        
        for endpoint in endpoints:
            print(f"Trying endpoint: {endpoint}")
            
            try:
                response = requests.get(
                    endpoint,
                    headers={'X-API-Key': API_KEY}
                )
                
                print(f"Status code: {response.status_code}")
                
                if response.status_code == 200:
                    result = response.json()
                    print(f"Success! Got response from {endpoint}")
                    return result
                
            except Exception as e:
                print(f"Error: {str(e)}")
        
        print(f"Waiting {sleep_interval} seconds before next attempt...")
        time.sleep(sleep_interval)
    
    print(f"\nTimeout after {max_attempts} attempts")
    print("Checking webhook for results instead...")
    
    # If polling fails, suggest checking the webhook
    print("\n⚠️ Polling failed, but your mix should still be available!")
    print("Check your webhook URL for the completed mix notification:")
    print(f"https://webhook.site/355d3e52-f465-411d-a460-2bdfb7b36cbc")
    
    return None

def download_mix(url, output_path):
    """
    Download a mix or stem file from the provided URL
    
    Args:
        url: URL of the file to download
        output_path: Where to save the downloaded file
    
    Returns:
        True if download successful, False otherwise
    """
    response = requests.get(url, stream=True)
    
    if response.status_code == 200:
        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        print(f"Downloaded to {output_path}")
        return True
    else:
        print(f"Failed to download from {url}: {response.status_code}")
        return False

def create_final_mix(task_id, track_adjustments=None):
    """
    Create the final mix with optional track level adjustments
    
    Args:
        task_id: The multitrack task ID from the preview
        track_adjustments: Dictionary mapping track URLs to gain adjustments in dB
    
    Returns:
        The response data
    """
    # Get the track data from the preview mix
    status_response = requests.get(
        f'https://tonn.roexaudio.com/mixstatus?multitrack_task_id={task_id}',
        headers={'X-API-Key': API_KEY}
    )
    
    if status_response.status_code != 200:
        print("Failed to get mix status for final mix creation")
        return None
    
    status_data = status_response.json()
    
    # Prepare the track data with adjustments
    track_data = []
    original_tracks = status_data.get('track_data', [])
    
    for track in original_tracks:
        track_url = track.get('track_url')
        gain_db = 0.0  # Default gain
        
        # Apply adjustment if specified
        if track_adjustments and track_url in track_adjustments:
            gain_db = track_adjustments[track_url]
        
        track_data.append({
            "trackURL": track_url,
            "gainDb": gain_db
        })
    
    payload = {
        "applyAudioEffectsData": {
            "multitrackTaskId": task_id,
            "trackData": track_data,
            "returnStems": True,
            "sampleRate": 44100
        }
    }
    
    response = requests.post(
        'https://tonn.roexaudio.com/mix',
        headers={'X-API-Key': API_KEY},
        json=payload
    )
    
    if response.status_code == 200:
        result = response.json()
        print("Final mix requested successfully")
        return result
    else:
        print(f"Failed to request final mix: {response.status_code}")
        print(response.text)
        return None

def main():
    # Step 1: Upload audio files
    vocal_url = upload_audio_file('/path/to/your/vocals.wav')
    drums_url = upload_audio_file('/path/to/your/drums.wav')
    bass_url = upload_audio_file('/path/to/your/bass.wav')
    
    if not all([vocal_url, drums_url, bass_url]):
        print("Failed to upload all files. Exiting.")
        return
    
    # Create track data with appropriate instrument groups
    track_data = [
        {
            "trackURL": vocal_url,
            "instrumentGroup": "VOCAL_GROUP",
            "presenceSetting": "LEAD",
            "panPreference": "CENTRE",
            "reverbPreference": "LOW"
        },
        {
            "trackURL": drums_url,
            "instrumentGroup": "DRUMS_GROUP",
            "presenceSetting": "NORMAL",
            "panPreference": "CENTRE",
            "reverbPreference": "NONE"
        },
        {
            "trackURL": bass_url,
            "instrumentGroup": "BASS_GROUP",
            "presenceSetting": "NORMAL",
            "panPreference": "CENTRE",
            "reverbPreference": "LOW"
        }
    ]
    
    # Step 2: Create preview mix
    webhook_url = "https://webhook.site/your-unique-url"
    task_id = create_preview_mix(track_data, webhook_url, musical_style="ROCK_INDIE")
    
    if not task_id:
        print("Failed to create preview mix. Exiting.")
        return
    
    # Step 3: Poll for mix status (alternative to webhook)
    mix_result = poll_mix_status(task_id)
    
    if not mix_result:
        print("Failed to get completed mix. Exiting.")
        return
    
    # Step 4: Download the preview mix
    mix_url = mix_result.get('mix_url')
    if mix_url:
        download_mix(mix_url, 'preview_mix.wav')
    
    # Download stems if available
    stems = mix_result.get('stems', [])
    for stem in stems:
        stem_url = stem.get('stem_url')
        stem_name = stem.get('stem_name', 'unknown_stem')
        if stem_url:
            download_mix(stem_url, f'preview_{stem_name}.wav')
    
    # After reviewing the preview mix, create the final mix with adjustments
    print("\nAfter reviewing the preview mix, press Enter to create the final mix...")
    input()
    
    # Step 5: Create final mix with adjustments
    # Example: Increase vocals by 2dB, decrease drums by 1dB
    adjustments = {
        vocal_url: 2.0,    # Increase vocals by 2dB
        drums_url: -1.0,   # Decrease drums by 1dB
        bass_url: 0.5      # Slight boost to bass
    }
    
    final_result = create_final_mix(task_id, adjustments)
    
    if not final_result:
        print("Failed to create final mix. Exiting.")
        return
    
    # Poll for final mix status
    final_task_id = final_result.get('multitrack_task_id')
    final_mix_result = poll_mix_status(final_task_id)
    
    if not final_mix_result:
        print("Failed to get completed final mix. Exiting.")
        return
    
    # Download the final mix
    final_mix_url = final_mix_result.get('mix_url')
    if final_mix_url:
        download_mix(final_mix_url, 'final_mix.wav')
    
    print("Tonn API testing complete!")


def simple_test():
    # Test 1: Upload a single audio file
    print("=== Simple Tonn API Test ===")
    
    # Path to a test audio file on your system (update this path)
    test_file = "audio/samples/drums_generated (3).mp3"  # Change this to a real audio file path
    
    if not os.path.exists(test_file):
        print(f"Error: Test file not found at {test_file}")
        return
    
    print(f"Uploading test file: {test_file}")
    readable_url = upload_audio_file(test_file)
    
    if readable_url:
        print("✅ Test successful!")
        print(f"File uploaded and available at: {readable_url}")
        print("You can use this URL in subsequent API calls")
    else:
        print("❌ Test failed. Check your API key and network connection.")

def multi_track_test():
    """
    Upload multiple audio files and create a simple mix.
    This is the next step after successfully uploading a single file.
    """
    print("\n=== Multi-Track Mixing Test ===")
    
    # Update these paths to point to your audio files
    tracks = [
        {"path": "audio/samples/drums_generated (3).mp3", "type": "DRUMS_GROUP"},
        {"path": "audio/samples/guitar_generated.mp3", "type": "GUITAR_GROUP"},
        # Add a third track if you have one (e.g., vocals)
        # {"path": "audio/samples/vocals.mp3", "type": "VOCAL_GROUP"},
    ]
    
    # Step 1: Upload all tracks
    print("Step 1: Uploading tracks...")
    track_urls = []
    
    for track in tracks:
        if not os.path.exists(track["path"]):
            print(f"Error: Track file not found at {track['path']}")
            continue
            
        readable_url = upload_audio_file(track["path"])
        if readable_url:
            # Make sure all values are of the correct type
            track_urls.append({
                "trackURL": readable_url,
                "instrumentGroup": track["type"],
                "presenceSetting": "NORMAL",
                "panPreference": "CENTRE",
                "reverbPreference": "LOW"
            })
    
    if len(track_urls) < len(tracks):
        print("⚠️ Warning: Not all tracks were uploaded successfully")
        if len(track_urls) == 0:
            print("❌ No tracks uploaded. Cannot proceed with mixing.")
            return
    
    # Step 2: Create a preview mix
    print("\nStep 2: Creating preview mix...")
    # Try with a proper verification service
    webhook_url = "https://webhook.site/your-unique-id"
    # Or even omit it to see if it's optional despite documentation
    # webhook_url = None
    
    # Updated to use a valid style from the enum list
    style = "ROCK_INDIE"  # Changed from "ROCK" to valid "ROCK_INDIE"
    
    task_id = create_preview_mix(track_urls, webhook_url, musical_style=style)
    
    if not task_id:
        print("❌ Failed to create preview mix. Exiting.")
        return
    
    # Step 3: Poll for mix status
    print("\nStep 3: Waiting for mix to complete...")
    mix_result = poll_mix_status(task_id)
    
    if not mix_result:
        print("❌ Failed to get completed mix. Exiting.")
        return
    
    # Step 4: Download the mix
    print("\nStep 4: Downloading the mix...")
    mix_url = mix_result.get('mix_url')
    if mix_url:
        download_mix(mix_url, 'tonn_preview_mix.wav')
        print("\n✅ Test complete! Preview mix downloaded to 'tonn_preview_mix.wav'")
        print("Next, you could create a final mix with adjustments to the track levels.")
    else:
        print("❌ No mix URL found in the result.")

def tonn_documentation_test():
    """
    Test the TONN API following the exact structure from documentation examples
    """
    print("\n=== TONN API Documentation Test ===")
    
    # Step 1: Upload audio files
    print("Step 1: Uploading tracks...")
    
    # Update these paths to point to your audio files
    tracks = [
        {"path": "audio/samples/drums_generated (3).mp3", "type": "DRUMS_GROUP", "presence": "NORMAL", "pan": "CENTRE", "reverb": "NONE"},
        {"path": "audio/samples/guitar_generated.mp3", "type": "GUITAR_GROUP", "presence": "NORMAL", "pan": "CENTRE", "reverb": "LOW"},
    ]
    
    track_urls = []
    for track in tracks:
        if not os.path.exists(track["path"]):
            print(f"Error: Track file not found at {track['path']}")
            continue
            
        readable_url = upload_audio_file(track["path"])
        if readable_url:
            track_urls.append({
                "trackURL": readable_url,
                "instrumentGroup": track["type"],
                "presenceSetting": track["presence"],
                "panPreference": track["pan"],
                "reverbPreference": track["reverb"]
            })
    
    if len(track_urls) < 2:
        print("❌ Need at least 2 tracks for a mix. Exiting.")
        return
    
    # Step 2: Create a preview mix
    print("\nStep 2: Creating preview mix...")
    
    # Use webhook.site to generate a test webhook URL
    # This will receive notifications when the mix is ready
    webhook_url = "https://webhook.site/355d3e52-f465-411d-a460-2bdfb7b36cbc"  # Replace with your webhook URL
    
    # Construct payload exactly as shown in documentation
    payload = {
        "multitrackData": {
            "trackData": track_urls,
            "musicalStyle": "ROCK_INDIE",
            "returnStems": False,  # Boolean false, not string "false"
            "sampleRate": 44100,
            "webhookURL": webhook_url
        }
    }
    
    # Print the payload for debugging
    print("\nPayload being sent:")
    print(json.dumps(payload, indent=2))
    
    # Send the request
    response = requests.post(
        'https://tonn.roexaudio.com/mixpreview',
        headers={'X-API-Key': API_KEY},
        json=payload
    )
    
    if response.status_code == 200:
        result = response.json()
        print("Preview mix requested successfully")
        task_id = result.get('multitrack_task_id')
        print(f"Multitrack task ID: {task_id}")
        
        # Step 3: Poll for mix status
        print("\nStep 3: Waiting for mix to complete...")
        mix_result = poll_mix_status(task_id)
        
        if mix_result:
            # Step 4: Download the mix
            print("\nStep 4: Downloading the mix...")
            mix_url = mix_result.get('mix_url')
            if mix_url:
                download_mix(mix_url, 'tonn_mix_from_docs.wav')
                print("\n✅ Test complete! Mix downloaded to 'tonn_mix_from_docs.wav'")
            else:
                print("❌ No mix URL found in the result.")
        else:
            print("❌ Failed to get completed mix. Exiting.")
    else:
        print(f"Failed to request preview mix: {response.status_code}")
        print(response.text)

def minimal_tonn_test():
    """
    Minimal test with the absolute basics to isolate the issue
    """
    print("\n=== Minimal TONN API Test ===")
    
    # Step 1: Upload audio files
    print("Step 1: Uploading tracks...")
    
    # Update paths and use CORRECT instrument group values from the error message
    tracks = [
        {"path": "audio/samples/drums_generated (4).wav", "type": "DRUMS_GROUP"},  # This is valid
        {"path": "audio/samples/guitar_generated.wav", "type": "ACOUSTIC_GUITAR_GROUP"},  # Changed from GUITAR_GROUP to E_GUITAR_GROUP
    ]
    
    track_urls = []
    for track in tracks:
        if not os.path.exists(track["path"]):
            print(f"Error: Track file not found at {track['path']}")
            continue
            
        readable_url = upload_audio_file(track["path"])
        if readable_url:
            track_urls.append({
                "trackURL": readable_url,
                "instrumentGroup": track["type"],  # Using the corresponding group
                "presenceSetting": "NORMAL",
                "panPreference": "CENTRE",
                "reverbPreference": "LOW"
            })
    
    # Required webhookURL field
    webhook_url = "https://webhook.site/355d3e52-f465-411d-a460-2bdfb7b36cbc"
    
    # Minimal complete payload with all required fields
    payload = {
        "multitrackData": {
            "trackData": track_urls,
            "musicalStyle": "ROCK_INDIE",
            "webhookURL": webhook_url
        }
    }
    
    print("\nMinimal payload:")
    print(json.dumps(payload, indent=2))
    
    response = requests.post(
        'https://tonn.roexaudio.com/mixpreview',
        headers={'X-API-Key': API_KEY},
        json=payload
    )
    
    print(f"Response status: {response.status_code}")
    print(f"Response body: {response.text}")
    
    if response.status_code == 200:
        result = response.json()
        print("Preview mix requested successfully")
        task_id = result.get('multitrack_task_id')
        print(f"Multitrack task ID: {task_id}")
        
        # Step 3: Poll for mix status
        print("\nStep 3: Waiting for mix to complete...")
        mix_result = poll_mix_status(task_id)
        
        if mix_result:
            # Step 4: Download the mix
            print("\nStep 4: Downloading the mix...")
            mix_url = mix_result.get('mix_url')
            if mix_url:
                download_mix(mix_url, 'tonn_minimal_mix.wav')
                print("\n✅ Test complete! Mix downloaded to 'tonn_minimal_mix.wav'")
            else:
                print("❌ No mix URL found in the result.")
        else:
            print("❌ Failed to get completed mix. Exiting.")

def webhook_based_test():
    """
    Test that relies on webhooks instead of polling
    """
    print("\n=== Webhook-Based TONN API Test ===")
    
    # Step 1: Upload audio files
    print("Step 1: Uploading tracks...")
    
    tracks = [
        {"path": "audio/samples/drums_generated (4).wav", "type": "DRUMS_GROUP"},
        {"path": "audio/samples/guitar_generated.wav", "type": "ACOUSTIC_GUITAR_GROUP"},
    ]
    
    track_urls = []
    for track in tracks:
        if not os.path.exists(track["path"]):
            print(f"Error: Track file not found at {track['path']}")
            continue
            
        readable_url = upload_audio_file(track["path"])
        if readable_url:
            track_urls.append({
                "trackURL": readable_url,
                "instrumentGroup": track["type"],
                "presenceSetting": "NORMAL",
                "panPreference": "CENTRE",
                "reverbPreference": "LOW"
            })
    
    # Generate a unique webhook URL for this test
    webhook_url = "https://webhook.site/355d3e52-f465-411d-a460-2bdfb7b36cbc"
    
    # Complete payload with all required fields
    payload = {
        "multitrackData": {
            "trackData": track_urls,
            "musicalStyle": "ROCK_INDIE",
            "webhookURL": webhook_url
        }
    }
    
    print("\nPayload:")
    print(json.dumps(payload, indent=2))
    
    response = requests.post(
        'https://tonn.roexaudio.com/mix',
        headers={'X-API-Key': API_KEY},
        json=payload
    )
    
    print(f"Response status: {response.status_code}")
    print(f"Response body: {response.text}")
    
    if response.status_code == 200:
        task_id = response.json().get('multitrack_task_id')
        print("\n✅ Mix request successful!")
        print(f"Multitrack task ID: {task_id}")
        print("\n⏳ TONN is now processing your mix...")
        print("When complete, a notification will be sent to your webhook:")
        print(webhook_url)
        print("\nCheck your webhook for the completed mix notification.")
        print("The notification will contain download URLs for the mix and stems.")
    else:
        print("\n❌ Mix request failed.")

if __name__ == "__main__":
     webhook_based_test()