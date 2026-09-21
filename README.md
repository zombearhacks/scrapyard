# ScrapYard

Silly weapon-fight arena: two weapons bounce around a square arena with real physics, viewers
vote on the next matchup, and an AI-generated announcer calls the action over a replay.

Full spec lives in Obsidian: `01 - Product Vision & Scope`, `02 - Tech Stack Options`,
`03 - Architecture & Data Model`, `05 - Roadmap & Phases`.

## Status

**Phase 0 — production spike, in progress.**

Sim package (`src/sim/`) and balance harness (`scripts/balance_harness.ts`) are done and
passing Gate 0's seven physics-only metrics (0.1–0.7): CPU time, determinism, termination,
duration distribution, weapon balance, matchup spread, map size. See `05 - Roadmap & Phases`
for thresholds.

Still open: `derive_digest()`, commentary generation + validator, TTS/ffmpeg packing
(Gate 0.8–0.11).

## Running it

```
npm install
npm run sim -- <seed> <weaponA> <weaponB>   # one fight, writes out/<fight_id>.map.json
npm run balance -- <N>                       # Gate 0 harness, N fights (default 100)
```

Weapon ids: `axe`, `sword`, `mace`, `spear`.
