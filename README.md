# ScrapYard

Silly weapon-fight arena: two weapons bounce around a square arena with real physics, viewers
vote on the next matchup, and an AI-generated announcer calls the action over a replay.

Full spec lives in Obsidian: `01 - Product Vision & Scope`, `02 - Tech Stack Options`,
`03 - Architecture & Data Model`, `05 - Roadmap & Phases`.

## Status

**Phase 0 — production spike, done pending Mike's Gate 0.11 listening check.**

All 11 of Gate 0's metrics pass. Sim, digest, commentary (Groq), and TTS (Kokoro) all work
end-to-end. See `05 - Roadmap & Phases` for thresholds and `00 - ScrapYard Overview`'s Status
Log for the actual numbers.

## Setup

```
npm install
python3 -m venv .venv && source .venv/bin/activate && pip install kokoro-onnx soundfile
mkdir models && cd models
curl -sLO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.int8.onnx
curl -sLO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin
```

`SCRAPYARD_LLM_API_KEY` (Groq) is required for real commentary — pull it from Infisical, never
hardcode it: `infisical run -- npm run <script>`. Without it, commentary silently falls back to
a deterministic template (by design — see `src/commentary/commentary.ts`).

## Running it

```
npm run sim -- <seed> <weaponA> <weaponB>       # one fight, writes out/<fight_id>.map.json
npm run balance -- <N>                           # Gate 0.1-0.7 harness, N fights (default 100)
npm run commentary -- <seed> <weaponA> <weaponB> # digest + commentary for one fight
npm run commentary-gate                          # Gate 0.9, 5 fights
npm run tts -- <seed> <weaponA> <weaponB>        # full commentary + audio.opus + captions.json
npm run pipeline-gate                            # Gate 0.8 + 0.10, 3 fights end-to-end
npm test                                          # unit tests (digest.test.ts)
```

Weapon ids: `axe`, `sword`, `mace`, `spear`.
