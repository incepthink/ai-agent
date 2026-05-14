import "dotenv/config";
import { runAgent } from "./agent.js";
import { runOfflineAgent } from "./agent-offline.js";
import type { OnlineProvider } from "./types.js";
import { exec } from "child_process";
import { promisify } from "util";
import path from "node:path";
import fs from "node:fs";
import { createProgress, getProgress, setProgress } from "./progress.js";
import { startServer, type ServerHandle } from "./server.js";

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
  noProgress: boolean;
  contextFile: string | undefined;
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
                       [--count 27] [--days 14] [--max-tweets 50] [--demo] [--no-progress]
                       [--contextFile ./path/to/context.json]
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
  const noProgress = args.includes("--no-progress");

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
  const contextFile = readFlag(args, "--contextFile");

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
    provider, dataDir, maxSourceTweets, maxIdeas, force, csv, model, noProgress,
    contextFile,
  };
}

function loadProjectContext(file: string): string[] {
  const abs = path.resolve(file);
  let raw: string;
  try {
    raw = fs.readFileSync(abs, "utf-8");
  } catch (e) {
    console.error(
      `Error: could not read --contextFile "${abs}": ${e instanceof Error ? e.message : e}`,
    );
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(
      `Error: --contextFile is not valid JSON (${e instanceof Error ? e.message : e}).`,
    );
    process.exit(1);
  }
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
    console.error(`Error: --contextFile must be a JSON array of strings.`);
    process.exit(1);
  }
  return (parsed as string[]).map((s) => s.trim()).filter(Boolean);
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

async function openInBrowser(target: string) {
  const isUrl = /^https?:\/\//i.test(target);
  const arg = isUrl ? target : path.resolve(target);
  const platform = process.platform;
  try {
    if (platform === "win32") {
      await execAsync(`start "" "${arg}"`, { shell: "cmd.exe" });
    } else if (platform === "darwin") {
      await execAsync(`open "${arg}"`);
    } else {
      await execAsync(`xdg-open "${arg}"`);
    }
  } catch {
    console.log(`Could not auto-open browser. Open manually: ${arg}`);
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

  let server: ServerHandle | null = null;
  if (!opts.noProgress) {
    const progress = createProgress();
    setProgress(progress);
    try {
      server = await startServer(progress);
      console.log(`Progress UI: ${server.url}`);
      await openInBrowser(server.url);
      process.on("SIGINT", () => {
        console.log("\nShutting down progress server...");
        server?.close().finally(() => process.exit(0));
      });
    } catch (err) {
      console.warn(
        `Could not start progress server (${err instanceof Error ? err.message : err}). Falling back to terminal logs.`,
      );
      server = null;
      setProgress(null);
    }
  }

  const projectContext = opts.contextFile ? loadProjectContext(opts.contextFile) : undefined;
  if (projectContext) {
    console.log(`Context:     ${projectContext.length} project-context entries loaded`);
  }

  try {
    const result = await runAgent({
      target: opts.target,
      competitors: opts.competitors,
      count: opts.count,
      daysBack: opts.daysBack,
      maxTweetsPerUser: opts.maxTweetsPerUser,
      demo: opts.demo,
      provider: opts.provider,
      projectContext,
    });

    console.log(`\nDone. Artifacts:`);
    console.log(`  ${result.postsPath}`);
    console.log(`  ${result.insightsPath}`);
    console.log(`  ${result.voicePath}`);
    console.log(`  ${result.dashboardPath}`);

    if (server) {
      const dashboardUrl = `${server.url}/dashboard`;
      console.log(`\nDashboard: ${dashboardUrl}`);
      console.log("Server staying alive — press Ctrl+C to exit.");
      // Trigger client redirect to /dashboard.
      getProgress()?.done(dashboardUrl);
    } else {
      console.log("\nOpening dashboard...");
      await openInBrowser(result.dashboardPath);
    }
  } catch (err) {
    console.error("\nAgent failed:", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    const msg = err instanceof Error ? err.message : String(err);
    getProgress()?.error(msg);
    if (!server) process.exit(1);
    // With a server up, stay alive so the user can read the error in-browser.
    console.error("Server staying alive — press Ctrl+C to exit.");
  }
}

main();
