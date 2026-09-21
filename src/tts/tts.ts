// Text-in/WAV-out TTS via a Python subprocess (Kokoro), plus the timeline packer and ffmpeg
// mix/encode described in 03 - Architecture & Data Model §Commentary lines: voice each line
// separately to learn its real duration, pack non-overlapping onto a timeline in tick order,
// drop the lowest-priority line if it won't fit before the next one starts, then one Opus file.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import type { CommentaryLine } from "../commentary/commentary.js";
import { round1 } from "../sim/utils.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");
const PYTHON = join(PROJECT_ROOT, ".venv", "bin", "python3");
const TTS_WORKER = join(PROJECT_ROOT, "scripts", "tts_worker.py");

export interface PackedLine {
  id: number;
  text: string;
  start_s: number;
  end_s: number;
}

async function synthesizeLines(
  lines: CommentaryLine[],
  outDir: string,
): Promise<Map<number, number>> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [TTS_WORKER, outDir]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`tts_worker.py exited ${code}: ${stderr}`));
        return;
      }
      const results = JSON.parse(stdout) as Array<{ id: number; duration_s: number }>;
      resolve(new Map(results.map((r) => [r.id, r.duration_s])));
    });
    proc.on("error", reject);
    proc.stdin.write(JSON.stringify(lines.map((l) => ({ id: l.id, text: l.text }))));
    proc.stdin.end();
  });
}

export function packTimeline(lines: CommentaryLine[], durations: Map<number, number>, tickRate: number): PackedLine[] {
  const items = [...lines].sort((a, b) => a.anchor_tick - b.anchor_tick);
  const result: PackedLine[] = [];
  let cursor = 0;
  let i = 0;

  while (i < items.length) {
    const cur = items[i]!;
    const durationS = durations.get(cur.id) ?? 1.5;
    const anchorS = cur.anchor_tick / tickRate;
    const start = Math.max(anchorS, cursor);
    const end = start + durationS;
    const next = items[i + 1];
    const nextAnchorS = next ? next.anchor_tick / tickRate : Infinity;

    if (next && end > nextAnchorS) {
      // Conflict: cur would still be talking when next's beat happens. Keep whichever has
      // the more urgent (lower) priority number; drop the other.
      if (cur.priority <= next.priority) {
        result.push({ id: cur.id, text: cur.text, start_s: round1(start), end_s: round1(end) });
        cursor = end;
        i += 2; // next is dropped
      } else {
        i += 1; // cur is dropped, re-evaluate next against the same cursor
      }
      continue;
    }

    result.push({ id: cur.id, text: cur.text, start_s: round1(start), end_s: round1(end) });
    cursor = end;
    i += 1;
  }

  return result;
}

async function runFfmpeg(args: string[]): Promise<void> {
  if (!ffmpegPath) throw new Error("ffmpeg-static did not resolve a binary path");
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-2000)}`))));
    proc.on("error", reject);
  });
}

export interface AudioPackage {
  packedLines: PackedLine[];
  audioPath: string;
  captionsPath: string;
  synthesisMs: number;
  encodeMs: number;
}

export async function buildAudioPackage(
  lines: CommentaryLine[],
  tickRate: number,
  outDir: string,
): Promise<AudioPackage> {
  const wavDir = mkdtempSync(join(tmpdir(), "scrapyard-tts-"));
  const t0 = performance.now();
  const durations = await synthesizeLines(lines, wavDir);
  const synthesisMs = performance.now() - t0;

  const packedLines = packTimeline(lines, durations, tickRate);

  const t1 = performance.now();
  const audioPath = join(outDir, "audio.opus");
  const inputArgs = packedLines.flatMap((l) => ["-i", join(wavDir, `${l.id}.wav`)]);
  const delayFilters = packedLines
    .map((l, i) => `[${i}:a]adelay=${Math.round(l.start_s * 1000)}|${Math.round(l.start_s * 1000)}[a${i}]`)
    .join(";");
  const mixInputs = packedLines.map((_, i) => `[a${i}]`).join("");
  const filterComplex =
    packedLines.length > 0
      ? `${delayFilters};${mixInputs}amix=inputs=${packedLines.length}:duration=longest:normalize=0[out]`
      : "anullsrc=r=24000:cl=mono[out]";

  await runFfmpeg([
    "-y",
    ...(packedLines.length > 0 ? inputArgs : ["-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "1"]),
    "-filter_complex",
    filterComplex,
    "-map",
    "[out]",
    "-c:a",
    "libopus",
    "-b:a",
    "28k",
    audioPath,
  ]);
  const encodeMs = performance.now() - t1;

  const captionsPath = join(outDir, "captions.json");
  writeFileSync(
    captionsPath,
    JSON.stringify(packedLines.map((l) => ({ start_ms: Math.round(l.start_s * 1000), end_ms: Math.round(l.end_s * 1000), text: l.text }))),
  );

  rmSync(wavDir, { recursive: true, force: true });

  return { packedLines, audioPath, captionsPath, synthesisMs, encodeMs };
}

export function readCaptions(captionsPath: string): Array<{ start_ms: number; end_ms: number; text: string }> {
  return JSON.parse(readFileSync(captionsPath, "utf8"));
}
