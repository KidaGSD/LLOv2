from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Body, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
import uvicorn
import uuid
import os
import sys
import shutil
import json
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import time
import logging
import socket
import requests
from dotenv import load_dotenv

load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("server.log")
    ]
)
logger = logging.getLogger(__name__)

# Add tonn directory to path so we can import the modules
sys.path.append(os.path.abspath("."))

# Import the TonnMixer from the mixer module
try:
    from mixer import TonnMixer
    logger.info("TonnMixer imported successfully")
except ImportError as e:
    logger.error(f"Failed to import TonnMixer: {str(e)}")
    TonnMixer = None

# Import audio stitching utility
try:
    from audio_utils import stitch_audio_sections
    logger.info("Audio stitching utility imported successfully.")
except ImportError as e:
    logger.error(f"Failed to import stitch_audio_sections from audio_utils: {e}")
    stitch_audio_sections = None

# Create the FastAPI app
app = FastAPI(title="Section-based Music Generator Backend")

# Configure CORS to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "x-file-id", 
        "x-stability-bpm", 
        "x-stability-key", 
        "x-stability-duration", 
        "x-original-url",
        "content-disposition",
        "content-length",
        "content-type"
    ],  # Expose custom headers
)

# Configuration
TEMP_DIR = "temp"
SECTIONS_DIR = os.path.join(TEMP_DIR, "sections")
MIXES_DIR = os.path.join(TEMP_DIR, "mixes")
STEMS_DIR = os.path.join(TEMP_DIR, "stems")  # For backward compatibility

# Create temp directories if they don't exist
os.makedirs(SECTIONS_DIR, exist_ok=True)
os.makedirs(MIXES_DIR, exist_ok=True)
os.makedirs(STEMS_DIR, exist_ok=True)

# Store active mix tasks for status checking
active_tasks: Dict[str, Dict[str, Any]] = {}

# Pydantic models for request validation
class SectionDetailForMix(BaseModel):
    id: str
    instruments: List[str] # e.g., ['drums', 'keys_synth']
    # Add other per-section details Tonn might need, if any (e.g., specific presence from caption)

class PreviewMixRequest(BaseModel):
    sections: List[SectionDetailForMix] # Now expects a list of section details
    genre: str = "OTHER" # This is the overall session genre from the client
    # Add optional fields directly to the model
    stitchedAudioPath: Optional[str] = None
    skipPreview: Optional[bool] = False

class FinalMixRequest(BaseModel):
    previewTaskId: str

class StitchedSongRequest(BaseModel):
    section_ids: Optional[List[str]] = None # Made optional
    # List of original section IDs (e.g., section_type_timestamp_random)
    # The server will map these to actual file paths in SECTIONS_DIR
    # Assuming files are named like {section_id_from_upload_response}.wav in SECTIONS_DIR
    # OR, client could send full paths if server doesn't maintain a map from original client ID to server file ID.
    # For simplicity, let's assume client has the backend-generated IDs for sections already stored (e.g., UUIDs from /api/upload-sections)
    # and these are used to name files in SECTIONS_DIR.
    uploaded_section_details: List[Dict[str, str]] # List of dicts like {"id": "uuid_on_server", "path": "temp/sections/uuid_on_server.wav"}
    overlap_ms: int = 200 # Default overlap in milliseconds

# Routes import
# Will be uncommented once route files are implemented
# from routes.health import router as health_router
# from routes.uploads import router as uploads_router
# from routes.mixing import router as mixing_router

# app.include_router(health_router)
# app.include_router(uploads_router)
# app.include_router(mixing_router)

# Health check endpoint
@app.get("/health")
async def health_check():
    """Check if the server is running and if Tonn mixer is available"""
    tonn_status = "available" if TonnMixer is not None else "unavailable"
    key_status = "configured" if TONN_API_KEY and TONN_API_KEY != "YOUR_FALLBACK_TONN_API_KEY_HERE" else "NOT CONFIGURED"
    return {
        "status": "healthy",
        "timestamp": time.time(),
        "tonn_mixer_module": tonn_status,
        "tonn_api_key_status": key_status
    }

# For backward compatibility
@app.get("/test-tonn-import")
async def test_tonn_import():
    """Test if the Tonn mixer can be imported"""
    try:
        if TonnMixer is None:
            raise ImportError("TonnMixer could not be imported")
        return {"status": "success", "message": "Tonn mixer module imported successfully"}
    except Exception as e:
        return {"status": "error", "message": f"Failed to import Tonn mixer: {str(e)}"}

# Section upload endpoint
@app.post("/api/upload-sections")
async def upload_sections(
    sections: List[UploadFile] = File(...),
    instruments: str = Form(...)
):
    """Upload multiple section WAV files for mixing"""
    logger.info(f"Received /api/upload-sections request with {len(sections)} files.")
    try:
        # Parse the instruments JSON string
        instruments_list = json.loads(instruments)
        
        # Validate that we have the same number of instruments as sections
        if len(instruments_list) != len(sections):
            raise HTTPException(
                status_code=400, 
                detail=f"Number of instruments ({len(instruments_list)}) must match number of sections ({len(sections)})"
            )
        
        # Process and save each section
        section_info = []
        for i, section_file in enumerate(sections):
            # Generate a unique ID
            section_id = str(uuid.uuid4())
            
            # Determine file path
            file_path = os.path.join(SECTIONS_DIR, f"{section_id}.wav")
            
            # Save the file
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(section_file.file, buffer)
            
            # Get the instrument for this section
            instrument = instruments_list[i]
            
            # Add section info
            section_info.append({
                "id": section_id,
                "path": file_path,
                "filename": section_file.filename,
                "instrument": instrument,
                "size": os.path.getsize(file_path)
            })
            
            logger.info(f"Saved section {i+1}/{len(sections)}: {section_id}.wav ({instrument})")
        
        return JSONResponse({
            "message": f"Successfully received {len(section_info)} sections",
            "sections": section_info
        })
    
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON format for instruments")
    except Exception as e:
        logger.error(f"Error in upload_sections: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error processing sections: {str(e)}")

