import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import type { Tweet, CompetitorData } from "../types.js";

function safeHandle(h: string): string {
  return h.replace(/[^a-zA-Z0-9_-]/g, "_");
}

const OUTPUT_DIR = "./output";
const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 500;

const renderer = new ChartJSNodeCanvas({
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  backgroundColour: "#ffffff",
});

async function saveChart(config: object, filename: string): Promise<string> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const buffer = await renderer.renderToBuffer(
    config as Parameters<typeof renderer.renderToBuffer>[0],
  );
  const outPath = path.join(OUTPUT_DIR, filename);
  await writeFile(outPath, buffer);
  return outPath;
}

// Chart 1: Posting frequency heatmap (day × hour bubble chart)
export async function generatePostingHeatmap(
  username: string,
  tweets: Tweet[],
): Promise<string> {
  const counts: Record<string, number> = {};
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  for (const tweet of tweets) {
    const d = new Date(tweet.createdAt);
    const key = `${d.getDay()}-${d.getUTCHours()}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }

  const bubbles = Object.entries(counts).map(([key, v]) => {
    const [day, hour] = key.split("-").map(Number);
    return { x: hour, y: day, r: Math.min(v * 4 + 4, 22) };
  });

  return saveChart(
    {
      type: "bubble",
      data: {
        datasets: [
          {
            label: `@${username} post frequency`,
            data: bubbles,
            backgroundColor: "rgba(29, 161, 242, 0.65)",
            borderColor: "rgba(29, 161, 242, 1)",
          },
        ],
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: `Posting Heatmap — @${username}`,
            font: { size: 16 },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Hour of Day (UTC)" },
            min: 0,
            max: 23,
          },
          y: {
            title: { display: true, text: "Day of Week" },
            min: 0,
            max: 6,
            ticks: { callback: (v: unknown) => days[v as number] },
          },
        },
      },
    },
    `heatmap_${safeHandle(username)}.png`,
  );
}

// Chart 2: Engagement over time (line chart)
export async function generateEngagementChart(
  username: string,
  tweets: Tweet[],
): Promise<string> {
  const sorted = [...tweets].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const labels = sorted.map((t) =>
    new Date(t.createdAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  );
  const likes = sorted.map((t) => t.likeCount);
  const retweets = sorted.map((t) => t.retweetCount);

  return saveChart(
    {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Likes",
            data: likes,
            borderColor: "#e0245e",
            backgroundColor: "rgba(224,36,94,0.1)",
            tension: 0.3,
            fill: true,
          },
          {
            label: "Retweets",
            data: retweets,
            borderColor: "#17bf63",
            backgroundColor: "rgba(23,191,99,0.1)",
            tension: 0.3,
            fill: true,
          },
        ],
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: `Engagement Over Time — @${username}`,
            font: { size: 16 },
          },
        },
        scales: { x: { ticks: { maxTicksLimit: 10 } } },
      },
    },
    `engagement_${safeHandle(username)}.png`,
  );
}

// Chart 3: Top hashtags bar chart
export async function generateHashtagChart(
  username: string,
  tweets: Tweet[],
): Promise<string> {
  const counts: Record<string, number> = {};
  for (const tweet of tweets) {
    for (const tag of tweet.hashtags) {
      const t = tag.toLowerCase();
      counts[t] = (counts[t] ?? 0) + 1;
    }
  }

  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  const labels = sorted.map(([tag]) => `#${tag}`);
  const data = sorted.map(([, count]) => count);

  return saveChart(
    {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Uses",
            data,
            backgroundColor: "rgba(29,161,242,0.75)",
            borderRadius: 4,
          },
        ],
      },
      options: {
        indexAxis: "y",
        plugins: {
          title: {
            display: true,
            text: `Top Hashtags — @${username}`,
            font: { size: 16 },
          },
          legend: { display: false },
        },
        scales: { x: { title: { display: true, text: "Count" } } },
      },
    },
    `hashtags_${safeHandle(username)}.png`,
  );
}

// Chart 4: Competitor comparison (grouped bar — avg likes & retweets)
export async function generateComparisonChart(
  competitors: CompetitorData[],
): Promise<string> {
  const labels = competitors.map((c) => `@${c.profile.username}`);

  const avgLikes = competitors.map((c) => {
    if (c.tweets.length === 0) return 0;
    return Math.round(
      c.tweets.reduce((s, t) => s + t.likeCount, 0) / c.tweets.length,
    );
  });
  const avgRetweets = competitors.map((c) => {
    if (c.tweets.length === 0) return 0;
    return Math.round(
      c.tweets.reduce((s, t) => s + t.retweetCount, 0) / c.tweets.length,
    );
  });
  const avgReplies = competitors.map((c) => {
    if (c.tweets.length === 0) return 0;
    return Math.round(
      c.tweets.reduce((s, t) => s + t.replyCount, 0) / c.tweets.length,
    );
  });

  return saveChart(
    {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Avg Likes",
            data: avgLikes,
            backgroundColor: "rgba(224,36,94,0.8)",
            borderRadius: 4,
          },
          {
            label: "Avg Retweets",
            data: avgRetweets,
            backgroundColor: "rgba(23,191,99,0.8)",
            borderRadius: 4,
          },
          {
            label: "Avg Replies",
            data: avgReplies,
            backgroundColor: "rgba(29,161,242,0.8)",
            borderRadius: 4,
          },
        ],
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: "Competitor Engagement Comparison",
            font: { size: 16 },
          },
        },
        scales: { y: { title: { display: true, text: "Average per Tweet" } } },
      },
    },
    "comparison.png",
  );
}

// Chart 5: Post type breakdown doughnut
export async function generatePostTypeChart(
  username: string,
  tweets: Tweet[],
): Promise<string> {
  let photos = 0,
    videos = 0,
    gifs = 0,
    textOnly = 0;
  for (const t of tweets) {
    if (!t.hasMedia) {
      textOnly++;
      continue;
    }
    if (t.mediaType === "photo") photos++;
    else if (t.mediaType === "video") videos++;
    else if (t.mediaType === "gif") gifs++;
    else textOnly++;
  }

  return saveChart(
    {
      type: "doughnut",
      data: {
        labels: ["Text only", "Photo", "Video", "GIF"],
        datasets: [
          {
            data: [textOnly, photos, videos, gifs],
            backgroundColor: [
              "rgba(29,161,242,0.8)",
              "rgba(224,36,94,0.8)",
              "rgba(23,191,99,0.8)",
              "rgba(255,173,31,0.8)",
            ],
          },
        ],
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: `Post Type Breakdown — @${username}`,
            font: { size: 16 },
          },
        },
      },
    },
    `posttypes_${safeHandle(username)}.png`,
  );
}

