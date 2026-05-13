import fs from "node:fs";
import path from "node:path";
import type {
  DataWarning,
  OfflinePostType,
  OfflineTweet,
  Tweet,
  UserProfile,
} from "../types.js";

interface RawOfflineTweet {
  account_name?: string;
  handle?: string;
  date?: string;
  type?: string;
  content?: string;
  media?: { type?: string; description?: string; duration?: string } | null;
  is_repost?: boolean;
  is_pinned?: boolean;
  reposted_by?: string | null;
}

const warnings: DataWarning[] = [];
const tweetCache = new Map<string, OfflineTweet[]>();
const profileCache = new Map<string, UserProfile>();

let dataDir = "./data/twitter";

export function configureLocalProvider(opts: { dataDir?: string }) {
  if (opts.dataDir) dataDir = opts.dataDir;
}

export function resetLocalProviderState() {
  warnings.length = 0;
  tweetCache.clear();
  profileCache.clear();
}

export function getWarnings(): DataWarning[] {
  return warnings.slice();
}

function pushWarning(w: DataWarning) {
  warnings.push(w);
}

function resolveFile(handle: string): { path: string; used: string } | null {
  const clean = handle.replace(/^@/, "");
  const candidates = [
    `${clean}.json`,
    `@${clean}.json`,
    `${clean.toLowerCase()}.json`,
  ];

  for (let i = 0; i < candidates.length; i++) {
    const full = path.join(dataDir, candidates[i]);
    if (fs.existsSync(full)) {
      if (i > 0) {
        pushWarning({
          kind: "filename-fallback",
          handle: clean,
          file: candidates[i],
          message: `Loaded ${candidates[i]} as fallback for @${clean} (preferred ${candidates[0]} not found).`,
        });
      }
      return { path: full, used: candidates[i] };
    }
  }
  return null;
}

function normalizePostType(raw: string | undefined, isRepost: boolean, isPinned: boolean): OfflinePostType {
  const t = (raw ?? "").toLowerCase();
  if (t === "repost" || isRepost) return "repost";
  if (t === "pinned_tweet" || isPinned) return "pinned_tweet";
  return "tweet";
}

function deriveMediaType(media: RawOfflineTweet["media"]): "photo" | "video" | undefined {
  if (!media) return undefined;
  const t = (media.type ?? "").toLowerCase();
  if (t.includes("video")) return "video";
  if (t.includes("image") || t.includes("photo")) return "photo";
  // "video_or_image" → conservative default
  if (t.includes("video_or_image")) return "photo";
  return undefined;
}