# --- API Key Configuration ---
TONN_API_KEY = os.environ.get("TONN_API_KEY")
STABILITY_API_KEY_SERVER = os.environ.get("STABILITY_API_KEY")
TONN_WEBHOOK_URL = os.environ.get("TONN_WEBHOOK_URL")

if not TONN_API_KEY:
    logger.warning("CRITICAL: TONN_API_KEY is not set in environment. Tonn mixing will fail.")
if not STABILITY_API_KEY_SERVER:
    logger.warning("CRITICAL: STABILITY_API_KEY (for server) is not set in environment. Stability audio generation will fail.")
if not TONN_WEBHOOK_URL:
    logger.warning("INFO: TONN_WEBHOOK_URL is not set in environment. Using default in TonnMixer if available, but recommend setting explicitly.")
# --- End API Key Configuration ---

# Create preview mix endpoint
@app.post("/api/create-preview-mix")
async def create_preview_mix(request_data: PreviewMixRequest):
    """Create a preview mix using the Tonn API"""
    logger.info(f"Received /api/create-preview-mix request: {request_data.dict()}")
    if TonnMixer is None:
        logger.error("TonnMixer module not available for preview mix.")
        raise HTTPException(status_code=500, detail="TonnMixer is not available")
    if not TONN_API_KEY:
        logger.error("TONN_API_KEY is not configured for preview mix.")
        raise HTTPException(status_code=500, detail="TONN_API_KEY is not configured on the server.")

    # Pass the configured webhook URL to TonnMixer if it accepts it, or it uses its own default
    tonn_mixer = TonnMixer(api_key=TONN_API_KEY, webhook_url=TONN_WEBHOOK_URL)
    tracks_for_tonn = []

    requested_genre_upper = request_data.genre.upper()
    # Valid enums from Tonn error: ['ROCK_INDIE', 'POP', 'ACOUSTIC', 'HIPHOP_GRIME', 'ELECTRONIC', 'REGGAE_DUB', 'ORCHESTRAL', 'METAL', 'OTHER']
    genre_to_tonn_style_map = {
        "POP": "POP",
        "ROCK": "ROCK_INDIE", 
        "ELECTRONIC": "ELECTRONIC",
        "HIPHOP": "HIPHOP_GRIME",
        "JAZZ": "OTHER", # Fallback
        "CLASSICAL": "ORCHESTRAL", 
        "AMBIENT": "ELECTRONIC", # Fallback to ELECTRONIC, or OTHER if more appropriate
        "OTHER": "OTHER"
    }
    effective_musical_style = genre_to_tonn_style_map.get(requested_genre_upper, "OTHER")
    logger.info(f"Client genre: {request_data.genre}, Mapped Tonn musical_style: {effective_musical_style}")

    # Here's where we need to find the file paths for the section IDs
    # We expect the section IDs from the client to be the server-generated UUIDs from uploadSections
    for section_detail in request_data.sections:
        section_id = section_detail.id
        client_instruments = section_detail.instruments 
        local_file_path = os.path.join(SECTIONS_DIR, f"{section_id}.wav")
        
        if not os.path.exists(local_file_path):
            logger.error(f"Local section file not found for ID {section_id} at {local_file_path}")
            raise HTTPException(status_code=404, detail=f"Section file {section_id} not found on server.")
        
        # Default to a valid 'OTHER' group from the provided list
        instrument_group = "OTHER_GROUP1" 
        
        if client_instruments:
            primary_instrument_client = client_instruments[0].lower() # Use lower case for matching

            # Define a mapping from client instrument names to Tonn instrument groups
            # Based on the provided valid list:
            # 'BASS_GROUP', 'DRUMS_GROUP', 'KICK_GROUP', 'SNARE_GROUP', 'CYMBALS_GROUP', 
            # 'VOCAL_GROUP', 'BACKING_VOX_GROUP', 'BACKING_TRACK_GROUP', 'PERCS_GROUP', 
            # 'STRINGS_GROUP', 'SYNTH_GROUP', 'FX_GROUP', 'KEYS_GROUP', 'BRASS_GROUP', 
            # 'E_GUITAR_GROUP', 'ACOUSTIC_GUITAR_GROUP', 'OTHER_GROUP1', ..., 'UNKNOWN_GROUP', 'MIDS_GROUP'
            
            instrument_map = {
                "drums": "DRUMS_GROUP",
                "drum": "DRUMS_GROUP",
                "kick": "KICK_GROUP",
                "snare": "SNARE_GROUP",
                "cymbal": "CYMBALS_GROUP",
                "cymbals": "CYMBALS_GROUP",
                "bass": "BASS_GROUP",
                "guitar": "ACOUSTIC_GUITAR_GROUP", # Default guitar to acoustic, can be specified further
                "electric_guitar": "E_GUITAR_GROUP",
                "e_guitar": "E_GUITAR_GROUP",
                "acoustic_guitar": "ACOUSTIC_GUITAR_GROUP",
                "synth": "SYNTH_GROUP",
                "keys": "KEYS_GROUP",
                "piano": "KEYS_GROUP", # Map piano to KEYS_GROUP as per API behavior
                "keyboard": "KEYS_GROUP",
                "keys_synth": "SYNTH_GROUP", # if keys_synth is more synth like
                "strings": "STRINGS_GROUP",
                "vocals": "VOCAL_GROUP",
                "vocal": "VOCAL_GROUP",
                "voice": "VOCAL_GROUP",
                "backing_vocals": "BACKING_VOX_GROUP",
                "backing_vox": "BACKING_VOX_GROUP",
                "percussion": "PERCS_GROUP",
                "percs": "PERCS_GROUP",
                "fx": "FX_GROUP",
                "effects": "FX_GROUP",
                "brass": "BRASS_GROUP",
                "backing_track": "BACKING_TRACK_GROUP",
                # Add other specific mappings as needed
            }

            # Attempt to map the primary instrument
            if primary_instrument_client in instrument_map:
                instrument_group = instrument_map[primary_instrument_client]
            else:
                # If no direct match, try partial matches for common terms
                if "synth" in primary_instrument_client:
                    instrument_group = "SYNTH_GROUP"
                elif "guitar" in primary_instrument_client:
                    # Could be E_GUITAR_GROUP or ACOUSTIC_GUITAR_GROUP. Defaulting to ACOUSTIC.
                    # Client could send 'electric guitar' for E_GUITAR_GROUP
                    instrument_group = "ACOUSTIC_GUITAR_GROUP" 
                elif "key" in primary_instrument_client or "piano" in primary_instrument_client:
                    instrument_group = "KEYS_GROUP"
                # Keep OTHER_GROUP1 if no specific or partial match
                
            # Special handling for 'keys_synth' based on context (already partially handled by map)
            # If client specifically sends 'keys_synth', it might be ambiguous.
            # The map defaults it to SYNTH_GROUP. If it should be KEYS_GROUP, adjust the map.
            # For now, the map handles it.

        logger.info(f"Section {section_id} (Client Instruments: {client_instruments}, Primary: {primary_instrument_client if client_instruments else 'N/A'}) mapped to Tonn group: {instrument_group}")
        tracks_for_tonn.append({"path": local_file_path, "type": instrument_group})

    if len(tracks_for_tonn) < 2:
        logger.error(f"Attempting to create mix with {len(tracks_for_tonn)} track(s). Tonn requires at least 2.")
        raise HTTPException(status_code=400, detail="Tonn API requires at least 2 tracks for a mix preview.")

    try:
        logger.info(f"Calling TonnMixer.create_preview_mix_async with musical_style: {effective_musical_style} and {len(tracks_for_tonn)} tracks.")
        # Start the webhook listener if not already running
        if hasattr(tonn_mixer, '_start_webhook_listener') and callable(tonn_mixer._start_webhook_listener):
            tonn_mixer._start_webhook_listener()
            logger.info("Started Tonn webhook listener")
        
        # Create an async task for the preview mix to avoid blocking
        tonn_task_id = await tonn_mixer.create_preview_mix_async(
            tracks=tracks_for_tonn,
            musical_style=effective_musical_style
        )
        
        if not tonn_task_id:
            logger.error("TonnMixer.create_preview_mix_async did not return a task_id.")
            raise HTTPException(status_code=500, detail="Failed to initiate Tonn preview mix: No task ID returned.")

        logger.info(f"Tonn preview mix initiated successfully. Task ID: {tonn_task_id}")
        
        # Tonn usually returns a task object with initial status. Let's assume mixer.py returns that.
        # Or, we assume Tonn API always starts as PENDING/PROCESSING via webhook.
        initial_tonn_task_info = tonn_mixer.get_mix_status(tonn_task_id) # This should reflect what Tonn returns or what webhook sets
        initial_status = initial_tonn_task_info.get("status", "PENDING")

        active_tasks[tonn_task_id] = {
            "id": tonn_task_id,
            "type": "preview",
            "status": initial_status, 
            "progress": 0, 
            "sections_client_ids": [section.id for section in request_data.sections],
            "genre": request_data.genre,
            "started_at": time.time(),
            "tonn_webhook_url": tonn_mixer.webhook_url,
            "download_url": None # Will be populated by webhook or polling
        }
        logger.info(f"Task {tonn_task_id} stored with initial status: {initial_status}")
        
        return {
            "task_id": tonn_task_id,
            "status": initial_status,
            "message": "Tonn preview mix initiated successfully."
        }

    except FileNotFoundError as e:
        logger.error(f"File not found during Tonn preview mix creation: {str(e)}", exc_info=True)
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating Tonn preview mix: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error creating Tonn preview mix: {str(e)}")

