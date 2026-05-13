import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import {
  configureLocalProvider,
  fetchOfflineTweets,
  getUserProfile,
  getWarnings,
  recordGlobalDataWarnings,
  resetLocalProviderState,
} from "./tools/twitter-local.js";
import { inferVoiceProfile } from "./tools/voice.js";
import { selectSourceTweets } from "./tools/source-select.js";
import {
  PROMPT_SCHEMA_VERSION,
  VOICE_PROMPT_VERSION,
  generateFillerPostIdeas,
} from "./tools/filler-posts.js";
import {
  fillerCacheHash,
  readFillerCache,
  voiceCacheHash,
  readVoiceCache,
  writeFillerCache,
  writeVoiceCache,
} from "./tools/offline-cache.js";
import { renderOfflineDashboard, type DatasetSummary } from "./tools/dashboard-offline.js";
import type { FillerPostIdea, OfflineTweet, VoiceProfile } from "./types.js";

export interface OfflineAgentOptions {
  target: string;
  competitors: string[];
  dataDir: string;
  maxTweetsPerUser: number;
  maxSourceTweets: number;
  maxIdeas: number;
  model: string;
  force: boolean;
  csv: boolean;
}

export interface OfflineRunResult {
  ideas: FillerPostIdea[];
  fillerPostsPath: string;
  dashboardPath: string;
  dataWarningsPath: string;
  csvPath: string | null;
  cacheHit: boolean;
}

const OUTPUT_DIR = "./output";

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function requireOpenAIKey(reason: string): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    console.error(`\nOPENAI_API_KEY required — ${reason}.`);
    console.error("Add OPENAI_API_KEY to .env, or rerun without --force to reuse cached output.");
    process.exit(1);
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(ideas: FillerPostIdea[]): string {
  const csvPath = path.join(OUTPUT_DIR, "filler-posts.csv");
  const header = [
    "id", "sourceCompetitorHandle", "sourceCompetitorPostType", "sourceWasRepost",
    "reuseMethod", "priority", "difficulty", "brandFitScore", "usefulnessScore",
    "similarityRisk", "adaptedPostForTarget", "visualDirection", "suggestedHashtags",
    "bestPostingWindow", "estimatedProductionTime",
  ];
  const lines = [header.join(",")];
  for (const i of ideas) {
    lines.push([
      i.id,
      i.sourceCompetitorHandle,
      i.sourceCompetitorPostType,
      String(i.sourceWasRepost),
      i.reuseMethod,
      i.priority,
      i.difficulty,
      String(i.brandFitScore),
      String(i.usefulnessScore),
      i.similarityRisk,
      i.adaptedPostForTarget,
      i.visualDirection,
      i.suggestedHashtags.join(" "),
      i.bestPostingWindow,
      i.estimatedProductionTime,
    ].map(csvEscape).join(","));
  }
  fs.writeFileSync(csvPath, lines.join("\n"));
  console.log(`[csv] Wrote ${csvPath}`);
  return csvPath;
}

