import "dotenv/config";
import OpenAI from "openai";
import { Bot } from "grammy";
import cron from "node-cron";
import { runAgent } from "./agent.js";
import {
  addContextDoc,
  getContextDocsByLabel,
  getContextDocsByLabelFull,
  getContextDocsFull,
  getProjectConfig,
  openDb,
  setProjectConfig,
} from "./db.js";
import { createProgress, setProgress } from "./progress.js";
import { runAnalytics } from "./tools/analytics.js";
import type { PostCandidate } from "./types.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set in .env");

openDb();
const bot = new Bot(token);

let runningChatId: number | null = null;

function parseRunArgs(text: string): { target: string; competitors: string[] } | null {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const target = parts[1];
  if (!target.startsWith("@")) return null;
  const competitors = parts[2].split(",").map((c) => c.trim()).filter(Boolean);
  if (competitors.length === 0) return null;
  if (!competitors.every((c) => c.startsWith("@"))) return null;
  return { target, competitors };
}

bot.command("run", async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message?.text ?? "";

  if (runningChatId !== null) {
    await ctx.reply("A run is already in progress, please wait.");
    return;
  }

  const args = parseRunArgs(text);
  if (!args) {
    await ctx.reply(
      "Usage: /run @target @comp1,@comp2\n\nExample:\n/run @elonmusk @naval,@paulg"
    );
    return;
  }

  const { target, competitors } = args;
  runningChatId = chatId;

  await ctx.reply(
    `Starting agent for ${target} vs ${competitors.join(", ")}... this takes a few minutes.`
  );

  const progress = createProgress();
  setProgress(progress);

  const unsubscribe = progress.onEvent((e) => {
    if (e.kind === "stage-start") {
      bot.api.sendMessage(chatId, e.label).catch(() => {});
    }
  });

  try {
    const projectContext = getContextDocsByLabel(target);

    const result = await runAgent({
      target,
      competitors,
      count: 27,
      maxTweetsPerUser: 50,
      demo: false,
      provider: "twitterapi",
      projectContext: projectContext.length ? projectContext : undefined,
    });

    unsubscribe();

    const heroes = result.candidates.filter((c: PostCandidate) => c.tier === "hero");
    await bot.api.sendMessage(chatId, `Done! ${heroes.length} hero posts ready:`);

    for (let i = 0; i < heroes.length; i++) {
      const c = heroes[i];
      await bot.api.sendMessage(
        chatId,
        `Hero #${i + 1} | Score: ${c.scores.composite.toFixed(2)}\n\n${c.text}`
      );
    }
  } catch (err) {
    unsubscribe();
    const msg = err instanceof Error ? err.message : String(err);
    await bot.api.sendMessage(chatId, `Error: ${msg}`);
  } finally {
    setProgress(null);
    runningChatId = null;
  }
});