# New endpoint for stitching sections into a single song
@app.post("/api/create-stitched-song")
async def create_stitched_song(request_data: StitchedSongRequest):
    logger.info(f"Received /api/create-stitched-song request: {request_data.dict()}")
    
    # Check if stitch_audio_sections utility is available
    if not stitch_audio_sections:
        logger.error("stitch_audio_sections utility is not available.")
        raise HTTPException(status_code=500, detail="Audio stitching service is not available on the server.")

    # Validate the request data
    if not request_data.uploaded_section_details or len(request_data.uploaded_section_details) < 2:
        error_msg = f"Need at least 2 sections to stitch, got {len(request_data.uploaded_section_details) if request_data.uploaded_section_details else 0}"
        logger.error(f"Invalid request: {error_msg}")
        raise HTTPException(status_code=422, detail=error_msg)

    # Validate and prepare section file paths
    section_file_paths = []
    for detail in request_data.uploaded_section_details:
        # Validate the format of each section detail
        if not isinstance(detail, dict):
            logger.error(f"Invalid section detail format: {detail}")
            raise HTTPException(status_code=422, detail=f"Invalid section detail format: {detail}")
        
        # Check required fields
        if "id" not in detail:
            logger.error("Missing 'id' field in section detail")
            raise HTTPException(status_code=422, detail="Missing 'id' field in section detail")
        
        # Get file path from detail
        file_path = detail.get("path")
        if not file_path:
            # If path not provided, try to construct it from id
            section_id = detail.get("id")
            file_path = os.path.join(SECTIONS_DIR, f"{section_id}.wav")
            logger.info(f"Path not provided for section {section_id}, using constructed path: {file_path}")
        
        # Check if file exists
        if not os.path.exists(file_path):
            logger.error(f"Section file not found: {file_path} for ID {detail.get('id')}")
            raise HTTPException(
                status_code=404, 
                detail=f"Audio file not found for section ID {detail.get('id')}. Path tried: {file_path}"
            )
        
        # Check if file is a valid audio file (basic size check)
        try:
            file_size = os.path.getsize(file_path)
            if file_size < 1000:  # Less than 1KB
                logger.warning(f"Audio file is suspiciously small: {file_path} ({file_size} bytes)")
                # Still include it, but log the warning
        except Exception as e:
            logger.error(f"Error checking file size: {file_path} - {e}")
            # Continue anyway, the actual stitching function will handle invalid files
        
        section_file_paths.append(file_path)
    
    # Validate the overlap parameter
    overlap_ms = request_data.overlap_ms
    if not isinstance(overlap_ms, (int, float)) or overlap_ms < 0 or overlap_ms > 10000:
        logger.warning(f"Invalid overlap value: {overlap_ms}, using default 200ms")
        overlap_ms = 200  # Default to 200ms if value is invalid
    
    # Generate a unique filename for the stitched song
    stitched_song_id = str(uuid.uuid4())
    output_filename = f"stitched_song_{stitched_song_id}.wav"
    output_path = os.path.join(MIXES_DIR, output_filename)

    logger.info(f"Stitching {len(section_file_paths)} sections with {overlap_ms}ms overlap to {output_path}")

    try:
        # Call the audio stitching function
        stitched_file_path = stitch_audio_sections(
            section_files=section_file_paths,
            overlap_ms=overlap_ms,
            output_path=output_path
        )

        if not stitched_file_path:
            logger.error(f"Audio stitching failed for task {stitched_song_id} - stitch_audio_sections returned None")
            raise HTTPException(status_code=500, detail="Failed to stitch audio sections. Check server logs for details.")
        
        # Verify the output file exists and has content
        if not os.path.exists(stitched_file_path):
            logger.error(f"Stitched file not found at expected path: {stitched_file_path}")
            raise HTTPException(status_code=500, detail="Stitched file not found after processing.")
            
        file_size = os.path.getsize(stitched_file_path)
        if file_size < 1000:  # Less than 1KB
            logger.error(f"Stitched file is too small: {stitched_file_path} ({file_size} bytes)")
            raise HTTPException(status_code=500, detail="Stitched file appears to be empty or corrupted.")

        # Store minimal task info for download
        active_tasks[stitched_song_id] = {
            "id": stitched_song_id,
            "type": "stitched",
            "status": "COMPLETED",
            "output_path": stitched_file_path,
            "download_url": f"/download-mix/{stitched_song_id}", # WITHOUT /api prefix - client will add it
            "started_at": time.time()
        }
        
        logger.info(f"Successfully stitched song saved to {stitched_file_path}. Task ID: {stitched_song_id}, Size: {file_size} bytes")
        
        return {
            "task_id": stitched_song_id,
            "status": "COMPLETED",
            "message": "Song stitched successfully.",
            "download_url": f"/download-mix/{stitched_song_id}", # WITHOUT /api prefix - client will add it
            "output_path_server": stitched_file_path, # For server reference
            "size_bytes": file_size
        }
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error(f"Error during song stitching: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error stitching song: {str(e)}")

