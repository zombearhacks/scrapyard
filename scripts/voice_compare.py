#!/usr/bin/env python3
"""One-off: synthesize the same line in several candidate voices for an A/B listen."""
import os
from kokoro_onnx import Kokoro
import soundfile as sf

MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "kokoro-v1.0.int8.onnx")
VOICES_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "voices-v1.0.bin")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "out", "voice-compare")

LINE = "OHHHH! The Axe drops the hammer — FIRST BLOOD! This crowd is on its feet!"
CANDIDATES = [
    ("am_puck", 1.05),
    ("am_fenrir", 1.1),
    ("am_onyx", 1.1),
    ("am_michael", 1.15),
    ("am_adam", 1.1),
    ("am_echo", 1.1),
]

os.makedirs(OUT_DIR, exist_ok=True)
kokoro = Kokoro(MODEL_PATH, VOICES_PATH)
for voice, speed in CANDIDATES:
    samples, sr = kokoro.create(LINE, voice=voice, speed=speed, lang="en-us")
    path = os.path.join(OUT_DIR, f"{voice}.wav")
    sf.write(path, samples, sr)
    print(f"{voice} (speed {speed}) -> {path}")
