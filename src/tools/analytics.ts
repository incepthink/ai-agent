import OpenAI from "openai";
import type { Tweet } from "../types.js";
import {
  getTweetsLimited,
  getTweetsSince,
  getTweetsByEngagement,
  getTopCandidates,
} from "../db.js";
import { fetchUserTweets, getUserProfile } from "./twitter-twitterapi.js";

// ── tool definitions ──────────────────────────────────────────────────────────

let _competitorHandles: string[] = [];

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "fetch_competitors_timing",
      description:
        "Fetch recent tweets for ALL competitor accounts and return a breakdown of average engagement by UTC hour-of-day. " +
        "Use when the user asks about optimal posting time, when competitors post, or timing/cadence patterns.",
      parameters: {
        type: "object",
        properties: {
          count: { type: "number", description: "Tweets to fetch per competitor (default 50)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_latest_tweets",
      description:
        "Fetch the latest tweets live from the Twitter API, bypassing the cache. " +
        "Use this when the user asks about recent, latest, today's, or current performance. " +
        "Updates the local database after fetching.",
      parameters: {
        type: "object",
        properties: {
          handle: { type: "string", description: "Twitter handle including @" },
          count: { type: "number", description: "Number of tweets to fetch (default 20)" },
        },
        required: ["handle"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_cached_tweets",
      description:
        "Read tweets from the local database (no API call). " +
        "Use for historical questions, trend analysis, or when freshness is not required. " +
        "Optionally filter to the last N days.",
      parameters: {
        type: "object",
        properties: {
          handle: { type: "string", description: "Twitter handle including @" },
          limit: { type: "number", description: "Max number of tweets to return (default 50)" },
          since_days: {
            type: "number",
            description: "If provided, only return tweets from the last N days",
          },
        },
        required: ["handle"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tweets_by_engagement",
      description:
        "Return tweets sorted by total engagement (likes + retweets + replies) from the local database. " +
        "Use for questions about best-performing, most popular, or top tweets.",
      parameters: {
        type: "object",
        properties: {
          handle: { type: "string", description: "Twitter handle including @" },
          limit: { type: "number", description: "Number of top tweets to return (default 10)" },
        },
        required: ["handle"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_candidates",
      description:
        "Return previously generated post candidates/suggestions for this profile. " +
        "Use when the user asks about generated posts, suggestions, or ideas.",
      parameters: {
        type: "object",
        properties: {
          handle: { type: "string", description: "Twitter handle including @" },
          n: { type: "number", description: "Number of candidates to return (default 5)" },
        },
        required: ["handle"],
      },
    },
  },
];

// ── tool execution ────────────────────────────────────────────────────────────

function serializeTweets(tweets: Tweet[]): string {
  if (tweets.length === 0) return "No tweets found.";
  return tweets
    .map(
      (t, i) =>
        `[${i + 1}] Posted: ${t.createdAt}\n` +
        `    Text: ${t.text}\n` +
        `    Likes: ${t.likeCount} | Retweets: ${t.retweetCount} | Replies: ${t.replyCount} | Quotes: ${t.quoteCount}\n` +
        `    URL: ${t.url}`
    )
    .join("\n\n");
}

async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const handle = String(args.handle ?? "");

  if (name === "fetch_competitors_timing") {
    if (_competitorHandles.length === 0) return "No competitor handles configured.";
    const count = Number(args.count ?? 50);

    const results = await Promise.all(
      _competitorHandles.map(async (ch) => {
        try {
          await getUserProfile(ch);
        } catch { /* already cached */ }
        const tweets = await fetchUserTweets(ch, count, false);
        return { handle: ch, tweets };
      })
    );

    const lines: string[] = [];
    for (const { handle: ch, tweets } of results) {
      const byHour: Record<number, { total: number; count: number }> = {};
      for (const t of tweets) {
        const hour = new Date(t.createdAt).getUTCHours();
        if (!byHour[hour]) byHour[hour] = { total: 0, count: 0 };
        byHour[hour].total += (t.likeCount ?? 0) + (t.retweetCount ?? 0) + (t.replyCount ?? 0);
        byHour[hour].count++;
      }
      const sorted = Object.entries(byHour)
        .map(([h, v]) => ({ hour: Number(h), avg: v.total / v.count, count: v.count }))
        .sort((a, b) => b.avg - a.avg);
      lines.push(`\n@${ch} (${tweets.length} tweets analyzed):`);
      lines.push("UTC Hour | Avg Engagement | Tweet Count");
      for (const row of sorted.slice(0, 6)) {
        lines.push(`  ${String(row.hour).padStart(2, "0")}:00   |   ${row.avg.toFixed(1).padStart(6)}       |   ${row.count}`);
      }
    }
    return lines.join("\n");
  }

  if (name === "fetch_latest_tweets") {
    const count = Number(args.count ?? 20);
    // Ensure profile cache exists so fetchUserTweets can resolve the userId
    try {
      await getUserProfile(handle);
    } catch {
      // profile already cached — ignore error
    }
    const tweets = await fetchUserTweets(handle, count, true);
    return `Fetched ${tweets.length} latest tweets for ${handle}:\n\n${serializeTweets(tweets)}`;
  }

  if (name === "get_cached_tweets") {
    const limit = Number(args.limit ?? 50);
    const sinceDays = args.since_days != null ? Number(args.since_days) : null;
    const tweets = sinceDays !== null
      ? getTweetsSince(handle, sinceDays)
      : getTweetsLimited(handle, limit);
    return `Retrieved ${tweets.length} cached tweets for ${handle}:\n\n${serializeTweets(tweets)}`;
  }

  if (name === "get_tweets_by_engagement") {
    const limit = Number(args.limit ?? 10);
    const tweets = getTweetsByEngagement(handle, limit);
    return `Top ${tweets.length} tweets by engagement for ${handle}:\n\n${serializeTweets(tweets)}`;
  }

  if (name === "get_top_candidates") {
    const n = Number(args.n ?? 5);
    const candidates = getTopCandidates(handle, n);
    if (candidates.length === 0) return "No generated candidates found. Run /run first.";
    return candidates
      .map((c, i) => {
        const scores = JSON.parse(c.scores) as Record<string, number>;
        return (
          `[${i + 1}] Tier: ${c.tier} | Format: ${c.format} | Score: ${scores.composite?.toFixed(2) ?? "?"}\n` +
          `    Generated: ${c.created_at}\n` +
          `    Text: ${c.text}`
        );
      })
      .join("\n\n");
  }

  return `Unknown tool: ${name}`;
}

// ── main analytics runner ─────────────────────────────────────────────────────

export async function runAnalytics(
  handle: string,
  competitorHandles: string[],
  question: string,
  openai: OpenAI
): Promise<string> {
  _competitorHandles = competitorHandles;

  const competitorCtx = competitorHandles.length
    ? `Competitors to analyze: ${competitorHandles.join(", ")}. ` +
      `When asked about timing, competitors, or patterns across accounts, call fetch_competitors_timing. `
    : "";

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        `You are a Twitter analytics assistant for the account ${handle}. ` +
        competitorCtx +
        `Use the provided tools to fetch the data needed to answer the user's question, ` +
        `then give a clear, concise answer backed by numbers. ` +
        `Only call a tool if you actually need data — if the question can be answered without data, answer directly.`,
    },
    { role: "user", content: question },
  ];

  // allow up to 5 tool-call rounds (multi-competitor fetches need more rounds)
  for (let round = 0; round < 5; round++) {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      tools: TOOLS,
      messages,
    });

    const choice = response.choices[0];
    if (!choice) break;

    const msg = choice.message;
    messages.push(msg);

    if (choice.finish_reason === "stop" || !msg.tool_calls?.length) {
      return msg.content ?? "No answer generated.";
    }

    // execute all tool calls in this round
    for (const call of msg.tool_calls) {
      let result: string;
      try {
        const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
        result = await executeTool(call.function.name, args);
      } catch (err) {
        result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  return "Could not generate an answer. Please try rephrasing your question.";
}