# Check mix status endpoint
@app.get("/api/mix-status/{task_id}")
async def check_mix_status(task_id: str):
    """Check the status of a mix task"""
    logger.info(f"Received /api/mix-status request for task: {task_id}")
    if task_id not in active_tasks:
        logger.warning(f"Task {task_id} not found in active_tasks.")
        # Optionally, try to get status from TonnMixer directly if it persists state
        if TonnMixer:
            tonn_mixer = TonnMixer(api_key=TONN_API_KEY)
            status_from_mixer = tonn_mixer.get_mix_status(task_id)
            if status_from_mixer and status_from_mixer.get("status") != "UNKNOWN":
                logger.info(f"Retrieved status for task {task_id} from TonnMixer cache: {status_from_mixer}")
                # Update active_tasks if found
                active_tasks[task_id] = {
                    "id": task_id,
                    "type": active_tasks.get(task_id, {}).get("type", "preview"), # Preserve type if task was briefly known
                    "status": status_from_mixer.get("status"),
                    "progress": status_from_mixer.get("progress", 0),
                    "download_url": status_from_mixer.get("output_file") or status_from_mixer.get("mix_url"),
                    "started_at": active_tasks.get(task_id, {}).get("started_at", time.time()),
                }
                return active_tasks[task_id]
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    
    task = active_tasks[task_id]
    logger.info(f"Current status for task {task_id}: {task}")
    
    # Add additional checking mechanism for mastering tasks
    if task.get("type") == "mastering" and task["status"] == "PENDING":
        # Check if we received a webhook but didn't update the task
        webhook_listener = getattr(TonnMixer, '_webhook_listener_loop', None)
        if webhook_listener and hasattr(webhook_listener, '_processed_webhook_requests'):
            # Check processed webhook requests for this task
            for request_uuid in webhook_listener._processed_webhook_requests:
                try:
                    request_data = webhook_listener._webhook_data.get(request_uuid)
                    if request_data and "mastering_task_id" in request_data:
                        mastering_task_id = request_data.get("mastering_task_id")
                        if mastering_task_id == task_id:
                            if "state" in request_data and request_data["state"] == "MASTERING_TASK_COMPLETED":
                                # We found a completion webhook that wasn't processed correctly
                                logger.info(f"Found unprocessed mastering completion webhook for task {task_id}")
                                task["status"] = "COMPLETED"
                                task["download_url"] = request_data.get("download_url_mastered")
                                break
                except Exception as e:
                    logger.warning(f"Error checking webhook data for task {task_id}: {e}")
    
    # If TonnMixer updates download_url upon webhook completion, ensure it's reflected here
    # The TonnMixer's get_mix_status might be more up-to-date if webhooks are working.
    if TonnMixer and task["status"] != "COMPLETED" and task.get("type") != "stitched": # Re-check with Tonn mixer if not completed and not a stitched task
        tonn_mixer = TonnMixer(api_key=TONN_API_KEY)
        status_from_mixer = tonn_mixer.get_mix_status(task_id)
        if status_from_mixer.get("status") == "COMPLETED":
            task["status"] = "COMPLETED"
            task["download_url"] = status_from_mixer.get("output_file") or status_from_mixer.get("mix_url")
            logger.info(f"Updated task {task_id} to COMPLETED via TonnMixer status.")
            
            # For mastering tasks, ensure we also mark in TonnMixer's cache if it's not already
            if task.get("type") == "mastering" and hasattr(tonn_mixer, "mix_tasks"):
                if task_id in tonn_mixer.mix_tasks and tonn_mixer.mix_tasks[task_id]["status"] != "COMPLETED":
                    logger.info(f"Also updating TonnMixer cache for mastering task {task_id}")
                    tonn_mixer.mix_tasks[task_id]["status"] = "COMPLETED"
                    tonn_mixer.mix_tasks[task_id]["mix_url"] = task["download_url"]

    # Special handling for mastering tasks, especially for webhook notifications
    if task.get("type") == "mastering":
        # Try direct polling as fallback if still PENDING
        if task["status"] == "PENDING" and TonnMixer:
            try:
                logger.info(f"Trying direct poll for mastering task {task_id}")
                tonn_mixer = TonnMixer(api_key=TONN_API_KEY)
                # This is async, but we're in a sync context, so we need a workaround
                import asyncio
                if asyncio.get_event_loop().is_running():
                    # Already in async context, can call directly
                    preview_results = await tonn_mixer.poll_preview_master(task_id, max_attempts=1, poll_interval=1)
                else:
                    # Need to create a new event loop
                    loop = asyncio.new_event_loop()
                    preview_results = loop.run_until_complete(tonn_mixer.poll_preview_master(task_id, max_attempts=1, poll_interval=1))
                    loop.close()
                
                if preview_results:
                    logger.info(f"Direct poll successful for mastering task {task_id}: {preview_results}")
                    task["status"] = "COMPLETED"
                    task["download_url"] = preview_results.get("download_url_mastered_preview")
            except Exception as e:
                logger.warning(f"Error during direct poll for mastering task {task_id}: {e}")

    if task["status"] == "COMPLETED" and task.get("download_url") and not task["download_url"].startswith(("http", "/")):
        # If download_url is a local file path from TonnMixer, make it a downloadable route
        task["download_url"] = f"/api/download-mix/{task_id}"
        logger.info(f"Serving local file for task {task_id} at {task['download_url']}")
    
    # For mastering tasks, if we have a download_url but status is still PENDING, update to COMPLETED
    if task.get("type") == "mastering" and task["status"] == "PENDING" and task.get("download_url"):
        logger.info(f"Mastering task {task_id} has download_url but status is PENDING - updating to COMPLETED")
        task["status"] = "COMPLETED"

    return task