export async function runOfflineAgent(options: OfflineAgentOptions): Promise<OfflineRunResult> {
  resetLocalProviderState();
  configureLocalProvider({ dataDir: options.dataDir });

  const cleanTarget = options.target.replace(/^@/, "");
  const cleanCompetitors = options.competitors.map((c) => c.replace(/^@/, ""));

  console.log(`\n[offline 1/6] Loading local JSON from ${options.dataDir}...`);
  const targetTweets = await fetchOfflineTweets(cleanTarget, options.maxTweetsPerUser);
  const targetProfile = await getUserProfile(cleanTarget);
  const competitorPairs = await Promise.all(
    cleanCompetitors.map(async (handle) => {
      const tweets = await fetchOfflineTweets(handle, options.maxTweetsPerUser);
      const profile = await getUserProfile(handle);
      return { handle, profile, tweets };
    })
  );
  recordGlobalDataWarnings([cleanTarget, ...cleanCompetitors]);

  const allCompetitorTweets: OfflineTweet[] = competitorPairs.flatMap((c) => c.tweets);

  console.log(
    `[offline 1/6] Loaded target=${targetTweets.length}, competitors=${competitorPairs
      .map((c) => `${c.handle}:${c.tweets.length}`)
      .join(", ")}`
  );

  // ── Cache check first — if hit, skip everything except render.
  const cacheKey = {
    targetHandle: cleanTarget,
    competitorHandles: cleanCompetitors,
    targetTweets,
    competitorTweets: allCompetitorTweets,
    maxIdeas: options.maxIdeas,
    maxSourceTweets: options.maxSourceTweets,
    model: options.model,
    promptSchemaVersion: PROMPT_SCHEMA_VERSION,
  };
  const fillerHash = fillerCacheHash(cacheKey);

  let voice: VoiceProfile | undefined;
  let ideas: FillerPostIdea[] = [];
  let cacheHit = false;

  if (!options.force) {
    const cached = readFillerCache(fillerHash);
    if (cached) {
      console.log(`[offline cache] Hit ${fillerHash} — skipping LLM calls.`);
      voice = cached.voice;
      ideas = cached.ideas;
      cacheHit = true;
    }
  }

  if (!cacheHit) {
    // Voice (its own cache layer, keyed only on target inputs).
    console.log(`\n[offline 2/6] Inferring voice profile for @${cleanTarget}...`);
    const vKey = {
      targetHandle: cleanTarget,
      targetTweets,
      voicePromptVersion: VOICE_PROMPT_VERSION,
      model: options.model,
    };
    const vHash = voiceCacheHash(vKey);
    const vCached = options.force ? null : readVoiceCache(vHash);
    if (vCached) {
      console.log(`[offline cache] Voice hit ${vHash}`);
      voice = vCached;
    } else {
      const openai = requireOpenAIKey("voice cache miss");
      voice = await inferVoiceProfile(openai, cleanTarget, targetTweets);
      writeVoiceCache(vHash, voice);
    }
    console.log(`[offline 2/6] Voice: ${voice.styleNotes || "(no style notes)"}`);

    console.log(`\n[offline 3/6] Selecting up to ${options.maxSourceTweets} source tweets...`);
    const selected = selectSourceTweets(allCompetitorTweets, {
      maxSourceTweets: options.maxSourceTweets,
    });
    console.log(`[offline 3/6] Selected ${selected.length} sources (from ${allCompetitorTweets.length} total)`);

    console.log(`\n[offline 4/6] Generating filler-post ideas (model ${options.model})...`);
    const openai = requireOpenAIKey("filler-ideas cache miss");
    ideas = await generateFillerPostIdeas(
      openai,
      cleanTarget,
      voice,
      selected,
      allCompetitorTweets,
      { model: options.model, maxIdeas: options.maxIdeas }
    );
    console.log(`[offline 4/6] Got ${ideas.length} ranked ideas`);

    writeFillerCache(fillerHash, {
      generatedAt: new Date().toISOString(),
      voice,
      ideas,
    });
  }

  if (!voice) {
    throw new Error("Internal error: voice profile was not produced.");
  }

  ensureOutputDir();

  // Write filler-posts.json (always).
  console.log(`\n[offline 5/6] Writing artifacts...`);
  const fillerPostsPath = path.join(OUTPUT_DIR, "filler-posts.json");
  fs.writeFileSync(fillerPostsPath, JSON.stringify(ideas, null, 2));
  console.log(`[offline 5/6] Wrote ${fillerPostsPath}`);

  // Optional CSV.
  let csvPath: string | null = null;
  if (options.csv) csvPath = writeCsv(ideas);

  // Data warnings (always written, even if empty).
  const warnings = getWarnings();
  const dataWarningsPath = path.join(OUTPUT_DIR, "data-warnings.json");
  fs.writeFileSync(dataWarningsPath, JSON.stringify(warnings, null, 2));
  console.log(`[offline 5/6] Wrote ${dataWarningsPath} (${warnings.length} warnings)`);

  // Dashboard.
  console.log(`\n[offline 6/6] Rendering dashboard...`);
  const dataset: DatasetSummary = {
    source: "offline",
    targetHandle: cleanTarget,
    targetAccountName: targetProfile.displayName,
    targetTweetCount: targetTweets.length,
    competitorCounts: competitorPairs.map((c) => ({
      handle: c.handle,
      accountName: c.profile.displayName,
      count: c.tweets.length,
    })),
  };
  const dashboardPath = renderOfflineDashboard(ideas, voice, dataset, warnings);

  return {
    ideas,
    fillerPostsPath,
    dashboardPath,
    dataWarningsPath,
    csvPath,
    cacheHit,
  };
}
