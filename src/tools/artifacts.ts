import fs from "node:fs";
import path from "node:path";
import type { Insights, PostCandidate, VoiceProfile } from "../types.js";

const OUTPUT_DIR = "./output";

function ensureOutputDir(): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

export function writeArtifacts(
  candidates: PostCandidate[],
  insights: Insights,
  voice: VoiceProfile
): { postsPath: string; insightsPath: string; voicePath: string } {
  ensureOutputDir();

  const postsPath = path.join(OUTPUT_DIR, "posts.json");
  const insightsPath = path.join(OUTPUT_DIR, "insights.json");
  const voicePath = path.join(OUTPUT_DIR, "voice-profile.json");

  fs.writeFileSync(postsPath, JSON.stringify(candidates, null, 2));
  fs.writeFileSync(insightsPath, JSON.stringify(insights, null, 2));
  fs.writeFileSync(voicePath, JSON.stringify(voice, null, 2));

  console.log(`[artifacts] Wrote ${candidates.length} candidates → ${postsPath}`);
  console.log(`[artifacts] Wrote insights → ${insightsPath}`);
  console.log(`[artifacts] Wrote voice profile → ${voicePath}`);

  return { postsPath, insightsPath, voicePath };
}
