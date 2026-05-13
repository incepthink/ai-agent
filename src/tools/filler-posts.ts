import OpenAI from "openai";
import type {
  FillerPostIdea,
  IdeaDifficulty,
  IdeaPriority,
  OfflineTweet,
  ReuseMethod,
  SimilarityRisk,
  VoiceProfile,
} from "../types.js";
import { plagiarismRisk } from "./score.js";

export const PROMPT_SCHEMA_VERSION = "v1.0.0";
export const VOICE_PROMPT_VERSION = "v1.0.0"; // matches the voice.ts prompt at time of integration

const BATCH_SIZE = 20;
const SINGLE_CALL_LIMIT = 25;

const VALID_REUSE_METHODS: ReuseMethod[] = [
  "topic remix",
  "hook remix",
  "format remix",
  "CTA remix",
  "campaign remix",
  "visual adaptation",
  "contrarian response",
  "simplified version",
  "expanded version",
  "repost/commentary adaptation",
];
const VALID_REUSE_FOR_REPOST: ReuseMethod[] = [
  "repost/commentary adaptation",
  "contrarian response",
  "topic remix",
  "simplified version",
];
const PRIORITIES: IdeaPriority[] = ["high", "medium", "low"];
const DIFFICULTIES: IdeaDifficulty[] = ["easy", "medium", "hard"];

interface RawIdea {
  sourceId?: string;
  extractedIdea?: string;
  extractedHookPattern?: string;
  reuseMethod?: string;
  adaptedPostForTarget?: string;
  visualDirection?: string;
  suggestedHashtags?: unknown;
  bestPostingWindow?: string;
  priority?: string;
  difficulty?: string;
  estimatedProductionTime?: string;
  brandFitScore?: number;
  usefulnessScore?: number;
  whyThisWorks?: string;
  whyItFitsTargetAccount?: string;
}

function pickEnum<T extends string>(value: unknown, valid: readonly T[], fallback: T): T {
  if (typeof value !== "string") return fallback;
  const v = value.toLowerCase().trim();
  const hit = valid.find((x) => x.toLowerCase() === v);
  return hit ?? fallback;
}

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 5;
  return Math.max(1, Math.min(10, Math.round(v)));
}

function compactSource(t: OfflineTweet) {
  return {
    sourceId: t.id,
    handle: `@${t.handle}`,
    accountName: t.accountName,
    content: t.text,
    dateRaw: t.dateRaw,
    postType: t.postType,
    isRepost: t.isRepost,
    repostedBy: t.repostedBy,
    mediaDescription: t.mediaDescription,
  };
}

function voiceBrief(voice: VoiceProfile): string {
  return [
    `Target handle: @${voice.handle}`,
    `Style: ${voice.styleNotes || "(no style notes)"}`,
    `Avg tweet length: ~${voice.avgTweetLength} chars  •  Sentence median: ~${voice.sentenceLengthP50} chars`,
    `Emoji rate: ${voice.emojiRate}/tweet  •  Hashtag rate: ${voice.hashtagRate}/tweet`,
    `Top vocabulary: ${voice.vocabulary.topNouns.slice(0, 10).join(", ")}`,
    `Recurring hooks: ${voice.hookPatterns.join(" | ") || "(none observed)"}`,
    `Taboo (NEVER do): ${voice.taboo.join(" | ") || "(none observed)"}`,
  ].join("\n");
}

