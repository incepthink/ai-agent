import OpenAI from "openai";
import type {
  CandidateFormat,
  Pattern,
  PostCandidate,
  SourceEvidence,
  Tweet,
  VoiceProfile,
} from "../types.js";

interface RawCandidate {
  text: string;
  imageBrief?: string;
  format: string;
  theme: string;
  patternIds: string[];
  reasoning: string;
}

const VALID_FORMATS: CandidateFormat[] = [
  "one-liner",
  "hot-take",
  "hook",
  "observation",
  "micro-framework",
  "question",
];

function normalizeFormat(f: string): CandidateFormat {
  const lower = (f ?? "").toLowerCase().trim() as CandidateFormat;
  return VALID_FORMATS.includes(lower) ? lower : "observation";
}

function voiceSummary(voice: VoiceProfile): string {
  const punc = voice.punctuationFingerprint;
  return [
    `Style: ${voice.styleNotes || "direct builder voice"}`,
    `Avg tweet length: ~${voice.avgTweetLength} chars (sentence median ~${voice.sentenceLengthP50} chars)`,
    `Emoji rate: ${voice.emojiRate}/tweet  •  Hashtag rate: ${voice.hashtagRate}/tweet`,
    `Punctuation usage per tweet: …${punc.ellipsis}  —${punc.emDash}  ?${punc.questionMark}  !${punc.exclamation}`,
    `Top vocabulary: ${voice.vocabulary.topNouns.slice(0, 10).join(", ")}`,
    `Recurring hooks: ${voice.hookPatterns.join(" | ")}`,
    `Taboo (NEVER do): ${voice.taboo.join(" | ")}`,
    voice.exampleTweets.length > 0
      ? `Examples of the voice:\n${voice.exampleTweets.map((e, i) => `  ${i + 1}. ${e.text}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function patternsSummary(patterns: Pattern[]): string {
  return patterns
    .slice(0, 18)
    .map((p) => `- [${p.id}] (${p.kind}) ${p.signature}: ${p.description}  [avg eng ${p.avgEngagement}, seen ${p.frequency}×]`)
    .join("\n");
}

export async function generateCandidates(
  openai: OpenAI,
  patterns: Pattern[],
  voice: VoiceProfile,
  rawCount: number
): Promise<RawCandidate[]> {
  if (patterns.length === 0) return [];

  const prompt = `You generate "filler post" candidates for Twitter/X user @${voice.handle}.

VOICE PROFILE — match this exactly:
${voiceSummary(voice)}

PATTERNS mined from competitors (use as STRUCTURAL inspiration only — never reuse wording):
${patternsSummary(patterns)}

YOUR TASK
Generate ${rawCount} original "filler post" candidates. Filler posts are quick takes, hooks, one-liners, hot takes, observations — NOT threads, NOT polls, NOT launch announcements.

HARD RULES (violations are auto-rejected):
1. NEVER copy or paraphrase wording from any source tweet. Use the PATTERN, not the words.
2. Each post must sound like @${voice.handle} — match length, punctuation, emoji rate, vocabulary.
3. Respect the taboo list above strictly.
4. Each post must reference at least 1 pattern by id (from patternIds).
5. Stay text-only. The "imageBrief" field is OPTIONAL (omit unless the post genuinely benefits from a meme/image — then describe the image concept in 1 sentence, do NOT generate the image).
6. Vary formats across the batch (mix one-liner / hot-take / hook / observation / micro-framework / question).
7. Vary themes — don't make 10 posts about the same topic.
8. No corporate-speak, no generic "AI is amazing" filler, no hashtag spam.

Return STRICT JSON:
{
  "candidates": [
    {
      "text": "the post (under 280 chars)",
      "imageBrief": "optional: 1-sentence image/meme concept",
      "format": "one-liner | hot-take | hook | observation | micro-framework | question",
      "theme": "kebab-case topic theme",
      "patternIds": ["pattern-id-1", "pattern-id-2"],
      "reasoning": "1-2 sentences: why this should land for this voice + which pattern it leverages"
    }
  ]
}

Output ONLY the JSON object.`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
    max_tokens: 4096,
  });

  const raw = resp.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw) as { candidates?: RawCandidate[] };
    return Array.isArray(parsed.candidates) ? parsed.candidates : [];
  } catch {
    return [];
  }
}

export function buildEvidence(
  patternIds: string[],
  patterns: Pattern[],
  tweetIndex: Map<string, { tweet: Tweet; handle: string }>
): SourceEvidence[] {
  const evidence: SourceEvidence[] = [];
  const seen = new Set<string>();

  for (const pid of patternIds) {
    const p = patterns.find((pp) => pp.id === pid);
    if (!p) continue;
    for (const tid of p.sourceTweetIds.slice(0, 2)) {
      if (seen.has(tid)) continue;
      const entry = tweetIndex.get(tid);
      if (!entry) continue;
      seen.add(tid);
      const t = entry.tweet;
      evidence.push({
        tweetId: t.id,
        handle: entry.handle,
        excerpt: t.text.replace(/\s+/g, " ").slice(0, 100),
        url: t.url,
        metric: `${t.likeCount.toLocaleString()} likes, ${t.retweetCount.toLocaleString()} RTs`,
      });
      if (evidence.length >= 3) return evidence;
    }
  }
  return evidence;
}

export function rawToCandidate(raw: RawCandidate, index: number, createdAt: string): PostCandidate {
  return {
    id: `cand_${Date.now().toString(36)}_${index}`,
    tier: "backup",
    rank: 0,
    text: (raw.text ?? "").trim(),
    imageBrief: raw.imageBrief && raw.imageBrief.trim().length > 0 ? raw.imageBrief.trim() : undefined,
    format: normalizeFormat(raw.format),
    theme: (raw.theme ?? "general").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "general",
    scores: {
      quality: 0,
      brandFit: 0,
      plagiarismRisk: 0,
      effort: 0,
      expectedEngagement: 0,
      composite: 0,
    },
    reasoning: (raw.reasoning ?? "").trim(),
    sourcePatternIds: Array.isArray(raw.patternIds) ? raw.patternIds : [],
    sourceEvidence: [],
    createdAt,
  };
}
