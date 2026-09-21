// 01's third open question, answered in 03: the LLM sees only the digest, never the raw event
// map, and every line it writes must cite a real beat by index — not a tick it invents. This
// is what makes success criterion #5 ("recognizably reacting to what happened, not generic
// filler") structurally true rather than hoped for: a line either points at a real beat or it
// gets dropped, never retried. If every line fails (or the call fails at all), a deterministic
// template keeps the fight from ever going silent — see 03 "Commentary lines".

import { z } from "zod";
import type { BeatKind, FightDigest } from "./digest.js";

export const COMMENTARY_SCHEMA_VERSION = "scrapyard.commentary/1" as const;

export interface CommentaryLine {
  id: number;
  anchor_tick: number;
  beat_ref: number[];
  priority: number; // lower = kept first when TTS packing has to drop a line for time
  text: string;
}

export interface CommentaryDoc {
  schema: typeof COMMENTARY_SCHEMA_VERSION;
  fight_id: string;
  lines: CommentaryLine[];
}

const MODEL = "openai/gpt-oss-20b"; // Groq, free tier, production status as of 2026-09
const MAX_LINE_CHARS = 200;
const REQUEST_TIMEOUT_MS = 15000;

const rawLineSchema = z.object({
  beat_index: z.number().int(),
  text: z.string().min(1),
});
const rawResponseSchema = z.array(rawLineSchema);

const PRIORITY_BY_KIND: Record<BeatKind, number> = {
  finishing_blow: 0,
  match_point: 1,
  first_blood: 1,
  comeback: 1,
  streak: 2,
  biggest_hit: 2,
  near_miss: 2,
  stall: 3,
};

function systemPrompt(): string {
  return [
    "You are the announcer for ScrapYard, a silly arena show where personified weapons fight each other.",
    "Tone: over-the-top wrestling/sports commentary, campy and funny, never generic filler.",
    "You will be given a numbered list of 'beats' — real, verified facts about what happened in one fight.",
    "Write a short commentary line for some or all of the beats. Rules, all mandatory:",
    "1. Every line MUST reference exactly one beat by its index (0-based) from the list you were given.",
    "2. Never invent an event, a name, or a detail that isn't in the beat you're citing.",
    "3. Each line must be under 160 characters — this gets read aloud, keep it punchy.",
    "4. Output ONLY a JSON array, nothing else: no markdown fences, no prose before or after.",
    '   Format: [{"beat_index": 0, "text": "..."}, {"beat_index": 2, "text": "..."}]',
  ].join("\n");
}

function userPrompt(digest: FightDigest): string {
  const fighterLines = digest.fighters.map((f) => `- ${f.name}: ${f.style}`).join("\n");
  const beatLines = digest.beats
    .map((b, i) => `${i}. [${b.kind}] ${JSON.stringify(b.facts)}`)
    .join("\n");
  return [
    `Fighters:\n${fighterLines}`,
    `Final result: ${digest.final.winner} wins ${digest.final.score[0]}-${digest.final.score[1]} in ${digest.final.duration_s}s (headline: ${digest.headline})`,
    `Beats:\n${beatLines}`,
  ].join("\n\n");
}

async function callGroq(digest: FightDigest): Promise<z.infer<typeof rawResponseSchema> | null> {
  const apiKey = process.env.SCRAPYARD_LLM_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt() },
          { role: "user", content: userPrompt(digest) },
        ],
        temperature: 0.9,
        max_tokens: 2000, // gpt-oss-20b is a reasoning model; hidden reasoning tokens eat the budget before content
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      if (process.env.DEBUG_COMMENTARY) console.error("DEBUG: HTTP", res.status, await res.text());
      return null;
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      if (process.env.DEBUG_COMMENTARY) console.error("DEBUG: no content", JSON.stringify(data).slice(0, 500));
      return null;
    }

    const match = content.match(/\[[\s\S]*\]/);
    if (!match) {
      if (process.env.DEBUG_COMMENTARY) console.error("DEBUG: no JSON array found in content:", content.slice(0, 800));
      return null;
    }

    const parsed = rawResponseSchema.safeParse(JSON.parse(match[0]));
    if (!parsed.success && process.env.DEBUG_COMMENTARY) {
      console.error("DEBUG: schema parse failed:", JSON.stringify(parsed.error.issues).slice(0, 500), "raw:", match[0].slice(0, 500));
    }
    return parsed.success ? parsed.data : null;
  } catch (err) {
    if (process.env.DEBUG_COMMENTARY) console.error("DEBUG: exception", err);
    return null;
  }
}

function validateAndBuild(digest: FightDigest, raw: z.infer<typeof rawResponseSchema>): CommentaryDoc {
  const seen = new Set<number>();
  const lines: CommentaryLine[] = [];

  for (const item of raw) {
    if (item.beat_index < 0 || item.beat_index >= digest.beats.length) continue;
    if (seen.has(item.beat_index)) continue;
    const text = item.text.trim();
    if (text.length === 0 || text.length > MAX_LINE_CHARS) continue;

    seen.add(item.beat_index);
    const beat = digest.beats[item.beat_index]!;
    lines.push({
      id: lines.length + 1,
      anchor_tick: beat.t,
      beat_ref: beat.event_ids,
      priority: PRIORITY_BY_KIND[beat.kind],
      text,
    });
  }

  lines.sort((a, b) => a.anchor_tick - b.anchor_tick);
  lines.forEach((l, i) => (l.id = i + 1));
  return { schema: COMMENTARY_SCHEMA_VERSION, fight_id: digest.fight_id, lines };
}

const FALLBACK_TEMPLATES: Record<BeatKind, (facts: Record<string, unknown>) => string> = {
  first_blood: (f) => `${f.actor} draws first blood!`,
  finishing_blow: (f) => {
    const final = f.final as [number, number];
    return `${f.actor} finishes it! Final score: ${final[0]}-${final[1]}!`;
  },
  match_point: (f) => `${f.actor} is one hit from victory!`,
  streak: (f) => `${f.actor} is on a ${f.count}-hit streak!`,
  comeback: (f) => `${f.actor} claws back from a ${f.from_deficit}-point deficit!`,
  biggest_hit: (f) => `${f.actor} lands the hardest hit of the fight!`,
  near_miss: (f) => `${f.actor} barely survives a finishing attempt!`,
  stall: () => `A tense standoff in the arena...`,
};

function generateFallback(digest: FightDigest): CommentaryDoc {
  const lines: CommentaryLine[] = digest.beats.map((beat, i) => ({
    id: i + 1,
    anchor_tick: beat.t,
    beat_ref: beat.event_ids,
    priority: PRIORITY_BY_KIND[beat.kind],
    text: FALLBACK_TEMPLATES[beat.kind](beat.facts),
  }));
  return { schema: COMMENTARY_SCHEMA_VERSION, fight_id: digest.fight_id, lines };
}

export async function generateCommentary(
  digest: FightDigest,
): Promise<{ doc: CommentaryDoc; source: "llm" | "fallback" }> {
  const raw = await callGroq(digest);
  if (raw) {
    const doc = validateAndBuild(digest, raw);
    if (doc.lines.length > 0) return { doc, source: "llm" };
  }
  return { doc: generateFallback(digest), source: "fallback" };
}
