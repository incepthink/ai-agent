import OpenAI from "openai";
import {
  fetchUserTweets as fetchUserTweetsApify,
  getUserProfile as getUserProfileApify,
} from "./tools/twitter.js";
import {
  fetchUserTweets as fetchUserTweetsMock,
  getUserProfile as getUserProfileMock,
} from "./tools/twitter-mock.js";
import {
  fetchUserTweets as fetchUserTweetsTwitterApi,
  getUserProfile as getUserProfileTwitterApi,
} from "./tools/twitter-twitterapi.js";
import { inferVoiceProfile } from "./tools/voice.js";
import { minePatterns, buildInsights } from "./tools/mining.js";
import {
  generateCandidates,
  buildEvidence,
  rawToCandidate,
} from "./tools/generate.js";
import { scoreCandidates, filterAndRank } from "./tools/score.js";
import { writeArtifacts } from "./tools/artifacts.js";
import { renderDashboard, type ChartAsset } from "./tools/dashboard.js";
import {
  generatePostingHeatmap,
  generateEngagementChart,
  generateHashtagChart,
  generatePostTypeChart,
  generateComparisonChart,
} from "./tools/chart.js";
import { getProgress } from "./progress.js";
import type {
  AgentOptions,
  CompetitorData,
  PostCandidate,
  TargetData,
  Tweet,
} from "./types.js";

function report(msg: string, source: string = "pipeline"): void {
  console.log(msg);
  getProgress()?.log(msg, source);
}

interface TwitterProvider {
  fetchUserTweets: (username: string, maxItems?: number) => Promise<Tweet[]>;
  getUserProfile: (username: string) => Promise<TargetData["profile"]>;
}

interface RunResult {
  candidates: PostCandidate[];
  postsPath: string;
  insightsPath: string;
  voicePath: string;
  dashboardPath: string;
}

const HERO_COUNT = 7;
const RAW_OVERSAMPLE_RATIO = 1.5; // generate ~50% more than we keep, to absorb plagiarism rejects
const PLAGIARISM_THRESHOLD = 0.15;

