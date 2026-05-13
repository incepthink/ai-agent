import "dotenv/config";
import { runAgent } from "./agent.js";
import { runOfflineAgent } from "./agent-offline.js";
import type { OnlineProvider } from "./types.js";
import { exec } from "child_process";
import { promisify } from "util";
import path from "node:path";

const execAsync = promisify(exec);

interface ParsedArgs {
  target: string;
  competitors: string[];
  count: number;
  daysBack: number;
  maxTweetsPerUser: number;
  demo: boolean;
  offline: boolean;
  provider: OnlineProvider | undefined;
  dataDir: string;
  maxSourceTweets: number;
  maxIdeas: number;
  force: boolean;
  csv: boolean;
  model: string;
}

function readFlag(args: string[], ...flags: string[]): string | undefined {
  for (const flag of flags) {
    const i = args.indexOf(flag);
    if (i !== -1 && i < args.length - 1) return args[i + 1];
  }
  return undefined;
}

function usageAndExit(): never {
  console.error(
    `Usage:
  Online:  npm start -- --target "@me" --competitors "@a,@b,@c" [--provider twitterapi|apify]
                       [--count 27] [--days 14] [--max-tweets 50] [--demo]
  Offline: npm start -- --target "@me" --competitors "@a,@b" --offline [--dataDir ./data/twitter]
                       [--maxTweetsPerUser 50] [--maxSourceTweets 40] [--maxIdeas 25]
                       [--model gpt-4o-mini] [--force] [--csv]`
  );
  process.exit(1);
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const demo = args.includes("--demo");
  const offline = args.includes("--offline");
  const force = args.includes("--force");
  const csv = args.includes("--csv");

  const target = readFlag(args, "--target");
  const rawCompetitors = readFlag(args, "--competitors");
  if (!target || !rawCompetitors) usageAndExit();

  const competitors = rawCompetitors
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  if (competitors.length === 0) {
    console.error("Error: --competitors must contain at least one handle.");
    process.exit(1);
  }

  const count = Number(readFlag(args, "--count") ?? 27);
  const daysBack = Number(readFlag(args, "--days") ?? 14);
  const maxTweetsPerUser = Number(readFlag(args, "--maxTweetsPerUser", "--max-tweets") ?? 50);
  const maxSourceTweets = Number(readFlag(args, "--maxSourceTweets") ?? 40);
  const maxIdeas = Number(readFlag(args, "--maxIdeas") ?? 25);
  const dataDir = readFlag(args, "--dataDir") ?? "./data/twitter";
  const model = readFlag(args, "--model") ?? "gpt-4o-mini";

  if (!offline && (!Number.isFinite(count) || count < 8)) {
    console.error("Error: --count must be a number ≥ 8 (7 hero + 1 backup minimum).");
    process.exit(1);
  }

  const rawProvider = readFlag(args, "--provider");
  let provider: OnlineProvider | undefined;
  if (rawProvider !== undefined) {
    if (rawProvider !== "apify" && rawProvider !== "twitterapi") {
      console.error(`Error: --provider must be "apify" or "twitterapi" (got "${rawProvider}").`);
      process.exit(1);
    }
    provider = rawProvider;
  } else if (!demo && !offline) {
    if (process.env.TWITTER_API_KEY) provider = "twitterapi";
    else if (process.env.APIFY_API_KEY) provider = "apify";
  }

  return {
    target, competitors, count, daysBack, maxTweetsPerUser, demo, offline,
    provider, dataDir, maxSourceTweets, maxIdeas, force, csv, model,
  };
}

