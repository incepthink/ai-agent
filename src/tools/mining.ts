import OpenAI from "openai";
import type { CompetitorData, Pattern, Insights, Tweet } from "../types.js";

interface RawPattern {
  kind: "hook" | "format" | "angle" | "topic";
  signature: string;
  description: string;
  sourceTweetIds: string[];
}

function rankByEngagement(tweets: Tweet[]): Tweet[] {
  return [...tweets].sort(
    (a, b) =>
      b.likeCount + b.retweetCount * 2 + b.replyCount - (a.likeCount + a.retweetCount * 2 + a.replyCount)
  );
}

function buildPatternId(kind: string, signature: string): string {
  return `${kind}:${signature.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
}

async function extractPatternsFromCompetitor(
  openai: OpenAI,
  handle: string,
  tweets: Tweet[]
): Promise<RawPattern[]> {
  const top = rankByEngagement(tweets).slice(0, 25);
  const sample = top
    .map((t) => `[id:${t.id} ❤${t.likeCount} ♻${t.retweetCount}] ${t.text.replace(/\s+/g, " ").slice(0, 240)}`)
    .join("\n");

  const prompt = `You are a content strategy analyst. Study these tweets from @${handle} and extract REUSABLE PATTERNS — never specific wording.

Tweets (with engagement):
${sample}

Extract 6-10 patterns. For each, classify as:
- "hook": an opening structure (e.g. "contrarian-claim", "shocking-stat", "three-things-list", "question-first")
- "format": a post shape (e.g. "before-after", "myth-vs-truth", "list-of-3", "one-line-observation")
- "angle": a thematic stance (e.g. "anti-hype", "build-in-public-honesty", "ship-fast-mindset")
- "topic": a recurring subject (e.g. "ai-tooling", "founder-mistakes", "engineering-velocity")

Return STRICT JSON: { "patterns": [{"kind": "...", "signature": "kebab-case", "description": "1 sentence describing the pattern (not the tweet)", "sourceTweetIds": ["id1","id2"]}, ...] }

Rules:
- "signature" is a short kebab-case label, not a tweet excerpt
- "description" explains the transferable pattern, never quotes the tweet
- "sourceTweetIds" lists the IDs (from the [id:...] tags above) that exemplify the pattern
- Patterns must be transferable to another account in a different voice

Output ONLY the JSON object.`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const raw = resp.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw) as { patterns?: RawPattern[] };
    return Array.isArray(parsed.patterns) ? parsed.patterns : [];
  } catch {
    return [];
  }
}

export async function minePatterns(
  openai: OpenAI,
  competitors: CompetitorData[]
): Promise<Pattern[]> {
  const tweetIndex = new Map<string, { tweet: Tweet; handle: string }>();
  for (const c of competitors) {
    for (const t of c.tweets) tweetIndex.set(t.id, { tweet: t, handle: c.profile.username });
  }

  const patternMap = new Map<string, Pattern>();

  for (const c of competitors) {
    console.log(`[mine] Extracting patterns from @${c.profile.username}...`);
    const raw = await extractPatternsFromCompetitor(openai, c.profile.username, c.tweets);

    for (const r of raw) {
      if (!r.signature || !r.kind) continue;
      const id = buildPatternId(r.kind, r.signature);
      const validIds = (r.sourceTweetIds ?? []).filter((id) => tweetIndex.has(id));
      if (validIds.length === 0) continue;

      const engagements = validIds.map((tid) => {
        const e = tweetIndex.get(tid)!.tweet;
        return e.likeCount + e.retweetCount * 2 + e.replyCount;
      });
      const avg = engagements.reduce((a, b) => a + b, 0) / engagements.length;

      const existing = patternMap.get(id);
      if (existing) {
        existing.sourceTweetIds = [...new Set([...existing.sourceTweetIds, ...validIds])];
        existing.competitorHandles = [...new Set([...existing.competitorHandles, c.profile.username])];
        existing.frequency += validIds.length;
        existing.avgEngagement = (existing.avgEngagement + avg) / 2;
      } else {
        patternMap.set(id, {
          id,
          kind: r.kind,
          signature: r.signature,
          description: r.description ?? "",
          sourceTweetIds: validIds,
          competitorHandles: [c.profile.username],
          avgEngagement: Math.round(avg),
          frequency: validIds.length,
        });
      }
    }
  }

  return [...patternMap.values()].sort(
    (a, b) => b.avgEngagement * Math.log2(b.frequency + 1) - a.avgEngagement * Math.log2(a.frequency + 1)
  );
}

export function buildInsights(
  target: string,
  competitors: CompetitorData[],
  patterns: Pattern[]
): Insights {
  const topHooks = patterns.filter((p) => p.kind === "hook").slice(0, 8);
  const topFormats = patterns.filter((p) => p.kind === "format").slice(0, 8);
  const topics = patterns.filter((p) => p.kind === "topic").slice(0, 10);

  const hotTopics = topics.map((t) => ({
    topic: t.signature,
    mentions: t.frequency,
    avgEngagement: t.avgEngagement,
  }));

  const postingCadence = competitors.map((c) => {
    if (c.tweets.length === 0) return { handle: c.profile.username, postsPerWeek: 0, medianHourUTC: 12 };
    const times = c.tweets
      .map((t) => new Date(t.createdAt).getTime())
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    if (times.length < 2) return { handle: c.profile.username, postsPerWeek: 0, medianHourUTC: 12 };
    const spanDays = Math.max(1, (times[times.length - 1] - times[0]) / 86_400_000);
    const postsPerWeek = Math.round((c.tweets.length / spanDays) * 7 * 10) / 10;
    const hours = c.tweets.map((t) => new Date(t.createdAt).getUTCHours()).sort((a, b) => a - b);
    const medianHourUTC = hours[Math.floor(hours.length / 2)] ?? 12;
    return { handle: c.profile.username, postsPerWeek, medianHourUTC };
  });

  return {
    generatedAt: new Date().toISOString(),
    target,
    competitors: competitors.map((c) => c.profile.username),
    topHooks: topHooks.map(({ signature, description, avgEngagement, frequency }) => ({
      signature,
      description,
      avgEngagement,
      frequency,
    })),
    topFormats: topFormats.map(({ signature, description, avgEngagement, frequency }) => ({
      signature,
      description,
      avgEngagement,
      frequency,
    })),
    hotTopics,
    postingCadence,
    patterns,
  };
}
