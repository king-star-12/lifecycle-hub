#!/usr/bin/env python3
"""
Lays narration onto a recorded session.

    KVOICE=af_heart python3 mux.py session.webm out.mp4

Each line is placed at the timestamp its beat actually began during recording
(from beats.json), so a slow page load cannot push the voice out of step.
"""
import json
import os
import subprocess
import sys

ROOT = os.environ.get("DEMO_DIR", os.getcwd())
VOICE = os.environ.get("KVOICE", "af_heart")
MAXLEN = os.environ.get("MAXLEN")  # e.g. "179.6" to stay under a 3:00 cap

session = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "session.webm")
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "demo.mp4")

beats = json.load(open(os.path.join(ROOT, "beats.json")))
segments = json.load(open(os.path.join(ROOT, "script.json")))
audio_dir = os.path.join(ROOT, "audio", VOICE)

inputs = ["-i", session]
graph, labels = [], []
for index, seg in enumerate(segments, start=1):
    wav = os.path.join(audio_dir, seg["id"] + ".wav")
    if seg["id"] not in beats:
        raise SystemExit(f"beat {seg['id']} missing from beats.json — re-record")
    inputs += ["-i", wav]
    delay = int(round(beats[seg["id"]] * 1000))
    graph.append(f"[{index}:a]aresample=48000,adelay={delay}|{delay}[n{index}]")
    labels.append(f"[n{index}]")

graph.append(
    "".join(labels)
    + f"amix=inputs={len(labels)}:normalize=0,"
    # Even out the reading, then keep peaks off the ceiling.
    "dynaudnorm=f=250:g=7:p=0.9,alimiter=level_in=1:limit=0.92,apad[aout]"
)

# Screencast webm carries no duration header, so -shortest (not -t) bounds it.
cmd = ["ffmpeg", "-y", *inputs,
       "-filter_complex", ";".join(graph),
       "-map", "0:v", "-map", "[aout]", "-shortest"]
if MAXLEN:
    cmd += ["-t", MAXLEN]
cmd += ["-c:v", "libx264", "-preset", "slow", "-crf", "20",
        "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", out]

subprocess.run(cmd, check=True)
print("wrote", out)