# Download mix endpoint
@app.get("/api/download-mix/{task_id}")
async def download_mix(task_id: str):
    """Download a completed mix (either Tonn or Stitched)"""
    logger.info(f"Received /api/download-mix request for task: {task_id}")
    
    task = active_tasks.get(task_id)

    if not task:
         # Fallback to check TonnMixer cache directly if task not in active_tasks (for Tonn tasks)
        if TonnMixer:
            tonn_mixer = TonnMixer(api_key=TONN_API_KEY)
            task_info_from_mixer = tonn_mixer.get_mix_status(task_id)
            if task_info_from_mixer and task_info_from_mixer.get("output_file") and os.path.exists(task_info_from_mixer["output_file"]):
                logger.info(f"Serving Tonn file {task_info_from_mixer['output_file']} for task {task_id} from TonnMixer cache.")
                return FileResponse(task_info_from_mixer["output_file"], media_type="audio/wav", filename=os.path.basename(task_info_from_mixer["output_file"]))
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found.")

    output_file_path = task.get("output_path")

    if task.get("status") != "COMPLETED" or not output_file_path:
        raise HTTPException(status_code=400, detail=f"Mix for task {task_id} is not completed or output path is missing.")
    
    if not os.path.exists(output_file_path):
        logger.error(f"Mix file not found at path: {output_file_path} for task {task_id}")
        raise HTTPException(status_code=404, detail=f"Mix file not found on server for task {task_id}.")
    
    logger.info(f"Serving file {output_file_path} for task {task_id} (type: {task.get('type')})")
    return FileResponse(output_file_path, media_type="audio/wav", filename=os.path.basename(output_file_path))

# Add a new route for compatibility - /download-mix/{task_id} without the /api prefix
@app.get("/download-mix/{task_id}")
async def download_mix_without_api_prefix(task_id: str):
    """Compatibility route for downloading mixes without the /api prefix"""
    logger.info(f"Received /download-mix request (without /api prefix) for task: {task_id}")
    return await download_mix(task_id)

