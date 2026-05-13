import type { Tweet, UserProfile } from "../types.js";

function makeRng(seed: string) {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h) ^ seed.charCodeAt(i);
    h = h | 0;
  }
  return function () {
    h ^= h >>> 13;
    h = (h ^ (h << 17)) | 0;
    h ^= h >>> 5;
    return (h >>> 0) / 0xffffffff;
  };
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function randInt(min: number, max: number, rng: () => number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

const TOPICS = [
  "large language models", "AI safety", "multimodal AI", "autonomous agents",
  "computer vision", "natural language processing", "reinforcement learning",
  "foundation models", "AI alignment", "generative AI", "AI infrastructure",
  "prompt engineering", "retrieval-augmented generation", "fine-tuning",
];

const METRICS = ["34", "67", "89", "12", "45", "78", "92", "56", "23", "81", "40", "63"];

const HASHTAG_SETS = [
  ["AI", "MachineLearning"], ["LLM", "OpenSource"], ["DeepLearning", "Research"],
  ["AIAlignment", "Safety"], ["GenerativeAI", "Innovation"], ["NLP", "AI"],
  ["Tech", "Innovation"], ["OpenSource", "Dev"], ["MLOps", "AI"],
  ["ComputerVision", "AI"], ["DataScience", "ML"], ["AGI", "Research"],
  ["AIResearch"], ["LLM", "GenAI"], ["Startup", "AI", "Tech"],
];

const TWEET_BODIES = [
  "Excited to share our latest research on {topic}. We're seeing {metric}% improvement over state-of-the-art. The key insight: scaling isn't the only path forward. Blog post in thread 👇",
  "We just open-sourced our {topic} toolkit after 18 months of internal development. The community response has been incredible — 2k stars in 48 hours. 🚀",
  "Today we're announcing our new approach to {topic}. It's faster, more capable, and more efficient than anything we've released before. Early access opens next week.",
  "Hot take: most companies are solving the wrong problem with {topic}. The bottleneck isn't compute — it's data quality and evaluation rigor.",
  "We trained on {metric}B tokens and the results surprised even us. Sometimes the best discoveries come from questioning your core assumptions.",
  "We're hiring across {topic} research, engineering, and policy. If you want to work on problems that matter, we'd love to talk.",
  "Paper drop: 'Scaling Laws Revisited for {topic}' — Careful data curation beats raw scale on {metric}% of our benchmarks. Full paper linked in thread.",
  "We've been quietly working on a new approach to {topic} for the past year. Today we're ready to share what we've learned. A thread 🧵",
  "Security update: we've patched the {topic} issue flagged by researchers last week. Thank you to the community for responsible disclosure.",
  "Benchmark results don't tell the whole story. Real-world {topic} performance varies dramatically based on prompt design and domain-specific fine-tuning.",
  "We reduced inference cost for {topic} by {metric}% while maintaining quality. The trick was rethinking the attention mechanism from scratch.",
  "A reminder that {topic} is still fundamentally a research problem. We've made progress, but there's still a lot we don't understand — and that's exciting.",
  "Our latest API update brings {metric}% lower latency for {topic} workloads. Updated docs and migration guide linked below.",
  "Fascinating community research on emergent capabilities in {topic}. This is exactly the kind of rigorous work the field needs more of.",
  "The gap between lab benchmarks and production deployments for {topic} is wider than most people realise. Here's what we've learned from shipping at scale.",
  "We're committing $10M over 3 years to fund university research on {topic} safety. Applications are open — details in thread.",
  "Prompt injection is still a serious problem for {topic} applications. Here's our current thinking on mitigations and what developers should know.",
  "Happy to announce {topic} support is now generally available. Six months in beta, and we've addressed the top {metric} issues raised by developers.",
  "The most underrated skill in AI: knowing when NOT to use {topic}. A deterministic rule is often faster, cheaper, and more reliable.",
  "We're seeing incredible things from developers building with {topic} — accessibility tools, scientific research, creative applications. Thread of highlights 🧵",
  "Launching our new evaluation framework for {topic}. Open source, reproducible, and designed to catch the failure modes that standard benchmarks miss.",
  "Real talk: {metric}% of the {topic} demos you see online wouldn't survive contact with real users. We wrote about what production actually looks like.",
  "We're hosting a research symposium on {topic} in SF next month. Speakers include leading academics and practitioners. Registration link in bio.",
  "Just published our model card for the latest {topic} release. We believe transparency here is non-negotiable — full evals, limitations, and training details.",
  "Collaboration > competition. We're partnering with three other labs to share safety research on {topic}. Details on what this means for the field.",
];

const REPLY_BODIES = [
  "Great question! We explored this in our ablation study — the short version is it depends heavily on your data distribution.",
  "Thanks for the detailed feedback. This is on our roadmap and your input will help us prioritise.",
  "Appreciate you flagging this. Our team is actively investigating and we'll post an update when we know more.",
  "We agree — this is one of the hardest problems we're working on. No clean answer yet, but we're making progress.",
  "The short answer is yes. The longer answer is in our technical report linked in the original thread.",
  "Really interesting point. Have you seen the follow-up work from the team at CMU? Very relevant to what you're describing.",
  "We'll be publishing a detailed write-up on this next week. Subscribe to our newsletter to get it directly.",
];

const PROFILE_DESCRIPTIONS = [
  "Building the future of AI. Research, safety, and deployment at scale. We're hiring.",
  "Open-source AI tools for developers. Making AI accessible to everyone, everywhere.",
  "AI research lab focused on beneficial artificial intelligence. Pursuing alignment + capability.",
  "Advancing AI through rigorous research and responsible deployment. Founded 2019.",
  "The developer platform for AI-powered applications. 100k+ teams trust us in production.",
  "Multimodal AI for the real world. Vision, language, and action — unified.",
  "Safety-first AI. We believe the transition to powerful AI can and must go well.",
  "AI infrastructure for scale. Helping teams move from prototype to production.",
];

export function fetchUserTweets(username: string, maxItems: number = 50): Promise<Tweet[]> {
  const cleanHandle = username.replace(/^@/, "").toLowerCase();
  const rng = makeRng(cleanHandle + "_tweets_v2");

  // Scale engagement by handle characteristics (deterministic but varied)
  const engagementScale = 1 + (cleanHandle.charCodeAt(0) % 10) * 0.4 + (cleanHandle.length % 5) * 0.2;
  const now = Date.now();
  const tweets: Tweet[] = [];

  for (let i = 0; i < maxItems; i++) {
    // Spread posts across last 30 days; cluster around business hours
    const daysAgo = rng() * 30;
    const postTime = new Date(now - daysAgo * 86_400_000);

    // Realistic posting hours: weight toward 9-11am and 1-4pm
    const peakHours = [9, 9, 10, 10, 11, 13, 14, 14, 15, 15, 16, 8, 17, 20, 21];
    postTime.setHours(pick(peakHours, rng), randInt(0, 59, rng), 0, 0);

    const isReply = rng() < 0.15;
    const topic = pick(TOPICS, rng);
    const metric = pick(METRICS, rng);
    const bodyTemplate = isReply ? pick(REPLY_BODIES, rng) : pick(TWEET_BODIES, rng);
    const text = bodyTemplate.replace(/{topic}/g, topic).replace(/{metric}/g, metric);

    const hasMedia = !isReply && rng() < 0.38;
    const mediaTypes: Array<"photo" | "video" | "gif"> = ["photo", "photo", "photo", "video", "gif"];
    const mediaType = hasMedia ? pick(mediaTypes, rng) : undefined;

    const hashtagSet = isReply ? [] : pick(HASHTAG_SETS, rng);

    // Engagement: scale by follower proxy, add randomness, viral spikes ~5% chance
    const isViral = rng() < 0.05;
    const viralMultiplier = isViral ? randInt(5, 20, rng) : 1;
    const base = engagementScale * (0.3 + rng() * 0.7);
    const likeCount = Math.floor(base * randInt(80, 4000, rng) * viralMultiplier);
    const retweetCount = Math.floor(likeCount * (0.04 + rng() * 0.18));
    const replyCount = Math.floor(likeCount * (0.02 + rng() * 0.08));
    const quoteCount = Math.floor(retweetCount * (0.08 + rng() * 0.25));

    const id = String(BigInt(now) - BigInt(i) * 1000n + BigInt(Math.floor(rng() * 9999)));

    tweets.push({
      id,
      text,
      createdAt: postTime.toUTCString(),
      likeCount,
      retweetCount,
      replyCount,
      quoteCount,
      hashtags: hashtagSet,
      hasMedia,
      mediaType,
      url: `https://twitter.com/${cleanHandle}/status/${id}`,
    });
  }

  tweets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  console.log(`[demo] Generated ${tweets.length} tweets for @${cleanHandle}`);
  return Promise.resolve(tweets);
}

export function getUserProfile(username: string): Promise<UserProfile> {
  const cleanHandle = username.replace(/^@/, "").toLowerCase();
  const rng = makeRng(cleanHandle + "_profile_v2");

  const scale = 1 + (cleanHandle.charCodeAt(0) % 20) * 0.15 + (cleanHandle.length % 6) * 0.1;
  const followersCount = Math.floor(scale * randInt(8_000, 500_000, rng));
  const followingCount = randInt(50, 3_000, rng);
  const tweetsCount = randInt(400, 12_000, rng);

  const displayName =
    cleanHandle.charAt(0).toUpperCase() + cleanHandle.slice(1).replace(/[_-]/g, " ");

  const profile: UserProfile = {
    username: cleanHandle,
    displayName,
    followersCount,
    followingCount,
    tweetsCount,
    description: pick(PROFILE_DESCRIPTIONS, rng),
    verified: rng() > 0.45,
  };

  console.log(
    `[demo] Profile for @${cleanHandle}: ${followersCount.toLocaleString()} followers`
  );
  return Promise.resolve(profile);
}
