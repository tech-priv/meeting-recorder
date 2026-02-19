#!/usr/bin/env python3
"""
whisper_transcribe.py — called by Electron main process
Returns JSON: { "text": "...", "segments": [...], "srt": "..." }
"""
import sys
import json
import argparse

def format_srt_time(seconds):
    ms = int((seconds % 1) * 1000)
    s  = int(seconds) % 60
    m  = int(seconds // 60) % 60
    h  = int(seconds // 3600)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"

def segments_to_srt(segments):
    lines = []
    for i, seg in enumerate(segments, start=1):
        start = format_srt_time(seg["start"])
        end   = format_srt_time(seg["end"])
        text  = seg["text"].strip()
        lines.append(f"{i}\n{start} --> {end}\n{text}\n")
    return "\n".join(lines)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path")
    parser.add_argument("--model", default="base",
                        choices=["tiny", "base", "small", "medium", "large"])
    args = parser.parse_args()

    try:
        import whisper
    except ImportError:
        print(json.dumps({"error": "openai-whisper not installed. Run: pip3 install openai-whisper"}))
        sys.exit(1)

    model = whisper.load_model(args.model)
    result = model.transcribe(args.audio_path, verbose=False)

    segments = result.get("segments", [])
    plain_text = " ".join(s["text"].strip() for s in segments)
    srt = segments_to_srt(segments)

    output = {
        "text": plain_text,
        "srt": srt,
        "segments": [
            {"start": s["start"], "end": s["end"], "text": s["text"].strip()}
            for s in segments
        ]
    }
    print(json.dumps(output))

if __name__ == "__main__":
    main()
