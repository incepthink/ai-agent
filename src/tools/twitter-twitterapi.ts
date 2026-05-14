import fs from "node:fs";
import path from "node:path";
import type { Tweet, UserProfile } from "../types.js";
import { getProgress } from "../progress.js";

const BASE_URL = "https://api.twitterapi.io";
const CACHE_DIR = "./cache";

// Free-tier limit: 1 request every 5 seconds. All calls are serialised through
// this queue so concurrent callers (Promise.all in agent.ts) don't race.
let _queue = Promise.resolve();
const RATE_LIMIT_MS = 5_100; // 5 s + 100 ms buffer

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = _queue.then(() => fn());
  _queue = result.then(
    () => new Promise<void>((r) => setTimeout(r, RATE_LIMIT_MS)),
    () => new Promise<void>((r) => setTimeout(r, RATE_LIMIT_MS)),
  );
  return result;
}

function readCache<T>(key: string): T | null {
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  }
  return null;
}

function writeCache(key: string, data: unknown): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data, null, 2));
}

function requireApiKey(): string {
  const key = process.env.TWITTER_API_KEY;
  if (!key) {
    throw new Error("TWITTER_API_KEY is required for --provider twitterapi");
  }
  return key;
}

async function twitterApiGet(
  endpoint: string,
  query: Record<string, string>
): Promise<Record<string, unknown>> {
  return enqueue(async () => {
    const apiKey = requireApiKey();
    const params = new URLSearchParams(query).toString();
    const url = `${BASE_URL}${endpoint}?${params}`;

    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const res = await fetch(url, {
        method: "GET",
        headers: { "X-API-Key": apiKey },
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? 5);
        const wait = (retryAfter || 5) * 1_000;
        const msg = `429 on ${endpoint} — waiting ${wait / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`;
        console.warn(`[twitterapi] ${msg}`);
        getProgress()?.log(msg, "twitterapi", "warn");
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 200);
        throw new Error(`TwitterAPI.io ${endpoint} returned ${res.status}: ${body}`);
      }

      const json = (await res.json()) as Record<string, unknown>;
      if (json.status === "error") {
        const msg = String(json.msg ?? json.message ?? "unknown error");
        throw new Error(`TwitterAPI.io ${endpoint} error: ${msg}`);
      }
      return json;
    }

    throw new Error(`TwitterAPI.io ${endpoint} still returning 429 after ${MAX_RETRIES} retries`);
  });
}

function normalizeTweet(raw: Record<string, unknown>, fallbackHandle: string): Tweet {
  const id = String(raw.id ?? "");
  const entities = (raw.entities as Record<string, unknown>) ?? {};
  const extended = (raw.extendedEntities as Record<string, unknown>) ?? {};

  const hashtags = ((entities.hashtags as Array<Record<string, unknown>>) ?? [])
    .map((h) => String(h.text ?? ""))
    .filter(Boolean);

  const mediaArr =
    (extended.media as Array<Record<string, unknown>> | undefined) ??
    (entities.media as Array<Record<string, unknown>> | undefined);
  const hasMedia = Array.isArray(mediaArr) && mediaArr.length > 0;
  const mediaType = hasMedia
    ? (String(mediaArr![0].type ?? "") as "photo" | "video" | "gif")
    : undefined;

  const url =
    typeof raw.url === "string" && raw.url
      ? raw.url
      : `https://twitter.com/${fallbackHandle}/status/${id}`;

  return {
    id,
    text: String(raw.text ?? ""),
    createdAt: String(raw.createdAt ?? ""),
    likeCount: Number(raw.likeCount ?? 0),
    retweetCount: Number(raw.retweetCount ?? 0),
    replyCount: Number(raw.replyCount ?? 0),
    quoteCount: Number(raw.quoteCount ?? 0),
    hashtags,
    hasMedia,
    mediaType,
    url,
  };
}

