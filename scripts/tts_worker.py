#!/usr/bin/env python3
"""TTS worker — text in, WAV out. Called as a subprocess from src/tts/tts.ts.

Reads a JSON array of {id, text} from stdin. For each line, synthesizes with
Kokoro and writes <out_dir>/<id>.wav. Prints a JSON array of
{id, duration_s} to stdout — the real, measured duration each line takes to
speak, which is what the timeline packer needs (03: "voice each line
separately so we learn its real duration, then pack").
"""

import json
import sys
import os
from kokoro_onnx import Kokoro
import soundfile as sf

VOICE = "am_puck"
MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "kokoro-v1.0.int8.onnx")
VOICES_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "voices-v1.0.bin")


def main():
    lines = json.load(sys.stdin)
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)

    kokoro = Kokoro(MODEL_PATH, VOICES_PATH)
    results = []
    for line in lines:
        samples, sample_rate = kokoro.create(line["text"], voice=VOICE, speed=1.05, lang="en-us")
        path = os.path.join(out_dir, f"{line['id']}.wav")
        sf.write(path, samples, sample_rate)
        duration_s = len(samples) / sample_rate
        results.append({"id": line["id"], "duration_s": round(duration_s, 3)})

    print(json.dumps(results))


if __name__ == "__main__":
    main()
