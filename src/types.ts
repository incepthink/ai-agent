export interface Tweet {
  id: string;
  text: string;
  createdAt: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  hashtags: string[];
  hasMedia: boolean;
  mediaType?: "photo" | "video" | "gif";
  url: string;
}

export interface UserProfile {
  username: string;
  displayName: string;
  followersCount: number;
  followingCount: number;
  tweetsCount: number;
  description: string;
  verified: boolean;
}

export interface CompetitorData {
  profile: UserProfile;
  tweets: Tweet[];
}

export interface TargetData {
  profile: UserProfile;
  tweets: Tweet[];
}

export type PatternKind = "hook" | "format" | "angle" | "topic";

export interface Pattern {
  id: string;
  kind: PatternKind;
  signature: string;
  description: string;
  sourceTweetIds: string[];
  competitorHandles: string[];
  avgEngagement: number;
  frequency: number;
}

export interface VoiceProfile {
  handle: string;
  sampleSize: number;
  avgTweetLength: number;
  sentenceLengthP50: number;
  emojiRate: number;
  hashtagRate: number;
  punctuationFingerprint: {
    ellipsis: number;
    emDash: number;
    questionMark: number;
    exclamation: number;
  };
  vocabulary: {
    topNouns: string[];
    topVerbs: string[];
  };
  hookPatterns: string[];
  taboo: string[];
  styleNotes: string;
  exampleTweets: { id: string; text: string }[];
}

export type CandidateFormat =
  | "one-liner"
  | "hot-take"
  | "hook"
  | "observation"
  | "micro-framework"
  | "question";

export interface CandidateScores {
  quality: number;
  brandFit: number;
  plagiarismRisk: number;
  effort: number;
  expectedEngagement: number;
  composite: number;
}

export interface SourceEvidence {
  tweetId: string;
  handle: string;
  excerpt: string;
  url: string;
  metric: string;
}

export interface PostCandidate {
  id: string;
  tier: "hero" | "backup";
  rank: number;
  text: string;
  imageBrief?: string;
  format: CandidateFormat;
  theme: string;
  scores: CandidateScores;
  reasoning: string;
  sourcePatternIds: string[];
  sourceEvidence: SourceEvidence[];
  createdAt: string;
}

export interface Insights {
  generatedAt: string;
  target: string;
  competitors: string[];
  topHooks: { signature: string; description: string; avgEngagement: number; frequency: number }[];
  topFormats: { signature: string; description: string; avgEngagement: number; frequency: number }[];
  hotTopics: { topic: string; mentions: number; avgEngagement: number }[];
  postingCadence: { handle: string; postsPerWeek: number; medianHourUTC: number }[];
  patterns: Pattern[];
}

export type OnlineProvider = "apify" | "twitterapi";

export interface AgentOptions {
  target: string;
  competitors: string[];
  count?: number;
  daysBack?: number;
  maxTweetsPerUser?: number;
  demo?: boolean;
  provider?: OnlineProvider;
}

// ─────────────────────────────────────────────
// Offline mode (--offline) types
// ─────────────────────────────────────────────

export type OfflinePostType = "tweet" | "repost" | "pinned_tweet";

export interface OfflineTweet extends Tweet {
  handle: string; // normalized handle, no leading @
  accountName: string;
  dateRaw: string;
  postType: OfflinePostType;
  isRepost: boolean;
  repostedBy: string | null;
  isPinned: boolean;
  mediaDescription: string | null;
}

export type ReuseMethod =
  | "topic remix"
  | "hook remix"
  | "format remix"
  | "CTA remix"
  | "campaign remix"
  | "visual adaptation"
  | "contrarian response"
  | "simplified version"
  | "expanded version"
  | "repost/commentary adaptation";

export type IdeaPriority = "high" | "medium" | "low";
export type IdeaDifficulty = "easy" | "medium" | "hard";
export type SimilarityRisk = "low" | "medium" | "high";

export interface FillerPostIdea {
  id: string;
  sourceCompetitorHandle: string;
  sourceCompetitorAccountName: string;
  sourceCompetitorPostText: string;
  sourceCompetitorPostType: OfflinePostType;
  sourceCompetitorDate: string;
  sourceMediaDescription: string | null;
  sourceWasRepost: boolean;
  repostedBy: string | null;
  extractedIdea: string;
  extractedHookPattern: string;
  reuseMethod: ReuseMethod;
  adaptedPostForTarget: string;
  visualDirection: string;
  suggestedHashtags: string[];
  bestPostingWindow: string;
  priority: IdeaPriority;
  difficulty: IdeaDifficulty;
  estimatedProductionTime: string;
  brandFitScore: number;
  usefulnessScore: number;
  similarityRisk: SimilarityRisk;
  plagiarismWarning: string;
  whyThisWorks: string;
  whyItFitsTargetAccount: string;
}

export type DataWarningKind =
  | "missing-metrics"
  | "missing-urls"
  | "unparseable-date"
  | "filename-fallback"
  | "missing-file"
  | "empty-content"
  | "no-tweets-loaded";

export interface DataWarning {
  kind: DataWarningKind;
  handle?: string;
  file?: string;
  message: string;
}