function buildPrompt(targetHandle: string, voice: VoiceProfile, sources: OfflineTweet[]): string {
  const compact = sources.map(compactSource);
  return `You write filler-post ideas for Twitter/X account @${targetHandle}.

VOICE PROFILE (match this exactly when writing adaptedPostForTarget):
${voiceBrief(voice)}

SOURCE COMPETITOR POSTS (JSON):
${JSON.stringify(compact, null, 2)}

YOUR TASK
For each source, produce one filler-post idea object adapted for the target account.
Filler posts are quick takes, hooks, one-liners, observations, hot takes — NOT threads, NOT polls, NOT launch announcements.

HARD RULES — violations are rejected:
1. NEVER copy or paraphrase wording from the source. Use the IDEA / hook STRUCTURE / format only.
2. No engagement metrics are available for the sources. NEVER claim a source is "high-performing" or imply numbers. Phrase as "useful pattern" / "transferable angle".
3. The adaptedPostForTarget MUST sound like @${targetHandle}: match length range, punctuation, emoji rate, vocabulary, and respect taboo strictly.
4. Stay under 280 characters in adaptedPostForTarget.
5. No corporate-speak. No hashtag spam (max 2 hashtags, usually 0).
6. If the source is a repost (isRepost === true), the reuseMethod MUST be one of:
   "repost/commentary adaptation" | "contrarian response" | "topic remix" | "simplified version"
   and the adapted post should be a commentary / spotlight / reaction / "what this means for users" angle — NOT a copy of the reposted message.
7. For original posts (isRepost === false), reuseMethod is one of:
   "topic remix" | "hook remix" | "format remix" | "CTA remix" | "campaign remix" | "visual adaptation" | "contrarian response" | "simplified version" | "expanded version".

OUTPUT — STRICT JSON, this exact shape:
{
  "ideas": [
    {
      "sourceId": "<echo back the sourceId from the input>",
      "extractedIdea": "1 sentence describing the transferable idea/angle",
      "extractedHookPattern": "1 short phrase naming the hook structure (e.g. 'reverse-the-question', 'numbered tease', 'campaign drop')",
      "reuseMethod": "one of the allowed values above",
      "adaptedPostForTarget": "the actual post copy for the target account (under 280 chars)",
      "visualDirection": "1 sentence describing image/video direction, or 'text-only'",
      "suggestedHashtags": ["#optional", "#hashtags"],
      "bestPostingWindow": "e.g. 'weekday mornings UTC' / 'after a product update'",
      "priority": "high | medium | low",
      "difficulty": "easy | medium | hard",
      "estimatedProductionTime": "e.g. '5 min', '15 min', '30 min'",
      "brandFitScore": 1-10,
      "usefulnessScore": 1-10,
      "whyThisWorks": "1-2 sentences",
      "whyItFitsTargetAccount": "1-2 sentences referencing the target voice/audience"
    }
  ]
}

Output ONLY the JSON object, no prose, no code fences.`;
}

async function callBatch(
  openai: OpenAI,
  model: string,
  targetHandle: string,
  voice: VoiceProfile,
  batch: OfflineTweet[]
): Promise<RawIdea[]> {
  const prompt = buildPrompt(targetHandle, voice, batch);
  const resp = await openai.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
    max_tokens: 4096,
  });
  const raw = resp.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw) as { ideas?: RawIdea[] };
    return Array.isArray(parsed.ideas) ? parsed.ideas : [];
  } catch {
    return [];
  }
}

function classifySimilarity(score: number): SimilarityRisk {
  if (score < 0.1) return "low";
  if (score < 0.2) return "medium";
  return "high";
}

function similarityWarning(risk: SimilarityRisk): string {
  if (risk === "high") return "Adapted post still echoes source phrasing. Rewrite from scratch in target voice before publishing.";
  if (risk === "medium") return "Some structural overlap with source. Lightly rephrase before publishing.";
  return "";
}