# Create final mix endpoint
@app.post("/api/create-final-mix")
async def create_final_mix(request: FinalMixRequest):
    """Create a final mix using the Tonn API"""
    logger.info(f"Received /api/create-final-mix request for preview task: {request.previewTaskId}")
    if TonnMixer is None:
        raise HTTPException(status_code=500, detail="TonnMixer is not available")
    if not TONN_API_KEY or TONN_API_KEY == "YOUR_FALLBACK_TONN_API_KEY_HERE":
        raise HTTPException(status_code=500, detail="TONN_API_KEY is not configured on the server.")

    tonn_mixer = TonnMixer(api_key=TONN_API_KEY, webhook_url=TONN_WEBHOOK_URL)
    preview_task_id = request.previewTaskId

    # Check if preview task exists and is completed
    preview_task = active_tasks.get(preview_task_id)
    if preview_task:
        logger.info(f"Found preview task {preview_task_id} in active_tasks: {preview_task}")
    else:
        logger.warning(f"Preview task {preview_task_id} not found in active_tasks. Will try to retrieve via TonnMixer.")

    # In real implementation, call the createFinalMix method on TonnMixer
    try:
        logger.info(f"Calling TonnMixer.create_final_mix_async for preview task: {preview_task_id}")
        
        # Use the async method
        final_task_id = await tonn_mixer.create_final_mix_async(preview_task_id)
        
        logger.info(f"Final mix task created: {final_task_id}")
        
        # Store task information
        active_tasks[final_task_id] = {
            "id": final_task_id,
            "type": "final",
            "status": "PENDING",
            "progress": 10,
            "preview_task_id": preview_task_id,
            "created_at": time.time(),
        }
        
        return {
            "task_id": final_task_id,
            "status": "PENDING",
            "message": "Final mix creation started",
        }
    except Exception as e:
        logger.error(f"Error creating final mix from preview {preview_task_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error creating final mix: {str(e)}")

# Add a new route for proxying requests to Stability AI's Stable Audio API
@app.post("/api/generate-audio")
async def generate_audio(request: Request):
    # Get request body (JSON)
    try:
        body = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid request body: {str(e)}")
    
    # Extract parameters from request
    prompt = body.get("prompt")
    bpm = body.get("bpm", 120)
    duration = body.get("duration", 15)
    seed = body.get("seed", int(time.time()))
    output_format = body.get("output_format", "wav")
    
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")
    
    # Log the request
    logger.info(f"Generate audio request: prompt='{prompt}', bpm={bpm}, duration={duration}, seed={seed}")
    
    if not STABILITY_API_KEY_SERVER:
        logger.error("STABILITY_API_KEY (server) is not configured. Cannot generate audio.")
        raise HTTPException(status_code=500, detail="Audio generation service not configured on server (missing API key).")

    try:
        # Create multipart/form-data request to Stability AI
        stability_api_url = "https://api.stability.ai/v2beta/audio/stable-audio-2/text-to-audio"
        
        # Create form data
        files = {
            'prompt': (None, prompt),
            'output_format': (None, output_format),
            'duration': (None, str(duration)),
            'tempo_bpm': (None, str(bpm)),
            'seed': (None, str(seed))
        }
        
        # Set headers including proper Accept header
        headers = {
            'Authorization': f'Bearer {STABILITY_API_KEY_SERVER}',
            'Accept': 'audio/*'
        }
        
        logger.info(f"Sending request to Stability AI with headers: {headers}")
        logger.info(f"Form data: {files}")
        
        # Make the request to Stability AI
        stability_response = requests.post(
            stability_api_url,
            files=files,
            headers=headers
        )
        
        # Check if the request was successful
        if stability_response.status_code != 200:
            error_message = f"Stability AI API returned error: {stability_response.status_code} - {stability_response.text}"
            logger.error(error_message)
            raise HTTPException(status_code=stability_response.status_code, detail=error_message)
        
        # Get response headers
        response_headers = dict(stability_response.headers)
        logger.info(f"Stability AI response headers: {response_headers}")
        
        # Generate a file ID and save the audio file
        file_id = str(uuid.uuid4())
        file_path = os.path.join(SECTIONS_DIR, f"{file_id}.wav")
        
        logger.info(f"Saving stability audio with ID {file_id} to {file_path}")
        
        # Save the audio file to disk
        with open(file_path, "wb") as f:
            f.write(stability_response.content)
        
        file_size = os.path.getsize(file_path)
        logger.info(f"Saved audio file: {file_path} ({file_size} bytes)")
        
        # Create custom response with proper headers
        content = stability_response.content
        response = Response(content=content)
        
        # Set content type
        response.headers["Content-Type"] = stability_response.headers.get("Content-Type", "audio/wav")
        
        # Add file ID header - CRITICAL: This is what the client looks for
        response.headers["x-file-id"] = file_id
        
        # Add stability headers if available
        stability_headers = ["x-stability-bpm", "x-stability-key", "x-stability-duration"]
        for header in stability_headers:
            if header in stability_response.headers:
                response.headers[header] = stability_response.headers[header]
        
        # Print all headers that will be sent
        logger.info(f"RESPONSE HEADERS BEING SENT: {dict(response.headers)}")
        
        return response
    
    except Exception as e:
        error_message = f"Error generating audio: {str(e)}"
        logger.error(error_message)
        raise HTTPException(status_code=500, detail=error_message)

@app.get("/api/sections/{file_id}")
async def get_section_audio(file_id: str):
    """Serve a section audio file directly from the sections directory by its UUID"""
    logger.info(f"Audio file request received for ID: {file_id}")
    
    if not file_id or len(file_id) < 8 or '..' in file_id or '/' in file_id:
        # Simple validation to prevent directory traversal
        logger.error(f"Invalid file ID format: {file_id}")
        raise HTTPException(status_code=400, detail="Invalid file ID")
    
    file_path = os.path.join(SECTIONS_DIR, f"{file_id}.wav")
    
    if not os.path.exists(file_path):
        # Try checking the file size
        logger.error(f"Section audio file not found: {file_path}")
        # List all files in the directory for debugging
        try:
            files = os.listdir(SECTIONS_DIR)
            logger.info(f"Files in sections directory: {len(files)} files")
            # Find similar files if any
            similar_files = [f for f in files if file_id[:8] in f]
            if similar_files:
                logger.info(f"Found similar files: {similar_files}")
        except Exception as e:
            logger.error(f"Error listing files in sections directory: {e}")
        
        raise HTTPException(status_code=404, detail=f"Audio file not found: {file_id}")
    
    file_size = os.path.getsize(file_path)
    logger.info(f"Serving section audio file: {file_path}, size: {file_size} bytes")
    
    # If file is too small, it might be a placeholder or corrupted
    if file_size < 1000:  # Less than 1KB
        logger.warning(f"Audio file is very small ({file_size} bytes), might be incomplete")
    
    return FileResponse(
        file_path, 
        media_type="audio/wav", 
        filename=f"section_{file_id}.wav",
        headers={"Cache-Control": "public, max-age=31536000"} # Cache for 1 year
    )

