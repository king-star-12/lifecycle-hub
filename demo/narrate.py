#!/usr/bin/env python3
"""
Renders narration with Kokoro (local neural TTS) and writes the timing map the
recorder uses to pace the picture.

    KVOICE=af_heart KSPEED=1.08 python3 narrate.py
    python3 narrate.py --sample "One line to compare voices."

Reads  script.json   [{ "id": "01", "beat": "...", "text": "..." }, ...]
Writes audio/<voice>/NN.wav  and  timings.json
"""
import json
import os
import sys

# The bundled espeak wheels bake in their build machine's data path, so point
# everything at a real install BEFORE the TTS stack is imported. See
# references/setup.md — this is the single most likely thing to break.
ESPEAK_LIB = os.environ.get("ESPEAK_LIB", "/opt/homebrew/lib/libespeak-ng.dylib")
ESPEAK_SHARE = os.environ.get("ESPEAK_SHARE", "/opt/homebrew/share")
os.environ.setdefault("PHONEMIZER_ESPEAK_LIBRARY", ESPEAK_LIB)
os.environ.setdefault("ESPEAK_DATA_PATH", ESPEAK_SHARE)

import warnings
warnings.filterwarnings("ignore")

from phonemizer.backend.espeak.wrapper import EspeakWrapper
EspeakWrapper.set_library(ESPEAK_LIB)
try:
    EspeakWrapper.set_data_path(os.path.join(ESPEAK_SHARE, "espeak-ng-data"))
except Exception:
    pass  # Older phonemizer builds have no setter; the env vars carry it.

import numpy as np
import soundfile as sf
from kokoro import KPipeline

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("DEMO_DIR", os.getcwd())
VOICE = os.environ.get("KVOICE", "af_heart")
SPEED = float(os.environ.get("KSPEED", "1.08"))
SAMPLE_RATE = 24_000

# A breath after each line so beats do not run into each other, plus a little
# air in the timing so the picture is never cut off mid-word.
BREATH = float(os.environ.get("KBREATH", "0.22"))
AIR = float(os.environ.get("KAIR", "0.62"))


def synth(pipe, text):
    parts = [audio for _, _, audio in pipe(text, voice=VOICE, speed=SPEED)]
    if not parts:
        raise RuntimeError("Kokoro returned no audio — check the espeak setup")
    return np.concatenate(parts)


def main():
    pipe = KPipeline(lang_code=os.environ.get("KLANG", "a"))

    if "--sample" in sys.argv:
        text = sys.argv[sys.argv.index("--sample") + 1]
        out = os.path.join(ROOT, "samples")
        os.makedirs(out, exist_ok=True)
        path = os.path.join(out, f"{VOICE}.wav")
        wav = synth(pipe, text)
        sf.write(path, wav, SAMPLE_RATE)
        print(f"{VOICE:<14} {len(wav) / SAMPLE_RATE:5.2f}s  {path}")
        return

    segments = json.load(open(os.path.join(ROOT, "script.json")))
    out_dir = os.path.join(ROOT, "audio", VOICE)
    os.makedirs(out_dir, exist_ok=True)

    timings, total = {}, 0.0
    for seg in segments:
        wav = synth(pipe, seg["text"])
        wav = np.concatenate([wav, np.zeros(int(SAMPLE_RATE * BREATH), dtype=wav.dtype)])
        sf.write(os.path.join(out_dir, seg["id"] + ".wav"), wav, SAMPLE_RATE)

        spoken = len(wav) / SAMPLE_RATE
        timings[seg["id"]] = round(spoken + AIR, 3)
        total += timings[seg["id"]]
        print(f"  {seg['id']}  {spoken:6.2f}s  {seg.get('beat', '')}")

    json.dump(timings, open(os.path.join(ROOT, "timings.json"), "w"), indent=1)
    print(f"\n  voice {VOICE} @ {SPEED}x")
    print(f"  film length {total:.1f}s  ({int(total // 60)}:{int(total % 60):02d})")
    print("  Adjust KSPEED and re-run if that overshoots your limit — audio is cheap,")
    print("  re-recording is not.")


if __name__ == "__main__":
    main()
