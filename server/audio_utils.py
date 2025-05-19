from pydub import AudioSegment
import os
import logging

def stitch_audio_sections(section_files: list, overlap_ms: int, output_path: str):
    """
    Stitches audio sections together with a specified overlap and crossfade.

    Args:
        section_files (list): A list of paths to the audio files to be stitched.
        overlap_ms (int): The duration of the overlap/crossfade in milliseconds.
        output_path (str): The path to save the final stitched audio file.
    
    Returns:
        str: The path to the stitched audio file, or None if an error occurs.
    """
    logger = logging.getLogger(__name__)
    
    # Input validation
    if not section_files:
        logger.error("No section files provided for stitching")
        return None
        
    if len(section_files) < 2:
        logger.error(f"Need at least 2 section files to stitch, got {len(section_files)}")
        return None
    
    # Check if all files exist
    missing_files = [f for f in section_files if not os.path.exists(f)]
    if missing_files:
        logger.error(f"Missing audio files: {missing_files}")
        return None
    
    # Validate overlap value
    if not isinstance(overlap_ms, (int, float)) or overlap_ms < 0:
        logger.warning(f"Invalid overlap value: {overlap_ms}. Using default 200ms instead.")
        overlap_ms = 200

    try:
        # Create output directory if it doesn't exist
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        # Load the first section
        try:
            stitched_audio = AudioSegment.from_file(section_files[0])
            logger.info(f"Loaded first section: {section_files[0]} ({len(stitched_audio)}ms)")
        except Exception as e:
            logger.error(f"Error loading first audio file {section_files[0]}: {e}")
            return None

        if len(section_files) > 1:
            for i in range(1, len(section_files)):
                try:
                    next_section = AudioSegment.from_file(section_files[i])
                    logger.info(f"Loaded section {i+1}: {section_files[i]} ({len(next_section)}ms)")
                    
                    # Ensure overlap is not larger than either audio segment
                    effective_overlap = min(overlap_ms, len(stitched_audio), len(next_section))
                    if effective_overlap != overlap_ms:
                        logger.warning(f"Reduced overlap from {overlap_ms}ms to {effective_overlap}ms due to audio length constraints")
                    
                    # Apply crossfade: the overlap_ms is the duration of the crossfade
                    # The first track is shortened by overlap_ms, and the second track is faded in over overlap_ms
                    stitched_audio = stitched_audio.append(next_section, crossfade=effective_overlap)
                    logger.info(f"Appended section {i+1} with {effective_overlap}ms crossfade")
                except Exception as e:
                    logger.error(f"Error processing section {i+1} {section_files[i]}: {e}")
                    # Continue with what we have so far rather than failing completely
                    continue
        
        # Export the final stitched audio
        try:
            stitched_audio.export(output_path, format="wav")
            logger.info(f"Successfully exported stitched audio to {output_path} ({len(stitched_audio)}ms)")
            return output_path
        except Exception as e:
            logger.error(f"Error exporting stitched audio to {output_path}: {e}")
            return None
            
    except Exception as e:
        logger.error(f"Error during audio stitching: {e}", exc_info=True)
        return None

if __name__ == '__main__':
    # Define paths to your actual sample WAV files
    # These should be relative to the project root if you run audio_utils.py from there,
    # or adjust paths accordingly.
    sample_dir = "temp_audio_samples" 
    s1_path = os.path.join(sample_dir, "sample1.wav")
    s2_path = os.path.join(sample_dir, "sample2.wav")
    # Add more sample paths if you have them, e.g., s3_path
    output_stitched_dir = "temp_stitched_output"
    os.makedirs(output_stitched_dir, exist_ok=True)
    stitched_file_path = os.path.join(output_stitched_dir, "standalone_stitched_song.wav")


    test_files = [s1_path, s2_path] # Use your actual sample files
    overlap_duration = 500  # 500 ms overlap, adjust as needed

    print(f"Attempting to stitch files: {test_files} with {overlap_duration}ms overlap.")
    print(f"Output will be saved to: {stitched_file_path}")

    try:
        result_path = stitch_audio_sections(test_files, overlap_duration, stitched_file_path)

        if result_path:
            print(f"Successfully stitched audio saved to: {result_path}")
            print("You can now try playing this file to verify the stitching.")
        else:
            print("Failed to stitch audio. Check for errors from pydub/ffmpeg above.")
            print("Ensure ffmpeg is installed and in your system PATH, and pydub is installed.")
            
    except Exception as e:
        print(f"An unexpected error occurred during the stitching test: {e}")
        print("Ensure ffmpeg is installed and in your system PATH, and pydub is installed.")

    # Note: The original dummy file creation and cleanup logic is removed 
    # as we are now using user-provided sample files. 