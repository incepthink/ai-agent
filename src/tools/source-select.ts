import type { OfflineTweet } from "../types.js";

const GENERIC_PHRASES = [
  /^gm\b/i,
  /^gn\b/i,
  /^lfg\b/i,
  /^wagmi\b/i,
  /^ngmi\b/i,
  /^up only\b/i,
  /^lol\b/i,
  /^^^/,
  /^this\.?$/i,
  /^based\.?$/i,
];

const CTA_VERBS = /\b(enter|claim|try|join|mint|apply|vote|share|quote|sign\s*up|register|use|grab|get\s+in|drop|comment|reply|follow|subscribe|stake|bridge|swap|deposit)\b/i;
const STRONG_HOOK = /^(\d+\b|here(?:'|')?s\b|why\b|how\b|stop\b|don(?:'|')?t\b|what if\b|the (best|worst|fastest|easiest)\b|imagine\b|nobody\b|everybody\b|the truth\b|hot take\b)/i;
const PRODUCT_WORDS = /\b(launch(?:ing|ed)?|live\b|shipped|shipping|release[ds]?|introducing|now available|out now|update|v\d+|beta\b|alpha\b|mainnet|testnet|feature\b|campaign|referral|airdrop|rewards?|points?|incentives?|partnership|integration)\b/i;
const METRIC_NUM = /\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?\s*(?:k|m|b|x|%)\b/i;
const STRUCTURED = /\n\s*(?:[-*•]|\d\.|\d\))/;

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function ngrams(text: string, n: number): Set<string> {
  const t = tokens(text);
  const g = new Set<string>();
  for (let i = 0; i <= t.length - n; i++) g.add(t.slice(i, i + n).join(" "));
  return g;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function linkRatio(text: string): number {
  const links = text.match(/https?:\/\/\S+/g) ?? [];
  if (links.length === 0) return 0;
  const linkLen = links.reduce((acc, l) => acc + l.length, 0);
  return linkLen / Math.max(1, text.length);
}

function isGeneric(text: string): boolean {
  const trimmed = text.trim();
  if (GENERIC_PHRASES.some((re) => re.test(trimmed))) return true;
  if (trimmed.length < 30) return true;
  if (linkRatio(trimmed) > 0.8) return true;
  return false;
}

function scoreTweet(t: OfflineTweet): number {
  const text = t.text;
  let score = 0;
  if (CTA_VERBS.test(text)) score += 1;
  if (STRONG_HOOK.test(text.trim())) score += 1;
  if (STRUCTURED.test(text)) score += 1;
  if (t.mediaDescription) score += 1;
  if (t.postType === "pinned_tweet") score += 2;
  if (t.postType === "repost") score += 1;
  if (PRODUCT_WORDS.test(text)) score += 1;
  if (METRIC_NUM.test(text)) score += 1;
  // Mild bonus for medium-length structured posts (filler-friendly).
  if (text.length >= 80 && text.length <= 400) score += 0.5;
  return score;
}

export interface SelectOptions {
  maxSourceTweets: number;
  perCompetitorCapRatio?: number; // default 0.6
  dedupeThreshold?: number; // default 0.6
}

/**
 * Deterministic pre-filter: drops generic/duplicate tweets and ranks the rest
 * by heuristic signal score. Caps any single competitor at perCompetitorCapRatio
 * of the slot budget so one chatty handle can't crowd the rest.
 */
export function selectSourceTweets(
  competitorTweets: OfflineTweet[],
  opts: SelectOptions
): OfflineTweet[] {
  const { maxSourceTweets, perCompetitorCapRatio = 0.6, dedupeThreshold = 0.6 } = opts;

  // 1. Hard filter.
  const filtered = competitorTweets.filter((t) => !isGeneric(t.text));

  // 2. Score.
  const scored = filtered
    .map((t) => ({ tweet: t, score: scoreTweet(t) }))
    .filter((s) => s.score > 0);

  // 3. Sort by score desc; stable on insertion order.
  scored.sort((a, b) => b.score - a.score);

  // 4. Greedy dedupe + per-handle cap.
  const perHandleCap = Math.max(1, Math.floor(maxSourceTweets * perCompetitorCapRatio));
  const handleCounts = new Map<string, number>();
  const kept: OfflineTweet[] = [];
  const keptGrams: Set<string>[] = [];

  for (const { tweet } of scored) {
    if (kept.length >= maxSourceTweets) break;
    const handleKey = tweet.handle;
    if ((handleCounts.get(handleKey) ?? 0) >= perHandleCap) continue;

    const grams = ngrams(tweet.text, 4);
    let dup = false;
    for (const existing of keptGrams) {
      if (jaccard(grams, existing) >= dedupeThreshold) {
        dup = true;
        break;
      }
    }
    if (dup) continue;

    kept.push(tweet);
    keptGrams.push(grams);
    handleCounts.set(handleKey, (handleCounts.get(handleKey) ?? 0) + 1);
  }

  return kept;
}
