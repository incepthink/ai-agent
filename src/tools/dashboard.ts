import fs from "node:fs";
import path from "node:path";
import type { Insights, PostCandidate, VoiceProfile } from "../types.js";
import { getProgress } from "../progress.js";

const OUTPUT_DIR = "./output";

export interface ChartAsset {
  handle: string;
  kind: string;
  path: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pct(n: number): string {
  return Math.round(n * 100).toString();
}

function scoreClass(value: number, invert = false): string {
  const v = invert ? 1 - value : value;
  if (v >= 0.75) return "score-good";
  if (v >= 0.5) return "score-ok";
  return "score-bad";
}

export function renderDashboard(
  candidates: PostCandidate[],
  insights: Insights,
  voice: VoiceProfile,
  charts: ChartAsset[] = []
): string {
  const outPath = path.join(OUTPUT_DIR, "dashboard.html");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const allThemes = [...new Set(candidates.map((c) => c.theme))].sort();
  const allFormats = [...new Set(candidates.map((c) => c.format))].sort();

  const heroCount = candidates.filter((c) => c.tier === "hero").length;
  const backupCount = candidates.filter((c) => c.tier === "backup").length;

  const dataJson = JSON.stringify({ candidates, insights, voice });

  const byHandle = new Map<string, ChartAsset[]>();
  for (const c of charts) {
    if (c.handle === "_all") continue;
    if (!byHandle.has(c.handle)) byHandle.set(c.handle, []);
    byHandle.get(c.handle)!.push(c);
  }
  const comparison = charts.find((c) => c.handle === "_all");

  const chartLabel = (kind: string): string => {
    switch (kind) {
      case "heatmap": return "When they post";
      case "engagement": return "Engagement over time";
      case "hashtags": return "Most-used hashtags";
      case "posttypes": return "Post type breakdown";
      default: return kind;
    }
  };
  const chartCaption = (kind: string): string => {
    switch (kind) {
      case "heatmap": return "Day-of-week × hour-of-day posting frequency.";
      case "engagement": return "Per-tweet engagement trend over the analyzed window.";
      case "hashtags": return "Top hashtags and their share of total posts.";
      case "posttypes": return "Mix of originals, replies, retweets, and quotes.";
      default: return "";
    }
  };

  const analyticsHtml = charts.length === 0
    ? `<div class="empty">No charts were generated for this run.</div>`
    : `
      ${comparison
        ? `<div class="chart-group">
            <div class="chart-group-header">
              <h2>Head-to-head comparison</h2>
              <div class="caption">Stacked metrics across the target and competitors.</div>
            </div>
            <div class="chart-section">
              <img src="${escapeHtml(path.basename(comparison.path))}" alt="comparison"/>
            </div>
          </div>`
        : ""}
      ${[...byHandle.entries()].map(([handle, items]) => `
        <div class="chart-group">
          <div class="chart-group-header">
            <h2>@${escapeHtml(handle)} <span class="caption-inline">— behavior analytics</span></h2>
            <div class="caption">How they post, what works, and when.</div>
          </div>
          ${items.map((c) => `
            <div class="chart-section">
              <h3>${escapeHtml(chartLabel(c.kind))}</h3>
              ${chartCaption(c.kind) ? `<div class="chart-caption">${escapeHtml(chartCaption(c.kind))}</div>` : ""}
              <img src="${escapeHtml(path.basename(c.path))}" alt="${escapeHtml(c.kind)} for ${escapeHtml(handle)}"/>
            </div>
          `).join("")}
        </div>
      `).join("")}
    `;

  const topHooksHtml = insights.topHooks.length === 0
    ? `<div class="intel-empty">No hooks mined.</div>`
    : `<ul>${insights.topHooks.slice(0, 5).map((h) => `
        <li class="intel-row">
          <span class="badge">${h.frequency}×</span>
          <div style="min-width:0;">
            <div class="signature">${escapeHtml(h.signature)}</div>
            <div class="desc">${escapeHtml(h.description)}</div>
          </div>
        </li>`).join("")}</ul>`;

  const hotTopicsHtml = insights.hotTopics.length === 0
    ? `<div class="intel-empty">No hot topics yet.</div>`
    : `<ul>${insights.hotTopics.slice(0, 5).map((t) => `
        <li class="intel-row">
          <span class="badge">${t.mentions}×</span>
          <div class="signature" style="flex:1;">${escapeHtml(t.topic)}</div>
          <span class="meta">↑ ${t.avgEngagement.toLocaleString()}</span>
        </li>`).join("")}</ul>`;

  const topFormatsHtml = (insights.topFormats ?? []).length === 0
    ? `<div class="intel-empty">No format patterns yet.</div>`
    : `<ul>${insights.topFormats.slice(0, 5).map((f) => `
        <li class="intel-row">
          <span class="badge">${f.frequency}×</span>
          <div style="min-width:0;flex:1;">
            <div class="signature">${escapeHtml(f.signature)}</div>
            <div class="desc">${escapeHtml(f.description)}</div>
          </div>
          <span class="meta">↑ ${f.avgEngagement.toLocaleString()}</span>
        </li>`).join("")}</ul>`;

  const cadenceHtml = (insights.postingCadence ?? []).length === 0
    ? `<div class="intel-empty">No cadence data.</div>`
    : `<ul>${insights.postingCadence.slice(0, 6).map((p) => {
        const hh = String(p.medianHourUTC).padStart(2, "0");
        return `<li class="intel-row">
          <span class="signature" style="flex:1;">@${escapeHtml(p.handle)}</span>
          <span class="desc">${p.postsPerWeek.toFixed(1)}/wk</span>
          <span class="meta">peak ${hh}:00 UTC</span>
        </li>`;
      }).join("")}</ul>`;

  const punctData: { name: string; val: number }[] = [
    { name: "Ellipsis (…)", val: voice.punctuationFingerprint.ellipsis },
    { name: "Em dash (—)", val: voice.punctuationFingerprint.emDash },
    { name: "Question (?)", val: voice.punctuationFingerprint.questionMark },
    { name: "Exclaim (!)", val: voice.punctuationFingerprint.exclamation },
  ];
  const punctMax = Math.max(...punctData.map((p) => p.val), 0.0001);
  const punctRowsHtml = punctData.map((p) => `
    <div class="punct-row">
      <div class="head">
        <span class="name">${p.name}</span>
        <span class="val">${p.val.toFixed(2)}</span>
      </div>
      <div class="bar"><div class="fill" style="width:${Math.round((p.val / punctMax) * 100)}%"></div></div>
    </div>`).join("");

  const nounsHtml = voice.vocabulary.topNouns.length === 0
    ? `<div class="intel-empty">No nouns extracted.</div>`
    : voice.vocabulary.topNouns.map((n) => `<span class="chip">${escapeHtml(n)}</span>`).join("");
  const verbsHtml = voice.vocabulary.topVerbs.length === 0
    ? `<div class="intel-empty">No verbs extracted.</div>`
    : voice.vocabulary.topVerbs.map((v) => `<span class="chip">${escapeHtml(v)}</span>`).join("");

  const hookPatternsHtml = voice.hookPatterns.length === 0
    ? `<div class="intel-empty">No recurring hooks detected.</div>`
    : voice.hookPatterns.map((h) => `<div class="quote">${escapeHtml(h)}</div>`).join("");

  const tabooHtml = voice.taboo.length === 0
    ? ""
    : `<div class="section-header">Taboo</div>
       <div class="chips">${voice.taboo.map((t) => `<span class="chip taboo">⊘ ${escapeHtml(t)}</span>`).join("")}</div>`;

  const examplesHtml = voice.exampleTweets.length === 0
    ? ""
    : `<div class="section-header">Example tweets</div>
       <div class="example-grid">
         ${voice.exampleTweets.slice(0, 6).map((t) => `
           <div class="example-card">
             <div class="head">@${escapeHtml(voice.handle)}</div>
             <div class="body">${escapeHtml(t.text)}</div>
           </div>`).join("")}
       </div>`;

  const competitorsHtml = insights.competitors
    .map((c) => `<span class="handle-chip">@${escapeHtml(c)}</span>`)
    .join("");

  const generatedAt = new Date(insights.generatedAt).toLocaleString();

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Filler Post Studio — @${escapeHtml(insights.target)}</title>
<style>
  :root {
    --bg: #0a0a0a;
    --surface: #111114;
    --surface-2: #17171c;
    --surface-3: #1d1d24;
    --border: #1f1f26;
    --border-2: #2a2a33;
    --text: #f5f5f7;
    --text-2: #a1a1aa;
    --text-3: #71717a;
    --accent: #3b82f6;
    --accent-2: #60a5fa;
    --accent-dim: rgba(59, 130, 246, 0.14);
    --good: #10b981;
    --ok: #f59e0b;
    --bad: #ef4444;
    --hero: #8b5cf6;
    --hero-dim: rgba(139, 92, 246, 0.12);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  .app-header {
    position: sticky;
    top: 0;
    z-index: 10;
    background: rgba(10, 10, 10, 0.82);
    backdrop-filter: saturate(180%) blur(14px);
    -webkit-backdrop-filter: saturate(180%) blur(14px);
    border-bottom: 1px solid var(--border);
  }
  .app-header::after {
    content: "";
    position: absolute;
    left: 0; right: 0; bottom: -1px;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--accent) 50%, transparent);
    opacity: 0.45;
    pointer-events: none;
  }
  .header-inner {
    max-width: 1120px;
    margin: 0 auto;
    padding: 18px 28px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 20px;
  }
  .header-left { min-width: 0; }
  .title-row { display: flex; align-items: center; gap: 10px; }
  .title-row h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .beta-tag {
    font: 700 9.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.12em;
    color: var(--accent-2);
    background: var(--accent-dim);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 3px 6px;
    text-transform: uppercase;
  }
  .header-meta {
    margin-top: 8px;
    font-size: 12.5px;
    color: var(--text-3);
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .handle-chip {
    display: inline-flex;
    align-items: center;
    font: 500 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 4px 8px;
    border-radius: 6px;
  }
  .handle-chip.target {
    background: var(--accent-dim);
    border-color: var(--accent);
    color: var(--accent-2);
    font-weight: 600;
  }
  .arrow-sep { color: var(--text-3); margin: 0 4px; }
  .dot-sep { color: var(--text-3); margin: 0 6px; }

  .header-stats { display: flex; gap: 8px; }
  .stat-tile {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 14px;
    text-align: left;
    min-width: 86px;
  }
  .stat-tile .num {
    font-size: 18px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .stat-tile .label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-3);
    margin-top: 4px;
  }
  .stat-tile.hero .num { color: var(--hero); }
  .stat-tile.backup .num { color: var(--text-2); }

