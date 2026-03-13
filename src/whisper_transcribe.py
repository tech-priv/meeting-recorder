#!/usr/bin/env python3
"""
whisper_transcribe.py
=====================
Subprocess helper called by Electron main.js to perform local Whisper transcription.

Called as:
    python3 whisper_transcribe.py <audio_path> [--model base]

Stdout contract:
    Exactly ONE line of JSON on exit, preceded by the sentinel marker:
        __WHISPER_JSON_START__
        {"text": "...", "srt": "...", "segments": [...]}

    main.js searches for this sentinel in stdout so that any stray print()
    output from Whisper internals (e.g. "Detected language: English") cannot
    corrupt the JSON parse.  Everything else is redirected to stderr.

Stderr:
    All Whisper loading/progress messages.  main.js captures these and writes
    them to pipeline.log, and also streams them live to the renderer via IPC.

Exit codes:
    0  success
    1  fatal error (JSON error object printed to stdout before exit)

Root cause of the old "Detected language" parse failure:
    Some Whisper versions (notably 20231117+) call tqdm.write() and plain
    print() on sys.stdout even when verbose=False.  Redirecting sys.stdout to
    sys.stderr while Whisper runs, and only restoring it for our final print,
    ensures stdout stays clean.

Dependencies:
    pip install openai-whisper   (or:  pip3 install openai-whisper)
"""

import sys
import json
import argparse
import io


# ─── SRT helpers ──────────────────────────────────────────────────────────────

def format_srt_time(seconds: float) -> str:
    """
    Convert a float number of seconds to SRT timestamp format HH:MM:SS,mmm.

    Args:
        seconds: time offset in seconds (float)
    Returns:
        e.g. "00:01:33,750"
    """
    ms = int((seconds % 1) * 1000)
    s  = int(seconds)       % 60
    m  = int(seconds // 60) % 60
    h  = int(seconds // 3600)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def segments_to_srt(segments: list) -> str:
    """
    Convert a list of Whisper segment dicts to a full SRT file string.

    Args:
        segments: list of {'start': float, 'end': float, 'text': str}
    Returns:
        Complete SRT content as a string
    """
    lines = []
    for i, seg in enumerate(segments, start=1):
        start = format_srt_time(seg["start"])
        end   = format_srt_time(seg["end"])
        text  = seg["text"].strip()
        lines.append(f"{i}\n{start} --> {end}\n{text}\n")
    return "\n".join(lines)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    """
    Transcribe the given audio file with Whisper and write JSON to stdout.

    The key invariant: sys.stdout is redirected to sys.stderr for the entire
    duration of whisper.load_model() and model.transcribe().  This catches
    ALL stray print() calls inside Whisper and its dependencies (tqdm, torch,
    ffmpeg subprocess lines, "Detected language: …", etc.) and sends them to
    stderr instead.  Only our explicit final print() statement writes to the
    real stdout.
    """
    parser = argparse.ArgumentParser(
        description="Transcribe audio with local Whisper and output JSON."
    )
    parser.add_argument("audio_path", help="Path to the audio file (WAV recommended)")
    parser.add_argument(
        "--model", default="base",
        choices=["tiny", "base", "small", "medium", "large"],
        help="Whisper model size (default: base)"
    )
    args = parser.parse_args()

    # Save a reference to the real stdout file descriptor before we redirect it.
    # We use os.dup / os.fdopen so even C-level writes (e.g. from torch) go to stderr.
    import os
    real_stdout_fd = os.dup(sys.stdout.fileno())   # duplicate fd 1
    real_stdout    = os.fdopen(real_stdout_fd, 'w', buffering=1)

    # Redirect fd 1 (stdout) to fd 2 (stderr) at the OS level.
    # This ensures ALL output — Python print(), C printf(), tqdm — goes to stderr.
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())

    # Also redirect the Python-level sys.stdout object so that our own code
    # that calls print() before the final step also goes to stderr.
    _original_stdout = sys.stdout
    sys.stdout = sys.stderr

    try:
        import whisper
    except ImportError:
        # Restore stdout so we can deliver the error JSON properly
        sys.stdout = _original_stdout
        os.dup2(real_stdout_fd, 1)
        real_stdout.write(json.dumps({
            "error": "openai-whisper is not installed. Fix: pip install openai-whisper"
        }) + "\n")
        real_stdout.flush()
        sys.exit(1)

    try:
        # Load model — downloads weights on first use, logs to stderr
        print(f"[whisper] Loading model '{args.model}'…", file=sys.stderr, flush=True)
        model = whisper.load_model(args.model)

        # Transcribe — verbose=False still leaks some lines in certain versions,
        # but they all go to stderr now because we redirected stdout above.
        print(f"[whisper] Starting transcription of {args.audio_path}", file=sys.stderr, flush=True)
        result = model.transcribe(args.audio_path, verbose=False)

        segments    = result.get("segments", [])
        plain_text  = " ".join(s["text"].strip() for s in segments)
        srt_content = segments_to_srt(segments)

        output = {
            "text": plain_text,
            "srt":  srt_content,
            "segments": [
                {
                    "start": round(s["start"], 3),
                    "end":   round(s["end"],   3),
                    "text":  s["text"].strip()
                }
                for s in segments
            ]
        }

        print(f"[whisper] Done — {len(segments)} segments", file=sys.stderr, flush=True)

        # Restore real stdout and write the sentinel + JSON.
        # The sentinel lets main.js locate the JSON even if anything else
        # managed to slip through to stdout.
        sys.stdout = _original_stdout
        os.dup2(real_stdout_fd, 1)

        real_stdout.write("__WHISPER_JSON_START__\n")
        real_stdout.write(json.dumps(output, ensure_ascii=False) + "\n")
        real_stdout.flush()

    except Exception as exc:
        # Restore real stdout so main.js gets the error JSON
        sys.stdout = _original_stdout
        try:
            os.dup2(real_stdout_fd, 1)
        except Exception:
            pass

        import traceback
        print(f"[whisper] FATAL: {exc}", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)

        real_stdout.write("__WHISPER_JSON_START__\n")
        real_stdout.write(json.dumps({"error": str(exc)}) + "\n")
        real_stdout.flush()
        sys.exit(1)

    finally:
        real_stdout.close()


if __name__ == "__main__":
    main()
