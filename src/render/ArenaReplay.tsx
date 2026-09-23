"use client";

import { useEffect, useRef, useState } from "react";
import type { FightEvent, FightMap } from "../sim/types";
import { weaponRadius } from "../sim/weapons";
import { WEAPON_ICON_PATHS, WEAPON_ICON_VIEWBOX } from "./weaponIcons";

interface Caption {
  start_ms: number;
  end_ms: number;
  text: string;
}

const CANVAS_SIZE = 640;
const SPARK_LIFE_S = 0.4;
const WALL_FLASH_LIFE_S = 0.18;

const COLORS = {
  axe: "#e2703a",
  spear: "#3fc1d6",
  sword: "#e2703a",
  mace: "#3fc1d6",
  spark: "#ffd35c",
  line: "#232838",
  floor: "#0e1119",
} as const;
// Only 4 weapons exist; a fixed color pair per matchup slot keeps this simple. Slot 0 always
// reads warm (axe/sword-style), slot 1 always reads cool (spear/mace-style) — arbitrary but
// consistent, and it's what the demo artifact already established.
function colorForSlot(slot: 0 | 1): string {
  return slot === 0 ? COLORS.axe : COLORS.spear;
}

function narrativeLine(ev: FightEvent, map: FightMap): string | null {
  const name = (slot: 0 | 1) => map.fighters[slot].display_name;
  switch (ev.type) {
    case "fight_start":
      return `Fight begins — first to ${map.rules.target_strikes} strikes.`;
    case "strike":
      return `${name(ev.actor)} lands a hit on ${name(ev.target)}! ${ev.score_after[0]}–${ev.score_after[1]}`;
    case "clash":
      return `${name(ev.actor)} swings — ${name(ev.target)} blocks it.`;
    case "spell_proc": {
      const byEffect: Record<string, string> = {
        knockback: `${name(ev.actor)}’s cleave connects — knockback!`,
        stagger: `${name(ev.actor)}’s strike staggers the opponent!`,
        quick_recovery: `${name(ev.actor)} recovers in a flash — riposte!`,
        reach: `${name(ev.actor)} lunges forward!`,
      };
      return byEffect[ev.effect] ?? `${name(ev.actor)} triggers ${ev.spell}.`;
    }
    case "fight_end": {
      const o = map.outcome;
      return o.winner_slot === null
        ? `Fight over — it’s a tie, ${o.final_score[0]}–${o.final_score[1]}!`
        : `Fight over — ${name(o.winner_slot)} wins ${o.final_score[0]}–${o.final_score[1]}!`;
    }
    default:
      return null;
  }
}