  .container {
    max-width: 1120px;
    margin: 0 auto;
    padding: 28px 28px 96px;
  }

  .tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border);
    margin-bottom: 28px;
  }
  .tab {
    background: transparent;
    color: var(--text-3);
    border: none;
    border-bottom: 2px solid transparent;
    padding: 12px 18px;
    margin-bottom: -1px;
    font: 500 13px/1 inherit;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .tab:hover { color: var(--text); }
  .tab.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .tab .count {
    font: 500 11px/1 ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    background: var(--surface-2);
    color: var(--text-3);
    padding: 3px 6px;
    border-radius: 4px;
    border: 1px solid var(--border);
  }
  .tab.active .count {
    color: var(--text-2);
    background: var(--surface-3);
    border-color: var(--border-2);
  }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }

  .intel-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin-bottom: 28px;
  }
  @media (max-width: 760px) { .intel-grid { grid-template-columns: 1fr; } }
  .intel-panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px 18px;
  }
  .intel-panel h3 {
    margin: 0 0 12px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .intel-panel ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .intel-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }
  .intel-row .badge {
    font: 600 11px/1 ui-monospace, monospace;
    background: var(--accent-dim);
    color: var(--accent-2);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 4px 6px;
    font-variant-numeric: tabular-nums;
    min-width: 30px;
    text-align: center;
    flex-shrink: 0;
  }
  .intel-row .signature {
    font: 500 12.5px/1.3 inherit;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .intel-row .desc {
    color: var(--text-2);
    font-size: 12px;
    margin-top: 2px;
  }
  .intel-row .meta {
    color: var(--text-3);
    font: 500 11.5px/1 ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .intel-empty {
    color: var(--text-3);
    font-size: 12.5px;
    font-style: italic;
  }

  .toolbar {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    align-items: flex-end;
    margin-bottom: 24px;
    padding: 14px 16px;
    background: var(--surface);
    border-radius: 12px;
    border: 1px solid var(--border);
  }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field > label {
    color: var(--text-3);
    font: 600 10px/1 inherit;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .field select {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 30px 8px 12px;
    font: 500 13px/1 inherit;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M3 4.5l3 3 3-3' stroke='%23a1a1aa' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>");
    background-repeat: no-repeat;
    background-position: right 10px center;
    background-size: 12px;
    min-width: 140px;
    transition: border-color 0.15s;
  }
  .field select:hover { border-color: var(--border-2); }
  .field select:focus { outline: none; border-color: var(--accent); }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    color: var(--text-2);
    font-size: 12.5px;
    user-select: none;
    padding-bottom: 8px;
  }
  .toggle input { position: absolute; opacity: 0; pointer-events: none; }
  .toggle .switch {
    position: relative;
    width: 32px;
    height: 18px;
    background: var(--surface-3);
    border: 1px solid var(--border-2);
    border-radius: 999px;
    transition: background 0.15s, border-color 0.15s;
    flex-shrink: 0;
  }
  .toggle .switch::after {
    content: "";
    position: absolute;
    top: 1px;
    left: 1px;
    width: 14px;
    height: 14px;
    background: var(--text-2);
    border-radius: 50%;
    transition: transform 0.15s, background 0.15s;
  }
  .toggle input:checked + .switch {
    background: var(--accent-dim);
    border-color: var(--accent);
  }
  .toggle input:checked + .switch::after {
    transform: translateX(14px);
    background: var(--accent);
  }

  .count-chip {
    margin-left: auto;
    color: var(--text-3);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
    padding-bottom: 8px;
  }
  .count-chip strong {
    color: var(--text);
    font-weight: 600;
  }

  .tier-header {
    margin: 32px 0 14px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.15em;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .tier-header .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-3);
    flex-shrink: 0;
  }
  .tier-header.hero .dot { background: var(--hero); box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.18); }
  .tier-header .line {
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  .tier-header:first-child { margin-top: 8px; }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 12px;
    transition: border-color 0.15s, transform 0.15s;
  }
  .card:hover {
    border-color: var(--border-2);
    transform: translateY(-1px);
  }
  .card.hero {
    border-left: 3px solid var(--hero);
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .rank {
    color: var(--text-3);
    font: 600 11px/1 ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    margin-right: 4px;
    letter-spacing: 0.04em;
  }
  .pill {
    font: 500 11px/1 inherit;
    padding: 4px 8px;
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    text-transform: lowercase;
    letter-spacing: 0.01em;
  }
  .pill.format {
    color: var(--accent-2);
    border-color: var(--accent);
    background: var(--accent-dim);
  }
  .tier-badge {
    margin-left: auto;
    font: 600 10px/1 ui-monospace, monospace;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid var(--border);
    color: var(--text-3);
  }
  .tier-badge.hero {
    color: var(--hero);
    border-color: var(--hero);
    background: var(--hero-dim);
  }

  .post-text {
    font-size: 15.5px;
    line-height: 1.55;
    margin: 4px 0 14px;
    white-space: pre-wrap;
    word-wrap: break-word;
    color: var(--text);
  }
  .image-brief {
    font-size: 12.5px;
    color: var(--text-2);
    border-left: 2px solid var(--accent);
    padding: 2px 0 2px 12px;
    margin: 0 0 14px;
    font-style: italic;
  }

  .scores {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 14px;
  }
  .score {
    font: 500 11px/1 inherit;
    padding: 5px 9px 5px 8px;
    border-radius: 6px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .score .lbl {
    color: var(--text-3);
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .score .val {
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }
  .score-good { border-color: var(--good); }
  .score-good .val { color: var(--good); }
  .score-ok { border-color: var(--ok); }
  .score-ok .val { color: var(--ok); }
  .score-bad { border-color: var(--bad); }
  .score-bad .val { color: var(--bad); }

  .reasoning {
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-2);
    background: var(--surface-2);
    border-left: 2px solid var(--border-2);
    border-radius: 0 8px 8px 0;
    padding: 10px 14px;
    margin: 0 0 14px;
  }
  .reasoning .lead {
    display: block;
    color: var(--text-3);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 9.5px;
    margin-bottom: 4px;
  }

  .card-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
  button.primary {
    background: var(--accent);
    color: white;
    border: 1px solid var(--accent);
    padding: 7px 14px;
    border-radius: 8px;
    font: 500 12.5px/1 inherit;
    cursor: pointer;
    transition: background 0.15s;
  }
  button.primary:hover { background: var(--accent-2); border-color: var(--accent-2); }
  .ghost {
    background: transparent;
    color: var(--text-2);
    border: 1px solid var(--border);
    padding: 7px 14px;
    border-radius: 8px;
    font: 500 12.5px/1 inherit;
    cursor: pointer;
    text-decoration: none;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
    display: inline-flex;
    align-items: center;
  }
  .ghost:hover {
    color: var(--text);
    border-color: var(--border-2);
    background: var(--surface-2);
  }

  details.evidence {
    margin-top: 14px;
    font-size: 12.5px;
    color: var(--text-2);
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
  details.evidence summary {
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--text-3);
    font: 500 12px/1 inherit;
    list-style: none;
    user-select: none;
    border: 1px solid var(--border);
  }
  details.evidence summary:hover { color: var(--text); border-color: var(--border-2); }
  details.evidence summary::-webkit-details-marker { display: none; }
  details.evidence summary::before {
    content: "▸";
    font-size: 9px;
    transition: transform 0.15s;
    display: inline-block;
  }
  details[open].evidence summary::before { transform: rotate(90deg); }
  details.evidence ul {
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  details.evidence li {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 10px 12px;
    background: var(--surface-2);
    border-radius: 8px;
    border: 1px solid var(--border);
  }
  details.evidence a {
    color: var(--accent-2);
    text-decoration: none;
    font: 600 12px/1 ui-monospace, monospace;
    flex-shrink: 0;
  }
  details.evidence a:hover { text-decoration: underline; }
  .evidence-excerpt {
    color: var(--text-2);
    font-style: italic;
    flex: 1;
    line-height: 1.4;
  }
  .evidence-metric {
    font: 500 10.5px/1 ui-monospace, monospace;
    color: var(--text-3);
    background: var(--surface-3);
    padding: 4px 7px;
    border-radius: 4px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .empty {
    padding: 56px 24px;
    text-align: center;
    color: var(--text-3);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
  }

  .toast {
    position: fixed;
    bottom: 28px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--good);
    color: white;
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  }
  .toast.show { opacity: 1; }

  .chart-group { margin-bottom: 36px; }
  .chart-group-header { margin-bottom: 14px; }
  .chart-group-header h2 {
    font-size: 17px;
    font-weight: 600;
    margin: 0;
    letter-spacing: -0.01em;
  }
  .chart-group-header .caption-inline {
    color: var(--text-3);
    font-weight: 400;
  }
  .chart-group-header .caption {
    margin-top: 4px;
    font-size: 12.5px;
    color: var(--text-3);
  }
  .chart-section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 12px;
  }
  .chart-section h3 {
    margin: 0 0 4px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-2);
  }
  .chart-section .chart-caption {
    font-size: 11.5px;
    color: var(--text-3);
    margin-bottom: 12px;
  }
  .chart-section img {
    display: block;
    width: 100%;
    max-width: 100%;
    height: auto;
    border-radius: 8px;
    background: #fff;
  }

  .voice-hero {
    background:
      linear-gradient(135deg, rgba(139, 92, 246, 0.14), rgba(59, 130, 246, 0.06) 60%, transparent 100%),
      var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 26px 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    flex-wrap: wrap;
    margin-bottom: 24px;
  }
  .voice-hero .lead {
    font-size: 10.5px;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-weight: 700;
    margin-bottom: 8px;
  }
  .voice-hero .num {
    font-size: 38px;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .voice-hero .num-label {
    color: var(--text-2);
    font-size: 14px;
    margin-left: 10px;
    font-weight: 500;
  }
  .voice-hero .right { text-align: right; }
  .voice-hero .handle {
    font: 700 17px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--text);
  }
  .voice-hero .handle-meta {
    font-size: 12.5px;
    color: var(--text-3);
    margin-top: 6px;
  }

  .section-header {
    margin: 28px 0 12px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.15em;
  }
  .section-header:first-child { margin-top: 4px; }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    margin-bottom: 4px;
  }
  @media (max-width: 760px) { .stat-grid { grid-template-columns: repeat(2, 1fr); } }
  .stat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px 18px;
  }
  .stat-card .stat-num {
    font-size: 26px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  .stat-card .stat-num small {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-3);
    margin-left: 2px;
  }
  .stat-card .stat-label {
    font-size: 11px;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-top: 6px;
    font-weight: 600;
  }

  .punct-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  @media (max-width: 600px) { .punct-grid { grid-template-columns: 1fr; } }
  .punct-row {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
  }
  .punct-row .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 8px;
  }
  .punct-row .name {
    font-size: 12.5px;
    color: var(--text-2);
  }
  .punct-row .val {
    font: 600 12.5px/1 ui-monospace, monospace;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .punct-row .bar {
    height: 4px;
    background: var(--surface-2);
    border-radius: 2px;
    overflow: hidden;
  }
  .punct-row .fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    border-radius: 2px;
  }

  .vocab-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  @media (max-width: 600px) { .vocab-grid { grid-template-columns: 1fr; } }
  .vocab-panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px 18px;
  }
  .vocab-panel h4 {
    margin: 0 0 12px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    display: inline-flex;
    align-items: center;
    font: 500 12px/1 inherit;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 5px 10px;
    border-radius: 999px;
  }
  .chip.taboo {
    color: var(--bad);
    border-color: rgba(239, 68, 68, 0.5);
    background: rgba(239, 68, 68, 0.08);
    text-decoration: line-through;
  }

  .quote-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .quote {
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 2px solid var(--accent);
    border-radius: 0 8px 8px 0;
    padding: 12px 16px;
    font: italic 14px/1.5 inherit;
    color: var(--text-2);
  }

  .style-notes {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 18px 22px;
    font-size: 14px;
    line-height: 1.7;
    color: var(--text-2);
    max-width: 78ch;
    white-space: pre-wrap;
  }

  .example-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  @media (max-width: 760px) { .example-grid { grid-template-columns: 1fr; } }
  .example-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
  }
  .example-card .head {
    font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--text-3);
    margin-bottom: 8px;
  }
  .example-card .body {
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--text);
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  @media (max-width: 600px) {
    .header-inner { padding: 14px 18px; }
    .container { padding: 20px 18px 64px; }
    .header-stats { width: 100%; }
    .stat-tile { flex: 1; }
  }
