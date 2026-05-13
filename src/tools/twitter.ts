import fs from "node:fs";
import path from "node:path";
import { ApifyClient } from "apify-client";
import type { Tweet, UserProfile } from "../types.js";

const client = new ApifyClient({ token: process.env.APIFY_API_KEY });

const CACHE_DIR = "./cache";

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

// Apify actor: apidojo/tweet-scraper
// Docs: https://apify.com/apidojo/tweet-scraper

export async function fetchUserTweets(
  username: string,
  maxItems: number = 50
): Promise<Tweet[]> {
  const cleanHandle = username.replace(/^@/, "");

  const cached = readCache<Tweet[]>(`${cleanHandle}_tweets`);
  if (cached) {
    console.log(`[cache] Using cached tweets for @${cleanHandle}`);
    return cached;
  }

  const run = await client.actor("apidojo/tweet-scraper").call({
    startUrls: [`https://twitter.com/${cleanHandle}`],
    maxItems,
    onlyUserTweets: true,
    addUserInfo: false,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  writeCache(`${cleanHandle}_tweets_raw`, items);

  const tweets = items.map((item): Tweet => {
    const raw = item as Record<string, unknown>;
    const entities = (raw.entities as Record<string, unknown>) ?? {};
    const hashtags = (
      (entities.hashtags as Array<Record<string, string>>) ?? []
    ).map((h) => h.text ?? "");

    const mediaArr = (raw.extended_entities as Record<string, unknown>)
      ?.media as Array<Record<string, string>> | undefined;
    const hasMedia = Array.isArray(mediaArr) && mediaArr.length > 0;
    const mediaType = hasMedia
      ? (mediaArr![0].type as "photo" | "video" | "gif")
      : undefined;

    return {
      id: String(raw.id_str ?? raw.id ?? ""),
      text: String(raw.full_text ?? raw.text ?? ""),
      createdAt: String(raw.created_at ?? ""),
      likeCount: Number(raw.favorite_count ?? 0),
      retweetCount: Number(raw.retweet_count ?? 0),
      replyCount: Number(raw.reply_count ?? 0),
      quoteCount: Number(raw.quote_count ?? 0),
      hashtags,
      hasMedia,
      mediaType,
      url: `https://twitter.com/${cleanHandle}/status/${String(raw.id_str ?? raw.id ?? "")}`,
    };
  });

  writeCache(`${cleanHandle}_tweets`, tweets);
  return tweets;
}

export async function getUserProfile(username: string): Promise<UserProfile> {
  const cleanHandle = username.replace(/^@/, "");

  const cached = readCache<UserProfile>(`${cleanHandle}_profile`);
  if (cached) {
    console.log(`[cache] Using cached profile for @${cleanHandle}`);
    return cached;
  }

  const run = await client.actor("apidojo/tweet-scraper").call({
    startUrls: [`https://twitter.com/${cleanHandle}`],
    maxItems: 1,
    onlyUserTweets: true,
    addUserInfo: true,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  writeCache(`${cleanHandle}_profile_raw`, items);

  if (items.length === 0) {
    throw new Error(`Could not find profile for @${cleanHandle}`);
  }

  const raw = items[0] as Record<string, unknown>;
  const user = (raw.user as Record<string, unknown>) ?? raw;

  const profile: UserProfile = {
    username: String(user.screen_name ?? cleanHandle),
    displayName: String(user.name ?? cleanHandle),
    followersCount: Number(user.followers_count ?? 0),
    followingCount: Number(user.friends_count ?? 0),
    tweetsCount: Number(user.statuses_count ?? 0),
    description: String(user.description ?? ""),
    verified: Boolean(user.verified ?? false),
  };

  writeCache(`${cleanHandle}_profile`, profile);
  return profile;
}
