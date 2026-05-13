import OpenAI from "openai";
import type { Tweet, VoiceProfile } from "../types.js";

const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "of", "in", "on", "at",
  "to", "for", "with", "by", "from", "as", "this", "that", "these", "those",
  "it", "its", "i", "you", "we", "they", "he", "she", "my", "your", "our",
  "their", "his", "her", "me", "us", "them", "if", "then", "than", "so",
  "just", "not", "no", "yes", "can", "could", "would", "should", "will",
  "now", "all", "any", "some", "more", "most", "much", "very", "still",
  "also", "what", "when", "where", "who", "why", "how", "into", "out",
  "up", "down", "about", "over", "only", "even", "really", "actually",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function topByFreq(words: string[], k: number): string[] {
  const counts = new Map<string, number>();
  for (const w of words) {
    if (STOPWORDS.has(w) || w.length < 3) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([w]) => w);
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

interface QualitativeVoice {
  hookPatterns: string[];
  taboo: string[];
  styleNotes: string;
}

async function inferQualitativeVoice(
  openai: OpenAI,
  handle: string,
  tweets: Tweet[]
): Promise<QualitativeVoice> {
  const sample = tweets.slice(0, 30).map((t, i) => `${i + 1}. ${t.text}`).join("\n");

  const prompt = `You are analysing the voice of Twitter/X user @${handle} from their recent tweets.

Tweets:
${sample}

Return STRICT JSON with this exact shape:
{
  "hookPatterns": ["...", "..."],   // 3-6 recurring opening structures (e.g. "Hot take:", "3 things I learned...", question-led, contrarian claim)
  "taboo": ["...", "..."],          // 2-5 things this user clearly does NOT do (e.g. "never uses hashtags", "no thread emojis", "avoids generic motivation")
  "styleNotes": "..."               // 1-2 sentence summary of voice (tone, register, energy)
}

Output ONLY the JSON object, no prose, no code fences.`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const raw = resp.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw) as Partial<QualitativeVoice>;
    return {
      hookPatterns: Array.isArray(parsed.hookPatterns) ? parsed.hookPatterns : [],
      taboo: Array.isArray(parsed.taboo) ? parsed.taboo : [],
      styleNotes: typeof parsed.styleNotes === "string" ? parsed.styleNotes : "",
    };
  } catch {
    return { hookPatterns: [], taboo: [], styleNotes: "" };
  }
}

export async function inferVoiceProfile(
  openai: OpenAI,
  handle: string,
  tweets: Tweet[]
): Promise<VoiceProfile> {
  const cleanHandle = handle.replace(/^@/, "");
  const usable = tweets.filter((t) => t.text && !t.text.startsWith("RT "));
  const sample = usable.slice(0, 50);

  if (sample.length === 0) {
    return {
      handle: cleanHandle,
      sampleSize: 0,
      avgTweetLength: 0,
      sentenceLengthP50: 0,
      emojiRate: 0,
      hashtagRate: 0,
      punctuationFingerprint: { ellipsis: 0, emDash: 0, questionMark: 0, exclamation: 0 },
      vocabulary: { topNouns: [], topVerbs: [] },
      hookPatterns: [],
      taboo: [],
      styleNotes: "No tweets available — generated post will use generic builder voice.",
      exampleTweets: [],
    };
  }

  const lengths = sample.map((t) => t.text.length);
  const avgTweetLength = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
  const sentenceLengthP50 = Math.round(
    median(sample.flatMap((t) => t.text.split(/[.!?]+/).map((s) => s.trim().length).filter((n) => n > 0)))
  );

  const emojiTotal = sample.reduce((acc, t) => acc + countMatches(t.text, EMOJI_REGEX), 0);
  const hashtagTotal = sample.reduce((acc, t) => acc + t.hashtags.length, 0);

  const punc = {
    ellipsis: 0,
    emDash: 0,
    questionMark: 0,
    exclamation: 0,
  };
  for (const t of sample) {
    punc.ellipsis += countMatches(t.text, /\.\.\.|…/g);
    punc.emDash += countMatches(t.text, /—|--/g);
    punc.questionMark += countMatches(t.text, /\?/g);
    punc.exclamation += countMatches(t.text, /!/g);
  }
  const n = sample.length;
  const normalize = (x: number) => Math.round((x / n) * 100) / 100;

  const allTokens = sample.flatMap((t) => tokenize(t.text));
  const verbHints = allTokens.filter((w) => /ing$|ed$|build|ship|launch|learn|test|run|fix|try|use|make/.test(w));
  const topNouns = topByFreq(allTokens.filter((w) => !verbHints.includes(w)), 12);
  const topVerbs = topByFreq(verbHints, 10);

  console.log(`[voice] Inferring qualitative voice for @${cleanHandle} (${sample.length} tweets)...`);
  const qualitative = await inferQualitativeVoice(openai, cleanHandle, sample);

  const exampleTweets = sample
    .slice()
    .sort((a, b) => b.likeCount + b.retweetCount * 2 - (a.likeCount + a.retweetCount * 2))
    .slice(0, 5)
    .map((t) => ({ id: t.id, text: t.text }));

  return {
    handle: cleanHandle,
    sampleSize: sample.length,
    avgTweetLength,
    sentenceLengthP50,
    emojiRate: normalize(emojiTotal),
    hashtagRate: normalize(hashtagTotal),
    punctuationFingerprint: {
      ellipsis: normalize(punc.ellipsis),
      emDash: normalize(punc.emDash),
      questionMark: normalize(punc.questionMark),
      exclamation: normalize(punc.exclamation),
    },
    vocabulary: { topNouns, topVerbs },
    hookPatterns: qualitative.hookPatterns,
    taboo: qualitative.taboo,
    styleNotes: qualitative.styleNotes,
    exampleTweets,
  };
}