</style>
</head>
<body>
<header class="app-header">
  <div class="header-inner">
    <div class="header-left">
      <div class="title-row">
        <h1>Filler Post Studio</h1>
        <span class="beta-tag">Beta</span>
      </div>
      <div class="header-meta">
        <span class="handle-chip target">@${escapeHtml(insights.target)}</span>
        <span class="arrow-sep">→</span>
        ${competitorsHtml}
        <span class="dot-sep">·</span>
        <span class="timestamp">Generated ${escapeHtml(generatedAt)}</span>
      </div>
    </div>
    <div class="header-stats">
      <div class="stat-tile">
        <div class="num">${candidates.length}</div>
        <div class="label">Candidates</div>
      </div>
      <div class="stat-tile hero">
        <div class="num">${heroCount}</div>
        <div class="label">Hero</div>
      </div>
      <div class="stat-tile backup">
        <div class="num">${backupCount}</div>
        <div class="label">Backup</div>
      </div>
    </div>
  </div>
</header>

<div class="container">

  <nav class="tabs" role="tablist">
    <button class="tab active" data-tab="posts" role="tab">Posts <span class="count">${candidates.length}</span></button>
    <button class="tab" data-tab="analytics" role="tab">Analytics <span class="count">${charts.length}</span></button>
    <button class="tab" data-tab="voice" role="tab">Voice <span class="count">${voice.sampleSize}</span></button>
  </nav>

  <div id="tab-posts" class="tab-panel active">

    <div class="intel-grid">
      <div class="intel-panel">
        <h3>Top Hooks Mined</h3>
        ${topHooksHtml}
      </div>
      <div class="intel-panel">
        <h3>Hot Topics</h3>
        ${hotTopicsHtml}
      </div>
      <div class="intel-panel">
        <h3>Top Formats</h3>
        ${topFormatsHtml}
      </div>
      <div class="intel-panel">
        <h3>Posting Cadence</h3>
        ${cadenceHtml}
      </div>
    </div>

    <div class="toolbar">
      <div class="field">
        <label for="filter-format">Format</label>
        <select id="filter-format">
          <option value="">all</option>
          ${allFormats.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="filter-theme">Theme</label>
        <select id="filter-theme">
          <option value="">all</option>
          ${allThemes.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="sort">Sort by</label>
        <select id="sort">
          <option value="composite">composite</option>
          <option value="quality">quality</option>
          <option value="brandFit">brand fit</option>
          <option value="expectedEngagement">expected engagement</option>
        </select>
      </div>
      <label class="toggle">
        <input type="checkbox" id="hide-backup">
        <span class="switch"></span>
        <span>Hide backup tier</span>
      </label>
      <div class="count-chip" id="count-chip"><strong>${candidates.length}</strong> shown</div>
    </div>

    <div id="cards"></div>

  </div>

  <div id="tab-analytics" class="tab-panel">
    ${analyticsHtml}
  </div>

  <div id="tab-voice" class="tab-panel">
    <div class="voice-hero">
      <div>
        <div class="lead">Voice Fingerprint</div>
        <div><span class="num">${voice.sampleSize}</span><span class="num-label">tweets analyzed</span></div>
      </div>
      <div class="right">
        <div class="handle">@${escapeHtml(voice.handle)}</div>
        <div class="handle-meta">${voice.exampleTweets.length} example tweets · ${voice.hookPatterns.length} hook patterns</div>
      </div>
    </div>

    <div class="section-header">Style fingerprint</div>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-num">${voice.avgTweetLength}<small>chars</small></div>
        <div class="stat-label">Avg tweet length</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${voice.sentenceLengthP50}<small>chars</small></div>
        <div class="stat-label">Median sentence</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${Math.round(voice.emojiRate * 100)}<small>%</small></div>
        <div class="stat-label">Emoji rate</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${Math.round(voice.hashtagRate * 100)}<small>%</small></div>
        <div class="stat-label">Hashtag rate</div>
      </div>
    </div>

    <div class="section-header">Punctuation fingerprint</div>
    <div class="punct-grid">
      ${punctRowsHtml}
    </div>

    <div class="section-header">Vocabulary</div>
    <div class="vocab-grid">
      <div class="vocab-panel">
        <h4>Top Nouns</h4>
        <div class="chips">${nounsHtml}</div>
      </div>
      <div class="vocab-panel">
        <h4>Top Verbs</h4>
        <div class="chips">${verbsHtml}</div>
      </div>
    </div>

    <div class="section-header">Hook patterns</div>
    <div class="quote-list">${hookPatternsHtml}</div>

    ${tabooHtml}

    <div class="section-header">Style notes</div>
    <div class="style-notes">${escapeHtml(voice.styleNotes)}</div>

    ${examplesHtml}
  </div>

</div>

<div class="toast" id="toast">Copied to clipboard</div>

<script>
const DATA = ${dataJson};
const TOTAL = DATA.candidates.length;

function el(tag, attrs, children) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  if (children) for (const c of children) if (c) e.append(c);
  return e;
}

function pct(n) { return Math.round(n * 100); }

function scoreCls(v, invert) {
  const x = invert ? 1 - v : v;
  if (x >= 0.75) return 'score score-good';
  if (x >= 0.5) return 'score score-ok';
  return 'score score-bad';
}

function scoreEl(label, value, invert) {
  const span = el('span', { class: scoreCls(value, invert) });
  span.append(
    el('span', { class: 'lbl' }, [document.createTextNode(label)]),
    el('span', { class: 'val' }, [document.createTextNode(pct(value).toString())])
  );
  return span;
}

function buildCard(c) {
  const card = el('div', { class: 'card ' + c.tier });

  const head = el('div', { class: 'card-head' });
  head.append(
    el('span', { class: 'rank' }, [document.createTextNode('#' + c.rank)]),
    el('span', { class: 'pill format' }, [document.createTextNode(c.format)]),
    el('span', { class: 'pill' }, [document.createTextNode(c.theme)]),
    el('span', { class: 'tier-badge ' + c.tier }, [document.createTextNode(c.tier)])
  );
  card.append(head);

  card.append(el('div', { class: 'post-text' }, [document.createTextNode(c.text)]));

  if (c.imageBrief) {
    card.append(el('div', { class: 'image-brief' }, [document.createTextNode('Image idea: ' + c.imageBrief)]));
  }

  const scores = el('div', { class: 'scores' });
  scores.append(
    scoreEl('Composite', c.scores.composite),
    scoreEl('Quality', c.scores.quality),
    scoreEl('Fit', c.scores.brandFit),
    scoreEl('Risk', c.scores.plagiarismRisk, true),
    scoreEl('Effort', c.scores.effort, true),
    scoreEl('Eng', c.scores.expectedEngagement)
  );
  card.append(scores);

  if (c.reasoning) {
    const r = el('div', { class: 'reasoning' });
    r.append(el('span', { class: 'lead' }, [document.createTextNode('Why it lands')]));
    r.append(document.createTextNode(c.reasoning));
    card.append(r);
  }

  const actions = el('div', { class: 'card-actions' });
  const copyBtn = el('button', { class: 'primary' }, [document.createTextNode('Copy')]);
  copyBtn.onclick = () => { navigator.clipboard.writeText(c.text).then(showToast); };
  actions.append(copyBtn);

  const tweetUrl = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(c.text);
  const postBtn = el('a', { class: 'ghost', href: tweetUrl, target: '_blank', rel: 'noopener' }, [document.createTextNode('Open in X ↗')]);
  actions.append(postBtn);
  card.append(actions);

  if (c.sourceEvidence && c.sourceEvidence.length > 0) {
    const details = el('details', { class: 'evidence' });
    const n = c.sourceEvidence.length;
    details.append(el('summary', {}, [document.createTextNode(n + ' evidence source' + (n === 1 ? '' : 's'))]));
    const ul = el('ul');
    for (const ev of c.sourceEvidence) {
      const li = el('li');
      const link = el('a', { href: ev.url, target: '_blank', rel: 'noopener' }, [document.createTextNode('@' + ev.handle)]);
      li.append(link);
      li.append(el('span', { class: 'evidence-excerpt' }, [document.createTextNode('"' + ev.excerpt + '..."')]));
      li.append(el('span', { class: 'evidence-metric' }, [document.createTextNode(ev.metric)]));
      ul.append(li);
    }
    details.append(ul);
    card.append(details);
  }

  return card;
}

function tierHeader(label, count, kind) {
  const wrap = el('div', { class: 'tier-header ' + kind });
  wrap.append(
    el('span', { class: 'dot' }),
    document.createTextNode(label + ' Tier'),
    el('span', { class: 'line' }),
    document.createTextNode(count + (count === 1 ? ' post' : ' posts'))
  );
  return wrap;
}

function showToast() {
  const t = document.getElementById('toast');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1300);
}