bot.command("analyze", async (ctx) => {
  const text = ctx.message?.text ?? "";
  const question = text.replace(/^\/analyze\s*/i, "").trim();

  if (!question) {
    await ctx.reply(
      "Usage: /analyze <your question>\n\nThis will analyze tweets for the project set via /setproject.\nTo use a different account, update your project first with /setproject @newhandle @comp1,@comp2.\n\nExamples:\n" +
        "• /analyze how did my last 2 tweets perform?\n" +
        "• /analyze what is my most liked tweet ever?\n" +
        "• /analyze what themes work best for me?"
    );
    return;
  }

  const config = getProjectConfig();
  if (!config) {
    await ctx.reply("No project configured yet.\n\nUse /setproject @target @comp1,@comp2 first.");
    return;
  }

  await ctx.reply("Analyzing...");

  try {
    const answer = await runAnalytics(config.targetHandle, config.competitorHandles, question, openai);
    await ctx.reply(answer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Error: ${msg}`);
  }
});

bot.command("addcontext", async (ctx) => {
  const text = ctx.message?.text ?? "";
  const match = text.match(/\/addcontext\s+@([\w]+)\s+"([^"]+)"/);
  if (!match) {
    await ctx.reply(
      'Usage: /addcontext @profilename "content text here"\n\nExample:\n/addcontext @aggtrade "AggTrade is a DeFi trading platform on Katana"'
    );
    return;
  }
  const label = match[1];
  const content = match[2].trim();
  addContextDoc(label, content);
  const preview = content.length > 80 ? content.slice(0, 80) + "…" : content;
  await ctx.reply(`Context saved for @${label}:\n"${preview}"`);
});

bot.command("setproject", async (ctx) => {
  const text = ctx.message?.text ?? "";
  const args = parseRunArgs(text.replace("/setproject", "/run"));
  if (!args) {
    await ctx.reply(
      "/setproject — Save your project config\n\nUsage: /setproject @target @comp1,@comp2\n\n• @target — your Twitter/X handle\n• @comp1,@comp2 — comma-separated competitor handles\n\nExample:\n/setproject @me @comp1,@comp2\n\nOnce saved, the bot will auto-send the 2 best filler post ideas every day at 8am.\nUse /run to generate posts immediately, or /analyze to ask questions about your tweets."
    );
    return;
  }
  try {
    setProjectConfig({
      targetHandle: args.target,
      competitorHandles: args.competitors,
      notifyChatId: ctx.chat.id,
    });
    await ctx.reply(
      `Project saved!\n\nTarget: ${args.target}\nCompetitors: ${args.competitors.join(", ")}\n\nI'll send you the 2 best tweets every day at 8am.\nUse /addcontext to give me more project knowledge.`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Failed to save project: ${msg}`);
  }
});

bot.command("myproject", async (ctx) => {
  const config = getProjectConfig();
  if (!config) {
    await ctx.reply("No project configured yet.\n\nUse /setproject @target @comp1,@comp2 to set one.");
    return;
  }
  await ctx.reply(
    `Current project:\n\nTarget: ${config.targetHandle}\nCompetitors: ${config.competitorHandles.join(", ")}\nNotifications: this chat\n\nUse /setproject to update.`
  );
});

bot.command("context", async (ctx) => {
  const text = ctx.message?.text ?? "";
  const arg = text.replace(/^\/context\s*/i, "").trim();

  if (!arg) {
    await ctx.reply(
      "Usage:\n• /context @profilename — show saved context for a profile\n• /context all — show all saved context across every profile"
    );
    return;
  }

  if (arg.toLowerCase() === "all") {
    const docs = getContextDocsFull();
    if (docs.length === 0) {
      await ctx.reply(
        'No context saved yet.\n\nUse /addcontext @profilename "text" to add some.'
      );
      return;
    }

    const grouped = new Map<string, typeof docs>();
    for (const doc of docs) {
      const key = doc.label.replace(/^@/, "").toLowerCase();
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(doc);
    }

    const labels = [...grouped.keys()];
    await ctx.reply(
      `All saved context — ${docs.length} ${docs.length === 1 ? "entry" : "entries"} across ${labels.length} ${labels.length === 1 ? "profile" : "profiles"}`
    );

    for (const [, entries] of grouped) {
      const label = entries[0].label.replace(/^@/, "");
      let msg = `@${label} — ${entries.length} ${entries.length === 1 ? "entry" : "entries"}\n\n`;
      for (let i = 0; i < entries.length; i++) {
        const date = new Date(entries[i].created_at).toLocaleDateString("en-US", {
          year: "numeric", month: "short", day: "numeric",
        });
        msg += `${i + 1}. ${entries[i].content}\n   Added: ${date}\n\n`;
      }
      if (msg.length > 4000) {
        await ctx.reply(`@${label} — ${entries.length} entries:`);
        for (let i = 0; i < entries.length; i++) {
          const date = new Date(entries[i].created_at).toLocaleDateString("en-US", {
            year: "numeric", month: "short", day: "numeric",
          });
          await ctx.reply(`${i + 1}. ${entries[i].content}\n   Added: ${date}`);
        }
      } else {
        await ctx.reply(msg.trim());
      }
    }

  } else {
    const label = arg.replace(/^@/, "");
    const docs = getContextDocsByLabelFull(label);

    if (docs.length === 0) {
      await ctx.reply(
        `No context found for @${label}.\n\nUse /addcontext @${label} "your text" to add some.`
      );
      return;
    }

    await ctx.reply(
      `Context for @${label} — ${docs.length} ${docs.length === 1 ? "entry" : "entries"}`
    );

    let chunk = "";
    for (let i = 0; i < docs.length; i++) {
      const date = new Date(docs[i].created_at).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric",
      });
      const line = `${i + 1}. ${docs[i].content}\n   Added: ${date}`;
      if (chunk.length + line.length + 2 > 4000) {
        await ctx.reply(chunk.trim());
        chunk = line;
      } else {
        chunk += (chunk ? "\n\n" : "") + line;
      }
    }
    if (chunk.trim()) await ctx.reply(chunk.trim());
  }
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text ?? "";
  if (text.startsWith("/")) return; // already handled by command handlers

  const config = getProjectConfig();
  if (!config) return; // silently ignore if no project is set

  await ctx.reply("Analyzing...");

  try {
    const answer = await runAnalytics(config.targetHandle, config.competitorHandles, text, openai);
    await ctx.reply(answer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Error: ${msg}`);
  }
});

async function runDailyRecommendation(): Promise<void> {
  const config = getProjectConfig();
  if (!config) return;

  const { targetHandle, competitorHandles, notifyChatId } = config;

  await bot.api.sendMessage(notifyChatId, `Good morning! Running daily tweet recommendations for ${targetHandle}...`);

  const progress = createProgress();
  setProgress(progress);

  try {
    const projectContext = getContextDocsByLabel(targetHandle);

    const result = await runAgent({
      target: targetHandle,
      competitors: competitorHandles,
      count: 27,
      maxTweetsPerUser: 50,
      demo: false,
      provider: "twitterapi",
      projectContext: projectContext.length ? projectContext : undefined,
    });

    const top2 = result.candidates.filter((c: PostCandidate) => c.tier === "hero").slice(0, 2);

    await bot.api.sendMessage(notifyChatId, `Here are your 2 best tweets for today:`);

    for (let i = 0; i < top2.length; i++) {
      const c = top2[i];
      const source = c.sourceEvidence[0]
        ? `\n— inspired by @${c.sourceEvidence[0].handle} (${c.sourceEvidence[0].metric})`
        : "";
      await bot.api.sendMessage(
        notifyChatId,
        `[${i + 1}] Score: ${c.scores.composite.toFixed(2)} | ${c.format}\n\n${c.text}${source}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await bot.api.sendMessage(notifyChatId, `Daily run failed: ${msg}`);
  } finally {
    setProgress(null);
  }
}

// 8am every day (server local time)
cron.schedule("0 8 * * *", () => {
  runDailyRecommendation().catch(console.error);
});

bot.start();