function finaliseIdea(
  raw: RawIdea,
  source: OfflineTweet,
  corpus: OfflineTweet[],
  idx: number
): FillerPostIdea {
  const adaptedRaw = (raw.adaptedPostForTarget ?? "").trim();
  const adapted = adaptedRaw.length > 280 ? adaptedRaw.slice(0, 277) + "..." : adaptedRaw;

  const validReuse = source.isRepost ? VALID_REUSE_FOR_REPOST : VALID_REUSE_METHODS;
  const reuse = pickEnum<ReuseMethod>(raw.reuseMethod, validReuse, validReuse[0]);

  const sim = plagiarismRisk(adapted, corpus);
  const risk = classifySimilarity(sim);

  const hashtagsRaw = Array.isArray(raw.suggestedHashtags) ? raw.suggestedHashtags : [];
  const hashtags = hashtagsRaw
    .filter((h): h is string => typeof h === "string")
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .slice(0, 3);

  return {
    id: `idea_${source.id}_${idx}`,
    sourceCompetitorHandle: `@${source.handle}`,
    sourceCompetitorAccountName: source.accountName,
    sourceCompetitorPostText: source.text,
    sourceCompetitorPostType: source.postType,
    sourceCompetitorDate: source.dateRaw || "(date unknown)",
    sourceMediaDescription: source.mediaDescription,
    sourceWasRepost: source.isRepost,
    repostedBy: source.repostedBy,
    extractedIdea: (raw.extractedIdea ?? "").trim() || "(no extracted idea)",
    extractedHookPattern: (raw.extractedHookPattern ?? "").trim() || "(unclassified)",
    reuseMethod: reuse,
    adaptedPostForTarget: adapted || "(LLM returned empty post)",
    visualDirection: (raw.visualDirection ?? "").trim() || "text-only",
    suggestedHashtags: hashtags,
    bestPostingWindow: (raw.bestPostingWindow ?? "").trim() || "any",
    priority: pickEnum<IdeaPriority>(raw.priority, PRIORITIES, "medium"),
    difficulty: pickEnum<IdeaDifficulty>(raw.difficulty, DIFFICULTIES, "easy"),
    estimatedProductionTime: (raw.estimatedProductionTime ?? "").trim() || "10 min",
    brandFitScore: clampScore(raw.brandFitScore),
    usefulnessScore: clampScore(raw.usefulnessScore),
    similarityRisk: risk,
    plagiarismWarning: similarityWarning(risk),
    whyThisWorks: (raw.whyThisWorks ?? "").trim(),
    whyItFitsTargetAccount: (raw.whyItFitsTargetAccount ?? "").trim(),
  };
}

export interface GenerateOptions {
  model: string;
  maxIdeas: number;
}

export async function generateFillerPostIdeas(
  openai: OpenAI,
  targetHandle: string,
  voice: VoiceProfile,
  selectedSources: OfflineTweet[],
  allCompetitorTweets: OfflineTweet[],
  opts: GenerateOptions
): Promise<FillerPostIdea[]> {
  if (selectedSources.length === 0) return [];

  let rawIdeas: RawIdea[] = [];
  if (selectedSources.length <= SINGLE_CALL_LIMIT) {
    console.log(`[filler] One batch (${selectedSources.length} sources)`);
    rawIdeas = await callBatch(openai, opts.model, targetHandle, voice, selectedSources);
  } else {
    const batches: OfflineTweet[][] = [];
    for (let i = 0; i < selectedSources.length; i += BATCH_SIZE) {
      batches.push(selectedSources.slice(i, i + BATCH_SIZE));
    }
    console.log(`[filler] ${batches.length} batches of up to ${BATCH_SIZE} sources`);
    const results = await Promise.all(
      batches.map((b) => callBatch(openai, opts.model, targetHandle, voice, b))
    );
    rawIdeas = results.flat();
  }

  // Map sourceId → source tweet for post-processing lookup.
  const bySourceId = new Map<string, OfflineTweet>();
  for (const t of selectedSources) bySourceId.set(t.id, t);

  const ideas: FillerPostIdea[] = [];
  rawIdeas.forEach((raw, i) => {
    const sid = raw.sourceId ?? "";
    const source = bySourceId.get(sid);
    if (!source) return;
    ideas.push(finaliseIdea(raw, source, allCompetitorTweets, i));
  });

  // Deterministic rank: (brandFit + usefulness) * similarity penalty.
  const ranked = ideas
    .slice()
    .sort((a, b) => {
      const penalty = (r: SimilarityRisk) => (r === "high" ? 0.5 : r === "medium" ? 0.85 : 1);
      const ascore = (a.brandFitScore + a.usefulnessScore) * penalty(a.similarityRisk);
      const bscore = (b.brandFitScore + b.usefulnessScore) * penalty(b.similarityRisk);
      return bscore - ascore;
    })
    .slice(0, opts.maxIdeas);

  return ranked;
}