export async function runAgent(options: AgentOptions): Promise<RunResult> {
  const {
    target,
    competitors,
    count = 27,
    maxTweetsPerUser = 50,
    demo = false,
    provider,
  } = options;

  const backupCount = Math.max(0, count - HERO_COUNT);
  const rawCount = Math.ceil((HERO_COUNT + backupCount) * RAW_OVERSAMPLE_RATIO);

  const twitter: TwitterProvider = demo
    ? {
        fetchUserTweets: fetchUserTweetsMock,
        getUserProfile: getUserProfileMock,
      }
    : provider === "twitterapi"
      ? {
          fetchUserTweets: fetchUserTweetsTwitterApi,
          getUserProfile: getUserProfileTwitterApi,
        }
      : {
          fetchUserTweets: fetchUserTweetsApify,
          getUserProfile: getUserProfileApify,
        };

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const cleanTarget = target.replace(/^@/, "");
  const cleanCompetitors = competitors.map((c) => c.replace(/^@/, ""));
  const progress = getProgress();

  progress?.stageStart("fetch", "[1/7] Fetch profiles + tweets");
  report(
    `\n[1/7] Fetching profiles — target @${cleanTarget} + ${cleanCompetitors.length} competitors...`,
  );
  const [targetProfile, ...competitorProfiles] = await Promise.all([
    twitter.getUserProfile(cleanTarget),
    ...cleanCompetitors.map((h) => twitter.getUserProfile(h)),
  ]);

  report(`[1/7] Fetching tweets...`);
  const [targetTweets, ...competitorTweetsList] = await Promise.all([
    twitter.fetchUserTweets(cleanTarget, maxTweetsPerUser),
    ...cleanCompetitors.map((h) =>
      twitter.fetchUserTweets(h, maxTweetsPerUser),
    ),
  ]);

  const competitorData: CompetitorData[] = cleanCompetitors.map(
    (_handle, i) => ({
      profile: competitorProfiles[i],
      tweets: competitorTweetsList[i],
    }),
  );

  report(
    `[1/7] Got ${targetTweets.length} target tweets, ${competitorData.reduce((a, c) => a + c.tweets.length, 0)} competitor tweets`,
  );
  progress?.stageEnd("fetch");

  progress?.stageStart("voice", "[2/7] Voice profile");
  report(`\n[2/7] Inferring voice profile from @${cleanTarget}...`);
  const voice = await inferVoiceProfile(openai, cleanTarget, targetTweets);
  report(`[2/7] Voice: ${voice.styleNotes || "(no style notes)"}`);
  progress?.stageEnd("voice");

  progress?.stageStart("mining", "[3/7] Pattern mining");
  report(
    `\n[3/7] Mining patterns from ${competitorData.length} competitor(s)...`,
  );
  const patterns = await minePatterns(openai, competitorData);
  report(`[3/7] Extracted ${patterns.length} unique patterns`);

  const insights = buildInsights(cleanTarget, competitorData, patterns);
  progress?.stageEnd("mining");

  progress?.stageStart("charts", "[3.5/7] Analytics charts");
  report(`\n[3.5/7] Rendering analytics charts...`);
  const chartTasks: Array<Promise<ChartAsset>> = [];
  const pushCharts = (handle: string, tweets: Tweet[]): void => {
    chartTasks.push(
      generatePostingHeatmap(handle, tweets).then((p) => ({ handle, kind: "heatmap", path: p })),
      generateEngagementChart(handle, tweets).then((p) => ({ handle, kind: "engagement", path: p })),
      generateHashtagChart(handle, tweets).then((p) => ({ handle, kind: "hashtags", path: p })),
      generatePostTypeChart(handle, tweets).then((p) => ({ handle, kind: "posttypes", path: p })),
    );
  };
  pushCharts(cleanTarget, targetTweets);
  for (const c of competitorData) pushCharts(c.profile.username, c.tweets);
  chartTasks.push(
    generateComparisonChart(competitorData).then((p) => ({ handle: "_all", kind: "comparison", path: p })),
  );
  const charts = await Promise.all(chartTasks);
  report(`[3.5/7] Rendered ${charts.length} chart PNGs`);
  progress?.stageEnd("charts");

  progress?.stageStart("generate", "[4/7] Generate candidates");
  report(`\n[4/7] Generating ${rawCount} raw candidates...`);
  const rawCandidates = await generateCandidates(
    openai,
    patterns,
    voice,
    rawCount,
  );
  report(`[4/7] LLM returned ${rawCandidates.length} raw candidates`);
  progress?.stageEnd("generate");

  const createdAt = new Date().toISOString();
  let candidates = rawCandidates.map((r, i) => rawToCandidate(r, i, createdAt));

  // Build the tweet index used for both scoring and evidence.
  const tweetIndex = new Map<string, { tweet: Tweet; handle: string }>();
  const allCompetitorTweets: Tweet[] = [];
  for (const c of competitorData) {
    for (const t of c.tweets) {
      tweetIndex.set(t.id, { tweet: t, handle: c.profile.username });
      allCompetitorTweets.push(t);
    }
  }

  progress?.stageStart("score", "[5/7] Score candidates");
  report(`\n[5/7] Scoring ${candidates.length} candidates...`);
  candidates = await scoreCandidates(
    openai,
    candidates,
    voice,
    patterns,
    allCompetitorTweets,
  );
  progress?.stageEnd("score");

  progress?.stageStart("rank", "[6/7] Filter + rank");
  report(
    `\n[6/7] Filtering (plagiarism < ${PLAGIARISM_THRESHOLD}) and ranking...`,
  );
  const rejected = candidates.filter(
    (c) => c.scores.plagiarismRisk >= PLAGIARISM_THRESHOLD,
  ).length;
  if (rejected > 0)
    report(
      `[6/7] Dropped ${rejected} candidates over plagiarism threshold`,
    );

  const ranked = filterAndRank(
    candidates,
    HERO_COUNT,
    backupCount,
    PLAGIARISM_THRESHOLD,
  );

  // Attach source evidence (top patterns per candidate → top tweets).
  for (const c of ranked) {
    c.sourceEvidence = buildEvidence(c.sourcePatternIds, patterns, tweetIndex);
  }

  report(
    `[6/7] Final library: ${ranked.filter((c) => c.tier === "hero").length} hero + ${ranked.filter((c) => c.tier === "backup").length} backup`,
  );
  progress?.stageEnd("rank");

  progress?.stageStart("write", "[7/7] Write artifacts + dashboard");
  report(`\n[7/7] Writing artifacts + dashboard...`);
  const { postsPath, insightsPath, voicePath } = writeArtifacts(
    ranked,
    insights,
    voice,
  );
  const dashboardPath = renderDashboard(ranked, insights, voice, charts);
  progress?.stageEnd("write");

  void targetProfile;

  return {
    candidates: ranked,
    postsPath,
    insightsPath,
    voicePath,
    dashboardPath,
  };
}