# New endpoint for direct mix creation (skipping preview step)
@app.post("/api/create-direct-mix")
async def create_direct_mix(request_data: PreviewMixRequest):
    """Create a direct final mix using the Tonn API with stitched audio"""
    logger.info(f"Received /api/create-direct-mix request: {json.dumps(request_data.dict(), default=str)}")
    if TonnMixer is None:
        logger.error("TonnMixer module not available for direct mix.")
        raise HTTPException(status_code=500, detail="TonnMixer is not available")
    if not TONN_API_KEY:
        logger.error("TONN_API_KEY is not configured for direct mix.")
        raise HTTPException(status_code=500, detail="TONN_API_KEY is not configured on the server.")

    # Get stitched audio path directly from request data
    stitched_audio_path = request_data.stitchedAudioPath
    
    if not stitched_audio_path:
        logger.error("Stitched audio path not provided in request")
        raise HTTPException(status_code=400, detail="Stitched audio file path is required for direct mix")
    
    logger.info(f"Looking for stitched audio file at: {stitched_audio_path}")
    
    # Check if the file exists - try multiple paths
    file_paths_to_try = [
        stitched_audio_path,  # As provided
        os.path.join(os.getcwd(), stitched_audio_path),  # Relative to current directory
        os.path.abspath(stitched_audio_path),  # Absolute path
    ]
    
    # Try paths with the "temp" directory since that's where files are saved
    if 'temp' in stitched_audio_path and not stitched_audio_path.startswith('temp'):
        # Path contains "temp" but doesn't start with it - try adding it
        file_paths_to_try.append(os.path.join(os.getcwd(), 'temp', stitched_audio_path.split('temp/')[-1]))
    elif not 'temp' in stitched_audio_path:
        # Path doesn't contain "temp" at all - try adding it
        file_paths_to_try.append(os.path.join(os.getcwd(), 'temp', 'mixes', os.path.basename(stitched_audio_path)))
    
    # Try different variations with/without extension
    basename = os.path.basename(stitched_audio_path)
    if not basename.endswith('.wav'):
        file_paths_to_try.append(os.path.join(os.getcwd(), 'temp', 'mixes', f"{basename}.wav"))
    
    # Log all paths we're going to try
    logger.info(f"Will try these paths: {file_paths_to_try}")
    
    # Try each path until we find one that exists
    found_path = None
    for path in file_paths_to_try:
        if os.path.exists(path):
            found_path = path
            logger.info(f"Found stitched audio file at: {found_path}")
            break
    
    if not found_path:
        logger.error(f"Stitched audio file not found at any attempted path")
        
        # As a fallback, let's check if we can rebuild it from the stored sections
        if len(request_data.sections) >= 2 and stitch_audio_sections:
            logger.info(f"Attempting to create stitched audio from scratch with {len(request_data.sections)} sections")
            try:
                # Get the section file paths for the sections in the request
                section_files = []
                for section in request_data.sections:
                    section_path = os.path.join(SECTIONS_DIR, f"{section.id}.wav")
                    if os.path.exists(section_path):
                        section_files.append(section_path)
                
                if len(section_files) >= 2:
                    # Generate a unique filename for a new stitched song
                    stitched_song_id = str(uuid.uuid4())
                    new_output_path = os.path.join(MIXES_DIR, f"stitched_song_{stitched_song_id}.wav")
                    
                    # Create the stitched song
                    new_stitched_path = stitch_audio_sections(
                        section_files=section_files,
                        overlap_ms=200,  # Default overlap 
                        output_path=new_output_path
                    )
                    
                    if new_stitched_path and os.path.exists(new_stitched_path):
                        logger.info(f"Successfully created new stitched audio at: {new_stitched_path}")
                        found_path = new_stitched_path
                    else:
                        logger.error(f"Failed to create new stitched audio")
                else:
                    logger.error(f"Not enough section files found for stitching")
            except Exception as e:
                logger.error(f"Error creating stitched audio: {str(e)}", exc_info=True)
        
        if not found_path:
            raise HTTPException(status_code=404, detail=f"Stitched audio file not found and could not be recreated")
    
    stitched_audio_path = found_path  # Use the found path
    
    requested_genre_upper = request_data.genre.upper()
    # Same genre mapping used in create_preview_mix
    genre_to_tonn_style_map = {
        "POP": "POP",
        "ROCK": "ROCK_INDIE", 
        "ELECTRONIC": "ELECTRONIC",
        "HIPHOP": "HIPHOP_GRIME",
        "JAZZ": "OTHER", # Fallback
        "CLASSICAL": "ORCHESTRAL", 
        "AMBIENT": "ELECTRONIC", # Fallback to ELECTRONIC, or OTHER if more appropriate
        "OTHER": "OTHER"
    }
    effective_musical_style = genre_to_tonn_style_map.get(requested_genre_upper, "OTHER")
    logger.info(f"Client genre for mastering: {request_data.genre}, Mapped Tonn musical_style: {effective_musical_style}")

    try:
        # Create TonnMixer instance with configured API key and webhook URL
        tonn_mixer = TonnMixer(api_key=TONN_API_KEY, webhook_url=TONN_WEBHOOK_URL)
        
        # Start the webhook listener if not already running
        if hasattr(tonn_mixer, '_start_webhook_listener') and callable(tonn_mixer._start_webhook_listener):
            tonn_mixer._start_webhook_listener()
            logger.info("Started Tonn webhook listener for mastering")
        
        # First try with webhooks enabled
        try:
            # Create master from stitched audio using album mastering API
            tonn_task_id = await tonn_mixer.create_final_mix_from_stitched_async(
                stitched_audio_path=stitched_audio_path,
                musical_style=effective_musical_style,
                use_webhook=True
            )
            
            logger.info(f"Tonn mastering task initiated successfully with webhooks. Task ID: {tonn_task_id}")
        except Exception as webhook_error:
            # Check if it's a webhook-related error (429, webhook URL issues)
            webhook_issue = False
            error_text = str(webhook_error).lower()
            if "429" in error_text or "webhook" in error_text or "too many requests" in error_text:
                webhook_issue = True
                
            if webhook_issue:
                logger.warning(f"Webhook-related error occurred: {webhook_error}. Retrying without webhooks.")
                
                # Retry without webhooks
                tonn_task_id = await tonn_mixer.create_final_mix_from_stitched_async(
                    stitched_audio_path=stitched_audio_path,
                    musical_style=effective_musical_style,
                    use_webhook=False
                )
                
                logger.info(f"Tonn mastering task initiated successfully without webhooks. Task ID: {tonn_task_id}")
            else:
                # Not webhook-related, re-raise
                raise
        
        if not tonn_task_id:
            logger.error("TonnMixer.create_final_mix_from_stitched_async did not return a task_id.")
            raise HTTPException(status_code=500, detail="Failed to initiate Tonn mastering: No task ID returned.")
        
        # Store task info for status checking
        active_tasks[tonn_task_id] = {
            "id": tonn_task_id,
            "type": "mastering",
            "status": "PENDING", 
            "progress": 0, 
            "sections_client_ids": [section.id for section in request_data.sections],
            "genre": request_data.genre,
            "started_at": time.time(),
            "tonn_webhook_url": tonn_mixer.webhook_url,
            "download_url": None, # Will be populated by webhook or polling
            "stitched_audio_path": stitched_audio_path
        }
        logger.info(f"Mastering task {tonn_task_id} stored with initial status: PENDING")
        
        return {
            "task_id": tonn_task_id,
            "status": "PENDING",
            "message": "Tonn mastering task initiated successfully."
        }

    except FileNotFoundError as e:
        logger.error(f"File not found during Tonn mastering creation: {str(e)}", exc_info=True)
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating Tonn mastering: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error creating Tonn mastering: {str(e)}")