function getOrFetchUserId(cleanHandle: string): string {
  const raw = readCache<Record<string, unknown>>(`${cleanHandle}_twitterapi_profile_raw`);
  if (raw) {
    const data = (raw.data as Record<string, unknown>) ?? {};
    return String(data.id ?? "");
  }
  return "";
}

export async function fetchUserTweets(
  username: string,
  maxItems: number = 30
): Promise<Tweet[]> {
  const cleanHandle = username.replace(/^@/, "");

  const cached = readCache<Tweet[]>(`${cleanHandle}_twitterapi_tweets`);
  if (cached) {
    console.log(`[cache] Using cached tweets for @${cleanHandle}`);
    getProgress()?.log(`Using cached tweets for @${cleanHandle}`, "cache");
    return cached;
  }

  const userId = getOrFetchUserId(cleanHandle);
  if (!userId) {
    throw new Error(`[twitterapi] No userId found for @${cleanHandle} — profile must be fetched first`);
  }

  const collected: Array<Record<string, unknown>> = [];
  const rawResponses: Array<Record<string, unknown>> = [];
  let cursor = "";
  let pages = 0;
  const MAX_PAGES = 10; // hard safety cap

  while (collected.length < maxItems && pages < MAX_PAGES) {
    const query: Record<string, string> = { userId };
    if (cursor) query.cursor = cursor;

    const json = await twitterApiGet("/twitter/user/last_tweets", query);
    rawResponses.push(json);
    console.log(`[twitterapi] /user/last_tweets response for @${cleanHandle} (page ${pages + 1}):`, JSON.stringify(json, null, 2));
    pages++;

    const pageData = (json.data as Record<string, unknown>) ?? {};
    const tweets = (pageData.tweets as Array<Record<string, unknown>>) ?? [];
    collected.push(...tweets);
    getProgress()?.log(
      `@${cleanHandle} page ${pages}: ${tweets.length} tweets (total ${collected.length})`,
      "twitterapi",
    );

    const hasNext = Boolean(pageData.has_next_page);
    const next = String(pageData.next_cursor ?? "");
    if (!hasNext || !next || tweets.length === 0) break;
    cursor = next;
  }

  writeCache(`${cleanHandle}_twitterapi_tweets_raw`, rawResponses);

  if (collected.length === 0) {
    console.warn(`[twitterapi] no tweets for @${cleanHandle}`);
    getProgress()?.log(`no tweets for @${cleanHandle}`, "twitterapi", "warn");
    writeCache(`${cleanHandle}_twitterapi_tweets`, []);
    return [];
  }

  const tweets = collected
    .slice(0, maxItems)
    .map((raw) => normalizeTweet(raw, cleanHandle));

  writeCache(`${cleanHandle}_twitterapi_tweets`, tweets);
  return tweets;
}

export async function getUserProfile(username: string): Promise<UserProfile> {
  const cleanHandle = username.replace(/^@/, "");

  const cached = readCache<UserProfile>(`${cleanHandle}_twitterapi_profile`);
  if (cached) {
    console.log(`[cache] Using cached profile for @${cleanHandle}`);
    getProgress()?.log(`Using cached profile for @${cleanHandle}`, "cache");
    return cached;
  }

  const json = await twitterApiGet("/twitter/user/info", { userName: cleanHandle });
  writeCache(`${cleanHandle}_twitterapi_profile_raw`, json);

  const data = (json.data as Record<string, unknown>) ?? {};
  if (!data || Object.keys(data).length === 0) {
    throw new Error(`Could not find profile for @${cleanHandle}`);
  }

  const profile: UserProfile = {
    username: String(data.userName ?? cleanHandle),
    displayName: String(data.name ?? cleanHandle),
    followersCount: Number(data.followers ?? 0),
    followingCount: Number(data.following ?? 0),
    tweetsCount: Number(data.statusesCount ?? 0),
    description: String(data.description ?? ""),
    verified: Boolean(data.isBlueVerified ?? false),
  };

  writeCache(`${cleanHandle}_twitterapi_profile`, profile);
  return profile;
}
