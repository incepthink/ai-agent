import OpenAI from "openai";
import type { CandidateScores, Pattern, PostCandidate, Tweet, VoiceProfile } from "../types.js";

const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

function ngrams(text: string, n: number): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const grams = new Set<string>();
  for (let i = 0; i <= tokens.length - n; i++) {
    grams.add(tokens.slice(i, i + n).join(" "));
  }
  return grams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function plagiarismRisk(candidateText: string, sourceTweets: Tweet[]): number {
  const candGrams = ngrams(candidateText, 4);
  if (candGrams.size === 0) return 0;
  let max = 0;
  for (const t of sourceTweets) {
    const srcGrams = ngrams(t.text, 4);
    const score = jaccard(candGrams, srcGrams);
    if (score > max) max = score;
  }
  // Boost a touch — pure jaccard is conservative; we want to flag risky paraphrases too.
  return Math.min(1, max * 1.4);
}

function brandFitHeuristic(text: string, voice: VoiceProfile): number {
  if (voice.sampleSize === 0) return 0.7;
  const len = text.length;
  const targetLen = voice.avgTweetLength || 140;
  const lenDelta = Math.abs(len - targetLen) / Math.max(60, targetLen);
  const lenScore = Math.max(0, 1 - lenDelta);

  const emojis = (text.match(EMOJI_REGEX) ?? []).length;
  const emojiTarget = voice.emojiRate;
  const emojiPenalty = emojis > emojiTarget + 1 ? Math.min(0.4, (emojis - emojiTarget) * 0.15) : 0;

  const hashtags = (text.match(/#\w+/g) ?? []).length;
  const hashtagTarget = voice.hashtagRate;
  const hashtagPenalty = hashtags > hashtagTarget + 1 ? Math.min(0.4, (hashtags - hashtagTarget) * 0.2) : 0;

  const taboo = (voice.taboo ?? []).filter((t) => t && text.toLowerCase().includes(t.toLowerCase()));
  const tabooPenalty = Math.min(0.5, taboo.length * 0.25);

  const score = lenScore - emojiPenalty - hashtagPenalty - tabooPenalty;
  return Math.max(0, Math.min(1, score));
}

function effortScore(text: string): number {
  // Lower is better. Effort proxies: length, em-dashes, lists, multiple sentences.
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
  const length = text.length;
  const listy = /\d\.\s|•|—.*—/.test(text) ? 0.1 : 0;
  const base = Math.min(1, length / 280);
  const sentencePenalty = Math.min(0.3, (sentences - 1) * 0.07);
  return Math.max(0, Math.min(1, base * 0.5 + sentencePenalty + listy));
}

interface LLMScores {
  quality: number;
  brandFit: number;
  expectedEngagement: number;
  reasoning?: string;
}

async function llmScoreBatch(
  openai: OpenAI,
  voice: VoiceProfile,
  patterns: Pattern[],
  candidates: PostCandidate[]
): Promise<LLMScores[]> {
  const items = candidates
    .map((c, i) => `[${i}] format=${c.format} theme=${c.theme} patterns=${c.sourcePatternIds.join(",")}\n   "${c.text}"`)
    .join("\n");

  const patternRef = patterns
    .slice(0, 18)
    .map((p) => `${p.id}: ${p.signature} (avg eng ${p.avgEngagement})`)
    .join("\n");

  const prompt = `Score each candidate "filler post" for Twitter/X user @${voice.handle}.

Voice anchor: ${voice.styleNotes || "direct AI/tech builder"}
Avg tweet length: ~${voice.avgTweetLength} chars  •  Emoji rate: ${voice.emojiRate}  •  Hashtag rate: ${voice.hashtagRate}
Taboo: ${(voice.taboo ?? []).join(" | ") || "(none)"}

Pattern reference (engagement averages):
${patternRef}

Candidates:
${items}

For EACH candidate (in order), score 0.0-1.0 on three dimensions:
- "quality": craft, sharpness, originality of insight (NOT engagement potential)
- "brandFit": does it sound like @${voice.handle}? consider length, tone, vocabulary, taboo
- "expectedEngagement": likely traction given the pattern's competitor performance + how the post resonates

Return STRICT JSON: { "scores": [{"quality": 0.0, "brandFit": 0.0, "expectedEngagement": 0.0, "reasoning": "1 sentence"}, ...] }
Length of scores array MUST equal ${candidates.length}.

Output ONLY the JSON object.`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
    max_tokens: 3000,
  });

  const raw = resp.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw) as { scores?: LLMScores[] };
    const scores = Array.isArray(parsed.scores) ? parsed.scores : [];
    // Pad/truncate defensively to match candidate count.
    while (scores.length < candidates.length) {
      scores.push({ quality: 0.5, brandFit: 0.5, expectedEngagement: 0.5 });
    }
    return scores.slice(0, candidates.length);
  } catch {
    return candidates.map(() => ({ quality: 0.5, brandFit: 0.5, expectedEngagement: 0.5 }));
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function compositeScore(s: Omit<CandidateScores, "composite">): number {
  return (
    0.30 * s.quality +
    0.25 * s.brandFit +
    0.20 * s.expectedEngagement +
    0.15 * (1 - s.plagiarismRisk) +
    0.10 * (1 - s.effort)
  );
}

export async function scoreCandidates(
  openai: OpenAI,
  candidates: PostCandidate[],
  voice: VoiceProfile,
  patterns: Pattern[],
  allCompetitorTweets: Tweet[]
): Promise<PostCandidate[]> {
  if (candidates.length === 0) return [];

  // Batch LLM scoring in groups of 10 to keep response sizes manageable.
  const batchSize = 10;
  const llmScores: LLMScores[] = [];
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    console.log(`[score] LLM scoring batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(candidates.length / batchSize)}...`);
    const batchScores = await llmScoreBatch(openai, voice, patterns, batch);
    llmScores.push(...batchScores);
  }

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const llm = llmScores[i];

    const heuristicFit = brandFitHeuristic(c.text, voice);
    const blendedBrandFit = clamp01(0.6 * clamp01(llm.brandFit) + 0.4 * heuristicFit);

    const plagiarism = plagiarismRisk(c.text, allCompetitorTweets);
    const effort = effortScore(c.text);

    const partial = {
      quality: clamp01(llm.quality),
      brandFit: blendedBrandFit,
      expectedEngagement: clamp01(llm.expectedEngagement),
      plagiarismRisk: clamp01(plagiarism),
      effort: clamp01(effort),
    };

    c.scores = { ...partial, composite: compositeScore(partial) };
    if (!c.reasoning && llm.reasoning) c.reasoning = llm.reasoning;
  }

  return candidates;
}

export function filterAndRank(
  candidates: PostCandidate[],
  heroCount: number,
  backupCount: number,
  plagiarismThreshold: number
): PostCandidate[] {
  const safe = candidates
    .filter((c) => c.text.length > 0 && c.text.length <= 280)
    .filter((c) => c.scores.plagiarismRisk < plagiarismThreshold)
    .sort((a, b) => b.scores.composite - a.scores.composite);

  const keep = safe.slice(0, heroCount + backupCount);
  return keep.map((c, i) => ({
    ...c,
    tier: i < heroCount ? "hero" : "backup",
    rank: i + 1,
  }));
}
