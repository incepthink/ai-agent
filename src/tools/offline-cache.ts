import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FillerPostIdea, OfflineTweet, VoiceProfile } from "../types.js";

const CACHE_ROOT = "./cache";
const FILLER_DIR = path.join(CACHE_ROOT, "offline-filler");
const VOICE_DIR = path.join(CACHE_ROOT, "offline-voice");

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);
}

function tweetsFingerprint(tweets: OfflineTweet[]): string {
  // Stable signature on content + handle + postType only — order-insensitive.
  return tweets
    .map((t) => `${t.id}|${t.postType}|${t.text}`)
    .sort()
    .join("\n");
}

export interface FillerCacheKey {
  targetHandle: string;
  competitorHandles: string[];
  targetTweets: OfflineTweet[];
  competitorTweets: OfflineTweet[];
  maxIdeas: number;
  maxSourceTweets: number;
  model: string;
  promptSchemaVersion: string;
}

export function fillerCacheHash(key: FillerCacheKey): string {
  const payload = [
    `target:${key.targetHandle.toLowerCase()}`,
    `competitors:${[...key.competitorHandles].map((c) => c.toLowerCase()).sort().join(",")}`,
    `target_tweets:${sha256(tweetsFingerprint(key.targetTweets))}`,
    `competitor_tweets:${sha256(tweetsFingerprint(key.competitorTweets))}`,
    `maxIdeas:${key.maxIdeas}`,
    `maxSourceTweets:${key.maxSourceTweets}`,
    `model:${key.model}`,
    `schema:${key.promptSchemaVersion}`,
  ].join("|");
  return sha256(payload);
}

export interface FillerCacheEntry {
  generatedAt: string;
  voice: VoiceProfile;
  ideas: FillerPostIdea[];
}

export function readFillerCache(hash: string): FillerCacheEntry | null {
  const file = path.join(FILLER_DIR, `${hash}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as FillerCacheEntry;
  } catch {
    return null;
  }
}

export function writeFillerCache(hash: string, entry: FillerCacheEntry) {
  ensureDir(FILLER_DIR);
  const file = path.join(FILLER_DIR, `${hash}.json`);
  fs.writeFileSync(file, JSON.stringify(entry, null, 2));
}

export interface VoiceCacheKey {
  targetHandle: string;
  targetTweets: OfflineTweet[];
  voicePromptVersion: string;
  model: string;
}

export function voiceCacheHash(key: VoiceCacheKey): string {
  const payload = [
    `target:${key.targetHandle.toLowerCase()}`,
    `tweets:${sha256(tweetsFingerprint(key.targetTweets))}`,
    `voice_schema:${key.voicePromptVersion}`,
    `model:${key.model}`,
  ].join("|");
  return sha256(payload);
}

export function readVoiceCache(hash: string): VoiceProfile | null {
  const file = path.join(VOICE_DIR, `${hash}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as VoiceProfile;
  } catch {
    return null;
  }
}

export function writeVoiceCache(hash: string, voice: VoiceProfile) {
  ensureDir(VOICE_DIR);
  const file = path.join(VOICE_DIR, `${hash}.json`);
  fs.writeFileSync(file, JSON.stringify(voice, null, 2));
}
