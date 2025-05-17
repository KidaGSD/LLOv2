from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import uvicorn
import uuid
import os
import sys
import shutil
from typing import List

# Add tonn directory to path so we can import the modules
sys.path.append(os.path.abspath("."))

app = FastAPI()

# Configure CORS to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create temp directories if they don't exist
os.makedirs("temp/stems", exist_ok=True)
os.makedirs("temp/mixes", exist_ok=True)

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/test-tonn-import")
async def test_tonn_import():
    try:
        # Try to import the mixer module
        from tonn import mixer
        return {"status": "success", "message": "Tonn mixer module imported successfully"}
    except Exception as e:
        return {"status": "error", "message": f"Failed to import Tonn mixer: {str(e)}"}

@app.post("/api/test-upload-stems")
async def test_upload_stems(stems: List[UploadFile] = File(...), 
                       instruments: List[str] = Form(...)):
    """Simple endpoint to test stem uploads without calling the Tonn API"""
    
    stem_files = []
    
    for i, stem in enumerate(stems):
        # Generate a unique ID for the stem
        stem_id = str(uuid.uuid4())
        stem_path = f"temp/stems/{stem_id}.wav"
        
        # Save the uploaded file
        with open(stem_path, "wb") as buffer:
            shutil.copyfileobj(stem.file, buffer)
        
        instrument = instruments[i] if i < len(instruments) else "UNKNOWN"
        
        stem_files.append({
            "id": stem_id,
            "path": stem_path,
            "instrument": instrument,
            "filename": stem.filename,
            "size": os.path.getsize(stem_path)
        })
    
    return JSONResponse({
        "message": f"Successfully received {len(stem_files)} stems",
        "stems": stem_files
    })

# Run the server when executed directly
if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True) 