export function ArenaReplay({ fixtureBase = "/fixtures/demo" }: { fixtureBase?: string }) {
  const [map, setMap] = useState<FightMap | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const [activeCaption, setActiveCaption] = useState<string>("");
  const [ticker, setTicker] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const iconCacheRef = useRef<Map<string, Path2D>>(new Map());
  const rafRef = useRef<number | null>(null);
  const speedRef = useRef(1);
  const playingRef = useRef(true);
  const tickerCountRef = useRef(-1);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    Promise.all([
      fetch(`${fixtureBase}/map.json`).then((r) => {
        if (!r.ok) throw new Error(`map.json ${r.status}`);
        return r.json() as Promise<FightMap>;
      }),
      fetch(`${fixtureBase}/captions.json`).then((r) => {
        if (!r.ok) throw new Error(`captions.json ${r.status}`);
        return r.json() as Promise<Caption[]>;
      }),
    ])
      .then(([m, c]) => {
        setMap(m);
        setCaptions(c);
      })
      .catch((e) => setLoadError(String(e)));
  }, [fixtureBase]);

  // Seek support (Gate 1.4): ?t=45 starts 45s in with correct position/score/audio offset.
  useEffect(() => {
    if (!map || !audioRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const t = Number(params.get("t"));
    if (t > 0) audioRef.current.currentTime = t;
  }, [map]);

  useEffect(() => {
    if (!map) return;
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scale = CANVAS_SIZE / map.arena.w;
    const radii: [number, number] = [weaponRadius(map.fighters[0].attrs.size), weaponRadius(map.fighters[1].attrs.size)];
    const tickRate = map.tick_rate;
    const sampleRate = map.sample_rate;
    const totalSamples = map.tracks.samples;
    const durationSec = map.outcome.duration_ticks / tickRate;
    const events = [...map.events].sort((a, b) => a.t - b.t);
    const narrativeEvents = events.map((e) => ({ ev: e, line: narrativeLine(e, map) })).filter((x) => x.line !== null);

    function iconPath(weaponId: string): Path2D {
      let p = iconCacheRef.current.get(weaponId);
      if (!p) {
        p = new Path2D(WEAPON_ICON_PATHS[weaponId]);
        iconCacheRef.current.set(weaponId, p);
      }
      return p;
    }

    function sampleAt(track: number[], idx: number) {
      const base = idx * 4;
      return { x: track[base]!, y: track[base + 1]!, rot: track[base + 2]!, swing: track[base + 3]! };
    }

    function drawFighter(pos: { x: number; y: number; rot: number; swing: number }, slot: 0 | 1) {
      if (!ctx) return;
      const cx = pos.x * scale;
      const cy = pos.y * scale;
      const r = radii[slot] * scale;
      const c = colorForSlot(slot);
      const glow = pos.swing === 2 ? 1 : pos.swing === 1 ? 0.5 : pos.swing === 3 ? 0.2 : 0;
      const weaponId = map!.fighters[slot].weapon_id;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.22;
      ctx.fill();
      ctx.restore();

      ctx.save();
      if (glow > 0) {
        ctx.shadowColor = c;
        ctx.shadowBlur = 20 * glow;
      }
      const ang = pos.rot + Math.PI / 2;
      const iconScale = (r * 2.6) / WEAPON_ICON_VIEWBOX;
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.scale(iconScale, iconScale);
      ctx.translate(-WEAPON_ICON_VIEWBOX / 2, -WEAPON_ICON_VIEWBOX / 2);
      ctx.fillStyle = pos.swing === 2 ? COLORS.spark : c;
      ctx.globalAlpha = pos.swing === 2 ? 1 : 0.92;
      ctx.fill(iconPath(weaponId));
      ctx.restore();
    }

    function render(t: number) {
      if (!ctx) return;
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.fillStyle = COLORS.floor;
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.strokeStyle = COLORS.line;
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, CANVAS_SIZE - 2, CANVAS_SIZE - 2);

      for (const ev of events) {
        if (ev.type !== "wall_bounce") continue;
        const et = ev.t / tickRate;
        if (et > t || t - et > WALL_FLASH_LIFE_S) continue;
        const alpha = 1 - (t - et) / WALL_FLASH_LIFE_S;
        ctx.save();
        ctx.globalAlpha = alpha * 0.6;
        ctx.strokeStyle = colorForSlot(ev.actor);
        ctx.lineWidth = 6;
        const m = 3;
        ctx.beginPath();
        if (ev.wall === "n") {
          ctx.moveTo(m, m);
          ctx.lineTo(CANVAS_SIZE - m, m);
        } else if (ev.wall === "s") {
          ctx.moveTo(m, CANVAS_SIZE - m);
          ctx.lineTo(CANVAS_SIZE - m, CANVAS_SIZE - m);
        } else if (ev.wall === "w") {
          ctx.moveTo(m, m);
          ctx.lineTo(m, CANVAS_SIZE - m);
        } else {
          ctx.moveTo(CANVAS_SIZE - m, m);
          ctx.lineTo(CANVAS_SIZE - m, CANVAS_SIZE - m);
        }
        ctx.stroke();
        ctx.restore();
      }

      const idx = Math.max(0, Math.min(totalSamples - 1, Math.floor(t * sampleRate)));
      drawFighter(sampleAt(map!.tracks.data[0], idx), 0);
      drawFighter(sampleAt(map!.tracks.data[1], idx), 1);

      for (const ev of events) {
        if (ev.type !== "strike") continue;
        const et = ev.t / tickRate;
        if (et > t || t - et > SPARK_LIFE_S) continue;
        const progress = (t - et) / SPARK_LIFE_S;
        const sx = ev.at[0] * scale;
        const sy = ev.at[1] * scale;
        ctx.save();
        ctx.globalAlpha = 1 - progress;
        ctx.strokeStyle = COLORS.spark;
        ctx.lineWidth = 3;
        const burstR = 6 + progress * 26;
        for (let k = 0; k < 6; k++) {
          const a2 = (k / 6) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(sx + Math.cos(a2) * burstR * 0.5, sy + Math.sin(a2) * burstR * 0.5);
          ctx.lineTo(sx + Math.cos(a2) * burstR, sy + Math.sin(a2) * burstR);
          ctx.stroke();
        }
        ctx.restore();
      }

      let a = 0;
      let b = 0;
      for (const ev of events) {
        if (ev.t / tickRate > t) break;
        if (ev.type === "strike") {
          a = ev.score_after[0];
          b = ev.score_after[1];
        }
      }
      setScore((prev) => (prev[0] === a && prev[1] === b ? prev : [a, b]));

      const visible = narrativeEvents.filter((x) => x.ev.t / tickRate <= t);
      if (visible.length !== tickerCountRef.current) {
        tickerCountRef.current = visible.length;
        setTicker(visible.slice(-5).map((x) => x.line!));
      }

      const cap = captions.find((c) => t * 1000 >= c.start_ms && t * 1000 <= c.end_ms);
      setActiveCaption(cap?.text ?? "");

      if (t >= durationSec && !finished) setFinished(true);
    }

    function frame() {
      const t = audio.currentTime;
      render(Math.min(t, durationSec));
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, captions]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = speed;
    if (playing) void audio.play().catch(() => {});
    else audio.pause();
  }, [playing, speed]);

  if (loadError) return <p style={{ color: "#e0596b", padding: 20 }}>Failed to load fixture: {loadError}</p>;
  if (!map) return <p style={{ padding: 20, color: "#7d8494" }}>Loading fight…</p>;

  const fighterA = map.fighters[0].display_name;
  const fighterB = map.fighters[1].display_name;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "20px 16px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ margin: 0, fontSize: 22, textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {fighterA} vs {fighterB}
      </h1>
      <div style={{ display: "flex", gap: 12, fontVariantNumeric: "tabular-nums", fontSize: 32, fontWeight: 700 }}>
        <span style={{ color: colorForSlot(0) }}>{score[0]}</span>
        <span style={{ color: "#4d5566" }}>–</span>
        <span style={{ color: colorForSlot(1) }}>{score[1]}</span>
      </div>
      <div style={{ width: "100%", maxWidth: CANVAS_SIZE, aspectRatio: "1 / 1", position: "relative" }}>
        <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} style={{ width: "100%", height: "100%", borderRadius: 10, border: "1px solid #232838" }} />
        {finished && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(8,9,13,0.72)",
              borderRadius: 10,
              fontSize: 24,
              fontWeight: 700,
              color: "#57d38c",
              textAlign: "center",
              padding: 20,
            }}
          >
            {map.outcome.winner_slot === null
              ? `It’s a tie — ${map.outcome.final_score.join("–")}`
              : `${map.fighters[map.outcome.winner_slot].display_name.toUpperCase()} WINS — ${map.outcome.final_score.join("–")}`}
          </div>
        )}
      </div>
      <div style={{ minHeight: 24, fontSize: 14, color: "#eef1f6", textAlign: "center" }}>{activeCaption}</div>
      <audio ref={audioRef} src={`${fixtureBase}/audio.opus`} autoPlay />
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
        <button
          onClick={() => {
            if (audioRef.current) audioRef.current.currentTime = 0;
            setFinished(false);
            tickerCountRef.current = -1;
            setTicker([]);
            setPlaying(true);
          }}
        >
          Restart
        </button>
        <button onClick={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 4 : 1))}>{speed}× speed</button>
      </div>
      <div style={{ width: "100%", maxWidth: CANVAS_SIZE, fontSize: 13, color: "#7d8494", lineHeight: 1.6 }}>
        {ticker.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}