function extractHashtags(text: string): string[] {
  const matches = text.match(/#\w+/g) ?? [];
  return matches.map((h) => h.slice(1));
}

function parseDate(raw: string | undefined, idx: number, handle: string): { iso: string; raw: string; unparseable: boolean } {
  const original = (raw ?? "").trim();
  if (!original) {
    return { iso: new Date(Date.now() - idx * 86_400_000).toISOString(), raw: "", unparseable: true };
  }
  // Try direct parse; JS handles "May 8", "2024-05-08", "May 8, 2024" etc.
  const d = new Date(original);
  if (!Number.isNaN(d.getTime())) {
    return { iso: d.toISOString(), raw: original, unparseable: false };
  }
  pushWarning({
    kind: "unparseable-date",
    handle,
    message: `Could not parse date "${original}" for @${handle}; using synthetic timestamp for ordering only.`,
  });
  return { iso: new Date(Date.now() - idx * 86_400_000).toISOString(), raw: original, unparseable: true };
}

function normalizeOfflineTweet(raw: RawOfflineTweet, handle: string, idx: number): OfflineTweet | null {
  const content = (raw.content ?? "").trim();
  if (!content) {
    pushWarning({
      kind: "empty-content",
      handle,
      message: `Skipped entry ${idx} for @${handle}: empty content.`,
    });
    return null;
  }

  const isRepost = !!raw.is_repost || (raw.type ?? "").toLowerCase() === "repost";
  const isPinned = !!raw.is_pinned || (raw.type ?? "").toLowerCase() === "pinned_tweet";
  const postType = normalizePostType(raw.type, isRepost, isPinned);

  const { iso: createdAt, raw: dateRaw } = parseDate(raw.date, idx, handle);
  const hashtags = extractHashtags(content);
  const mediaType = deriveMediaType(raw.media);
  const hasMedia = !!raw.media;

  const base: Tweet = {
    id: `local_${handle}_${idx}`,
    text: content,
    createdAt,
    likeCount: 0,
    retweetCount: 0,
    replyCount: 0,
    quoteCount: 0,
    hashtags,
    hasMedia,
    mediaType,
    url: "",
  };

  return {
    ...base,
    handle,
    accountName: (raw.account_name ?? handle).trim(),
    dateRaw,
    postType,
    isRepost,
    repostedBy: isRepost ? raw.reposted_by ?? null : null,
    isPinned,
    mediaDescription: raw.media?.description ?? null,
  };
}

function loadOfflineTweetsForHandle(handle: string, maxItems: number): OfflineTweet[] {
  const clean = handle.replace(/^@/, "");
  const key = clean.toLowerCase();
  const cached = tweetCache.get(key);
  if (cached) {
    return cached.slice(0, maxItems);
  }

  const resolved = resolveFile(clean);
  if (!resolved) {
    pushWarning({
      kind: "missing-file",
      handle: clean,
      message: `No JSON file found for @${clean} in ${dataDir}. Tried: ${clean}.json, @${clean}.json, ${clean.toLowerCase()}.json.`,
    });
    tweetCache.set(key, []);
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved.path, "utf8"));
  } catch (err) {
    pushWarning({
      kind: "missing-file",
      handle: clean,
      file: resolved.used,
      message: `Failed to parse ${resolved.path}: ${err instanceof Error ? err.message : String(err)}`,
    });
    tweetCache.set(key, []);
    return [];
  }

  if (!Array.isArray(parsed)) {
    pushWarning({
      kind: "missing-file",
      handle: clean,
      file: resolved.used,
      message: `${resolved.path} must be a JSON array of tweet objects.`,
    });
    tweetCache.set(key, []);
    return [];
  }

  const normalized: OfflineTweet[] = [];
  parsed.forEach((entry, i) => {
    const tw = normalizeOfflineTweet(entry as RawOfflineTweet, clean, i);
    if (tw) normalized.push(tw);
  });

  if (normalized.length === 0) {
    pushWarning({
      kind: "no-tweets-loaded",
      handle: clean,
      file: resolved.used,
      message: `Loaded 0 usable tweets from ${resolved.path}.`,
    });
  }

  tweetCache.set(key, normalized);
  return normalized.slice(0, maxItems);
}

// ──────────────────────────────────────────────
// Provider contract (matches twitter.ts / twitter-mock.ts)
// ──────────────────────────────────────────────

export function fetchUserTweets(username: string, maxItems: number = 50): Promise<Tweet[]> {
  const tweets = loadOfflineTweetsForHandle(username, maxItems);
  console.log(`[offline] Loaded ${tweets.length} tweets for @${username.replace(/^@/, "")}`);
  return Promise.resolve(tweets);
}

export function fetchOfflineTweets(username: string, maxItems: number = 50): Promise<OfflineTweet[]> {
  return Promise.resolve(loadOfflineTweetsForHandle(username, maxItems));
}

export function getUserProfile(username: string): Promise<UserProfile> {
  const clean = username.replace(/^@/, "");
  const key = clean.toLowerCase();
  const cached = profileCache.get(key);
  if (cached) return Promise.resolve(cached);

  const tweets = loadOfflineTweetsForHandle(clean, 1);
  const first = tweets[0];
  const profile: UserProfile = {
    username: clean,
    displayName: first?.accountName ?? clean,
    followersCount: 0,
    followingCount: 0,
    tweetsCount: 0,
    description: "",
    verified: false,
  };
  profileCache.set(key, profile);
  return Promise.resolve(profile);
}

export function recordGlobalDataWarnings(allHandles: string[]) {
  // Always record blanket warnings about offline-mode missing data.
  pushWarning({
    kind: "missing-metrics",
    message:
      "Offline data has no engagement metrics (likes/retweets/replies). Ideas are scored on transferable structure, not source performance.",
  });
  pushWarning({
    kind: "missing-urls",
    message:
      "Offline data has no tweet URLs. Source links show 'URL not provided' in the dashboard.",
  });
  void allHandles;
}