function render() {
  const format = document.getElementById('filter-format').value;
  const theme = document.getElementById('filter-theme').value;
  const sort = document.getElementById('sort').value;
  const hideBackup = document.getElementById('hide-backup').checked;

  let list = DATA.candidates.slice();
  if (format) list = list.filter((c) => c.format === format);
  if (theme) list = list.filter((c) => c.theme === theme);
  if (hideBackup) list = list.filter((c) => c.tier === 'hero');

  list.sort((a, b) => (b.scores[sort] ?? 0) - (a.scores[sort] ?? 0));

  const root = document.getElementById('cards');
  root.innerHTML = '';

  const hero = list.filter((c) => c.tier === 'hero');
  const backup = list.filter((c) => c.tier === 'backup');

  if (hero.length > 0) {
    root.append(tierHeader('Hero', hero.length, 'hero'));
    for (const c of hero) root.append(buildCard(c));
  }
  if (backup.length > 0) {
    root.append(tierHeader('Backup', backup.length, 'backup'));
    for (const c of backup) root.append(buildCard(c));
  }
  if (list.length === 0) {
    root.append(el('div', { class: 'empty' }, [document.createTextNode('No candidates match the current filters.')]));
  }

  const chip = document.getElementById('count-chip');
  const isFiltered = list.length !== TOTAL;
  chip.innerHTML = '<strong>' + list.length + '</strong> shown' + (isFiltered ? ' <span style="color:var(--text-3);">· filtered from ' + TOTAL + '</span>' : '');
}

document.getElementById('filter-format').addEventListener('change', render);
document.getElementById('filter-theme').addEventListener('change', render);
document.getElementById('sort').addEventListener('change', render);
document.getElementById('hide-backup').addEventListener('change', render);
render();

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    const target = document.getElementById('tab-' + btn.dataset.tab);
    if (target) target.classList.add('active');
  });
});
</script>
</body>
</html>`;

  fs.writeFileSync(outPath, html);
  console.log(`[dashboard] Wrote ${outPath}`);
  getProgress()?.log(`Wrote ${outPath}`, "dashboard");
  return outPath;
}