# Add a new proxy endpoint to fetch external audio files
@app.get("/api/proxy-audio")
async def proxy_audio(url: str):
    """
    Proxy endpoint to fetch external audio files that might have CORS restrictions
    """
    if not url:
        raise HTTPException(status_code=400, detail="URL parameter is required")
    
    logger.info(f"Proxying audio from: {url}")
    
    try:
        # Fetch the audio file
        response = requests.get(url, stream=True, timeout=30)
        
        if not response.ok:
            logger.error(f"Failed to fetch audio from {url}: {response.status_code} {response.reason}")
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Failed to fetch audio: {response.reason}"
            )
        
        # Create a streaming response to avoid loading the whole file into memory
        def iterfile():
            for chunk in response.iter_content(chunk_size=8192):
                yield chunk
        
        # Determine content type from the original response
        content_type = response.headers.get("Content-Type", "audio/wav")
        
        # Return a StreamingResponse with the same content type
        return StreamingResponse(
            iterfile(), 
            media_type=content_type,
            headers={
                "Content-Disposition": f"attachment; filename=proxied_audio.wav",
                "Cache-Control": "no-cache, max-age=0",
                "X-Original-Url": url,
                "Access-Control-Allow-Origin": "*" # Ensure our proxy allows access
            }
        )
    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except Exception as e:
        logger.error(f"Error proxying audio from {url}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error proxying audio: {str(e)}")

# Add an endpoint for uploading combined audio
@app.post("/api/upload-combined-audio")
async def upload_combined_audio(audio: UploadFile = File(...)):
    """Upload a combined audio file (mastered + new sections) for remastering"""
    logger.info(f"Received combined audio upload: {audio.filename}")
    
    try:
        # Create combined directory if it doesn't exist
        combined_dir = os.path.join(TEMP_DIR, "combined")
        os.makedirs(combined_dir, exist_ok=True)
        
        # Generate a unique ID
        file_id = str(uuid.uuid4())
        
        # Save the file
        file_path = os.path.join(combined_dir, f"{file_id}.wav")
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(audio.file, buffer)
        
        logger.info(f"Saved combined audio to {file_path}")
        
        # Return the path for future reference
        return {
            "id": file_id,
            "path": file_path,
            "filename": audio.filename,
            "size": os.path.getsize(file_path)
        }
    
    except Exception as e:
        logger.error(f"Error uploading combined audio: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error processing combined audio: {str(e)}")

# Run the server when executed directly
if __name__ == "__main__":
    # Try ports starting from 5000 up to 5010
    start_port = 5000
    max_port = 5010
    
    for port in range(start_port, max_port + 1):
        try:
            logger.info(f"Attempting to start server on port {port}")
            uvicorn.run("server:app", host="0.0.0.0", port=port, reload=True)
            break  # If successful, exit the loop
        except OSError as e:
            if e.errno == 48:  # Address already in use
                logger.info(f"Port {port} is already in use, trying next port...")
            else:
                logger.error(f"Error starting server: {e}", exc_info=True)
                raise
    else:
        logger.error(f"All ports from {start_port} to {max_port} are in use. Please free up a port and try again.")