function validateEnv(opts: ParsedArgs) {
  // Offline mode: never check online keys. OPENAI is deferred to point-of-use (cache may save us).
  if (opts.offline) return;

  const missing: string[] = [];
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");

  if (!opts.demo) {
    if (opts.provider === "twitterapi") {
      if (!process.env.TWITTER_API_KEY) missing.push("TWITTER_API_KEY");
    } else if (opts.provider === "apify") {
      if (!process.env.APIFY_API_KEY) missing.push("APIFY_API_KEY");
    } else {
      console.error(
        "\nNo online provider available. Set TWITTER_API_KEY or APIFY_API_KEY, " +
          "pass --provider twitterapi|apify, or use --demo / --offline."
      );
      process.exit(1);
    }
  }

  if (missing.length > 0) {
    console.error(`\nMissing required environment variables in .env:\n  ${missing.join("\n  ")}`);
    console.error(`\nFill these in .env and try again. (Use --demo for mock data, or --offline for local JSON.)`);
    process.exit(1);
  }
}

async function openInBrowser(filePath: string) {
  const absolute = path.resolve(filePath);
  const platform = process.platform;
  try {
    if (platform === "win32") {
      await execAsync(`start "" "${absolute}"`, { shell: "cmd.exe" });
    } else if (platform === "darwin") {
      await execAsync(`open "${absolute}"`);
    } else {
      await execAsync(`xdg-open "${absolute}"`);
    }
  } catch {
    console.log(`Could not auto-open browser. Open manually: ${absolute}`);
  }
}

async function main() {
  const opts = parseArgs();
  validateEnv(opts);

  console.log("Filler Post Intelligence Agent");
  console.log("==============================");
  console.log(`Target:      @${opts.target.replace(/^@/, "")}`);
  console.log(`Competitors: ${opts.competitors.join(", ")}`);

  if (opts.offline) {
    console.log(`Mode:        OFFLINE (local JSON from ${opts.dataDir})`);
    console.log(`Limits:      maxTweetsPerUser=${opts.maxTweetsPerUser} · maxSourceTweets=${opts.maxSourceTweets} · maxIdeas=${opts.maxIdeas}`);
    console.log(`Model:       ${opts.model}${opts.force ? " · --force (bypass cache)" : ""}`);
    console.log("");

    try {
      const result = await runOfflineAgent({
        target: opts.target,
        competitors: opts.competitors,
        dataDir: opts.dataDir,
        maxTweetsPerUser: opts.maxTweetsPerUser,
        maxSourceTweets: opts.maxSourceTweets,
        maxIdeas: opts.maxIdeas,
        model: opts.model,
        force: opts.force,
        csv: opts.csv,
      });

      console.log(`\nDone${result.cacheHit ? " (cache hit)" : ""}. Artifacts:`);
      console.log(`  ${result.fillerPostsPath}`);
      console.log(`  ${result.dataWarningsPath}`);
      if (result.csvPath) console.log(`  ${result.csvPath}`);
      console.log(`  ${result.dashboardPath}`);
      console.log("\nOpening dashboard...");
      await openInBrowser(result.dashboardPath);
    } catch (err) {
      console.error("\nOffline agent failed:", err instanceof Error ? err.message : err);
      if (err instanceof Error && err.stack) console.error(err.stack);
      process.exit(1);
    }
    return;
  }

  console.log(`Count:       ${opts.count} candidates (7 hero + ${opts.count - 7} backup)`);
  console.log(`Days back:   ${opts.daysBack}`);
  if (opts.demo) console.log(`Mode:        DEMO (mock data, no online API)`);
  else console.log(`Mode:        ONLINE (provider=${opts.provider})`);
  console.log("");

  try {
    const result = await runAgent({
      target: opts.target,
      competitors: opts.competitors,
      count: opts.count,
      daysBack: opts.daysBack,
      maxTweetsPerUser: opts.maxTweetsPerUser,
      demo: opts.demo,
      provider: opts.provider,
    });

    console.log(`\nDone. Artifacts:`);
    console.log(`  ${result.postsPath}`);
    console.log(`  ${result.insightsPath}`);
    console.log(`  ${result.voicePath}`);
    console.log(`  ${result.dashboardPath}`);
    console.log("\nOpening dashboard...");
    await openInBrowser(result.dashboardPath);
  } catch (err) {
    console.error("\nAgent failed:", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

main();
