from pydub import AudioSegment

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
    if not section_files:
        return None

    try:
        # Load the first section
        stitched_audio = AudioSegment.from_file(section_files[0])

        if len(section_files) > 1:
            for i in range(1, len(section_files)):
                next_section = AudioSegment.from_file(section_files[i])
                # Apply crossfade: the overlap_ms is the duration of the crossfade
                # The first track is shortened by overlap_ms, and the second track is faded in over overlap_ms
                stitched_audio = stitched_audio.append(next_section, crossfade=overlap_ms)
        
        stitched_audio.export(output_path, format="wav")
        return output_path
    except Exception as e:
        print(f"Error during audio stitching: {e}")
        # Consider logging the error to a file or more robust logging system
        # import logging
        # logging.error(f"Error stitching audio: {e}", exc_info=True)
        return None

if __name__ == '__main__':
    import os

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