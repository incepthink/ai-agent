import fs from "node:fs";
import path from "node:path";
import type { DataWarning, FillerPostIdea, VoiceProfile } from "../types.js";

const OUTPUT_DIR = "./output";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface DatasetSummary {
  source: "offline";
  targetHandle: string;
  targetAccountName: string;
  targetTweetCount: number;
  competitorCounts: { handle: string; accountName: string; count: number }[];
}

function derivePillars(ideas: FillerPostIdea[], voice: VoiceProfile): string[] {
  const counts = new Map<string, number>();
  for (const i of ideas) {
    const seed = i.extractedHookPattern || i.reuseMethod;
    counts.set(seed, (counts.get(seed) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  const nouns = voice.vocabulary.topNouns.slice(0, 4);
  return [...top, ...nouns].slice(0, 6);
}

export function renderOfflineDashboard(
  ideas: FillerPostIdea[],
  voice: VoiceProfile,
  dataset: DatasetSummary,
  warnings: DataWarning[]
): string {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, "dashboard.html");

  const competitorOptions = [...new Set(ideas.map((i) => i.sourceCompetitorHandle))].sort();
  const postTypeOptions = [...new Set(ideas.map((i) => i.sourceCompetitorPostType))].sort();
  const priorityOptions = ["high", "medium", "low"];
  const riskOptions = ["low", "medium", "high"];
  const reuseOptions = [...new Set(ideas.map((i) => i.reuseMethod))].sort();

  const pillars = derivePillars(ideas, voice);

  const dataJson = JSON.stringify({ ideas, voice, dataset, warnings, pillars });

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Filler Post Studio — @${escapeHtml(dataset.targetHandle)} (offline)</title>
<style>
  :root {
    --bg: #0f1419;
    --panel: #16202a;
    --panel-2: #1c2732;
    --border: #2a3744;
    --text: #e7ecef;
    --muted: #8899a6;
    --accent: #1d9bf0;
    --good: #00ba7c;
    --ok: #ffad1f;
    --bad: #f4212e;
    --warn: #ffad1f;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  header { padding: 22px 28px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
  header h1 { margin: 0; font-size: 22px; font-weight: 700; }
  header .meta { color: var(--muted); font-size: 13px; }
  .badge-offline { background: var(--panel-2); color: var(--accent); border: 1px solid var(--accent); padding: 2px 10px; border-radius: 999px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .container { max-width: 1280px; margin: 0 auto; padding: 24px 28px; }
  .summary { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 12px; margin-bottom: 20px; }
  @media (max-width: 980px) { .summary { grid-template-columns: 1fr; } }
  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
  .panel h3 { margin: 0 0 8px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; }
  .panel ul { margin: 4px 0; padding-left: 18px; }
  .panel li { margin: 3px 0; font-size: 13px; }
  .kv { display: grid; grid-template-columns: 110px 1fr; gap: 4px 10px; font-size: 13px; }
  .kv .k { color: var(--muted); }
  .pill { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--panel-2); color: var(--text); border: 1px solid var(--border); margin: 2px 4px 2px 0; }
  .pill.accent { color: var(--accent); border-color: var(--accent); }
  .pill.warn { color: var(--warn); border-color: var(--warn); }
  .toolbar { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 20px; padding: 14px; background: var(--panel); border-radius: 10px; border: 1px solid var(--border); }
  .toolbar label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  .toolbar select { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font: inherit; }
  .toolbar .chip { background: var(--panel-2); padding: 4px 10px; border-radius: 999px; color: var(--muted); font-size: 12px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 0; margin-bottom: 16px; overflow: hidden; }
  .card .grid { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 0; }
  @media (max-width: 980px) { .card .grid { grid-template-columns: 1fr; } }
  .col { padding: 16px; border-right: 1px solid var(--border); }
  .col:last-child { border-right: none; }
  @media (max-width: 980px) { .col { border-right: none; border-bottom: 1px solid var(--border); } .col:last-child { border-bottom: none; } }
  .col h4 { margin: 0 0 8px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; }
  .src-meta { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
  .src-text { font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; max-height: 200px; overflow: auto; padding: 10px; background: var(--panel-2); border-radius: 8px; border: 1px solid var(--border); }
  .adapted { font-size: 15px; line-height: 1.55; white-space: pre-wrap; word-wrap: break-word; padding: 10px; background: var(--panel-2); border-radius: 8px; border: 1px solid var(--border); margin-bottom: 10px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  button { background: var(--accent); color: white; border: none; padding: 6px 12px; border-radius: 6px; font: inherit; font-size: 12px; cursor: pointer; }
  button.ghost { background: transparent; color: var(--muted); border: 1px solid var(--border); }
  button:hover { opacity: 0.9; }
  .scoreline { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .score { font-size: 11px; padding: 3px 8px; border-radius: 4px; background: var(--panel-2); border: 1px solid var(--border); }
  .score.good { color: var(--good); border-color: var(--good); }
  .score.ok { color: var(--ok); border-color: var(--ok); }
  .score.bad { color: var(--bad); border-color: var(--bad); }
  .repost-badge { background: var(--warn); color: black; font-size: 10px; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px; margin-left: 6px; }
  .why { font-size: 12px; color: var(--muted); margin-top: 8px; font-style: italic; }
  .warning-panel { background: rgba(255, 173, 31, 0.08); border-color: var(--warn); }
  .warning-panel h3 { color: var(--warn); }
  .empty { padding: 40px; text-align: center; color: var(--muted); background: var(--panel); border-radius: 10px; }
  .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--good); color: white; padding: 10px 18px; border-radius: 8px; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
<header>
  <div>
    <h1>Filler Post Studio <span class="badge-offline">offline</span></h1>
    <div class="meta">
      Target: <strong>@${escapeHtml(dataset.targetHandle)}</strong> · ${escapeHtml(dataset.targetAccountName)} ·
      ${ideas.length} ideas from local JSON
    </div>
  </div>
  <div class="meta">${new Date().toLocaleString()}</div>
</header>

<div class="container">

  <div class="summary">
    <div class="panel">
      <h3>Target Account</h3>
      <div class="kv">
        <div class="k">Handle</div><div>@${escapeHtml(dataset.targetHandle)}</div>
        <div class="k">Name</div><div>${escapeHtml(dataset.targetAccountName)}</div>
        <div class="k">Tone</div><div>${escapeHtml(voice.styleNotes || "(no style notes inferred)")}</div>
        <div class="k">Pillars</div><div>${pillars.map((p) => `<span class="pill">${escapeHtml(p)}</span>`).join(" ")}</div>
        <div class="k">Avg len</div><div>~${voice.avgTweetLength} chars · emoji ${voice.emojiRate}/post · hashtag ${voice.hashtagRate}/post</div>
        <div class="k">Hooks</div><div>${voice.hookPatterns.length > 0 ? voice.hookPatterns.map((h) => `<span class="pill">${escapeHtml(h)}</span>`).join(" ") : '<span class="pill">none observed</span>'}</div>
        <div class="k">Taboo</div><div>${voice.taboo.length > 0 ? voice.taboo.map((t) => `<span class="pill warn">${escapeHtml(t)}</span>`).join(" ") : '<span class="pill">none observed</span>'}</div>
      </div>
    </div>

    <div class="panel">
      <h3>Dataset</h3>
      <div class="kv">
        <div class="k">Source</div><div><span class="pill accent">offline / local JSON</span></div>
        <div class="k">Target file</div><div>${escapeHtml(dataset.targetTweetCount.toString())} tweets</div>
      </div>
      <h3 style="margin-top:12px">Competitors</h3>
      <ul>${dataset.competitorCounts.map((c) => `<li>@${escapeHtml(c.handle)} <span style="color:var(--muted)">(${c.count} tweets)</span></li>`).join("")}</ul>
    </div>

    <div class="panel warning-panel">
      <h3>Data warnings (${warnings.length})</h3>
      ${
        warnings.length === 0
          ? '<div style="color:var(--muted);font-size:13px">No warnings.</div>'
          : `<ul>${warnings.slice(0, 8).map((w) => `<li><strong>${escapeHtml(w.kind)}</strong>: ${escapeHtml(w.message)}</li>`).join("")}${warnings.length > 8 ? `<li>...and ${warnings.length - 8} more (see data-warnings.json)</li>` : ""}</ul>`
      }
    </div>
  </div>

  <div class="toolbar">
    <label>Competitor</label>
    <select id="f-comp"><option value="">all</option>${competitorOptions.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}</select>
    <label>Post type</label>
    <select id="f-type"><option value="">all</option>${postTypeOptions.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}</select>
    <label>Priority</label>
    <select id="f-priority"><option value="">all</option>${priorityOptions.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}</select>
    <label>Risk</label>
    <select id="f-risk"><option value="">all</option>${riskOptions.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}</select>
    <label>Reuse</label>
    <select id="f-reuse"><option value="">all</option>${reuseOptions.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}</select>
    <label>Origin</label>
    <select id="f-origin"><option value="">all</option><option value="original">original</option><option value="repost">repost</option></select>
    <span class="chip" id="count-chip">${ideas.length} shown</span>
  </div>

  <div id="cards"></div>
</div>

<div class="toast" id="toast">Copied!</div>

<script>
const DATA = ${dataJson};

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

function scoreCls10(n) {
  if (n >= 8) return 'score good';
  if (n >= 5) return 'score ok';
  return 'score bad';
}
function riskCls(r) {
  if (r === 'low') return 'score good';
  if (r === 'medium') return 'score ok';
  return 'score bad';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg || 'Copied!';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1200);
}

function buildCard(i) {
  const card = el('div', { class: 'card' });
  const grid = el('div', { class: 'grid' });

  // Column A — Competitor Source
  const colA = el('div', { class: 'col' });
  colA.append(el('h4', {}, [document.createTextNode('Competitor source')]));
  const head = el('div', { class: 'src-meta' });
  head.append(document.createTextNode(i.sourceCompetitorAccountName + ' '));
  head.append(el('strong', {}, [document.createTextNode(i.sourceCompetitorHandle)]));
  head.append(document.createTextNode(' · ' + i.sourceCompetitorDate + ' · ' + i.sourceCompetitorPostType));
  if (i.sourceWasRepost) {
    head.append(el('span', { class: 'repost-badge' }, [document.createTextNode('repost')]));
    if (i.repostedBy) head.append(document.createTextNode(' by ' + i.repostedBy));
  }
  colA.append(head);
  colA.append(el('div', { class: 'src-text' }, [document.createTextNode(i.sourceCompetitorPostText)]));
  if (i.sourceMediaDescription) {
    colA.append(el('div', { class: 'why' }, [document.createTextNode('Media: ' + i.sourceMediaDescription)]));
  }
  colA.append(el('div', { class: 'why' }, [document.createTextNode('URL: URL not provided')]));

  // Column B — Extracted Pattern
  const colB = el('div', { class: 'col' });
  colB.append(el('h4', {}, [document.createTextNode('Extracted pattern')]));
  const kv = el('div', { class: 'kv' });
  kv.append(el('div', { class: 'k' }, [document.createTextNode('Idea')]), el('div', {}, [document.createTextNode(i.extractedIdea)]));
  kv.append(el('div', { class: 'k' }, [document.createTextNode('Hook')]), el('div', {}, [document.createTextNode(i.extractedHookPattern)]));
  kv.append(el('div', { class: 'k' }, [document.createTextNode('Reuse')]), el('div', {}, [el('span', { class: 'pill accent' }, [document.createTextNode(i.reuseMethod)])]));
  colB.append(kv);
  if (i.whyThisWorks) colB.append(el('div', { class: 'why' }, [document.createTextNode('Why useful: ' + i.whyThisWorks)]));

  // Column C — Adapted Target Post
  const colC = el('div', { class: 'col' });
  colC.append(el('h4', {}, [document.createTextNode('Adapted for @' + DATA.dataset.targetHandle)]));
  colC.append(el('div', { class: 'adapted' }, [document.createTextNode(i.adaptedPostForTarget)]));
  const meta = el('div', { class: 'kv' });
  meta.append(el('div', { class: 'k' }, [document.createTextNode('Visual')]), el('div', {}, [document.createTextNode(i.visualDirection)]));
  if (i.suggestedHashtags.length > 0) {
    meta.append(el('div', { class: 'k' }, [document.createTextNode('Hashtags')]), el('div', {}, [document.createTextNode(i.suggestedHashtags.join(' '))]));
  }
  meta.append(el('div', { class: 'k' }, [document.createTextNode('Window')]), el('div', {}, [document.createTextNode(i.bestPostingWindow)]));
  meta.append(el('div', { class: 'k' }, [document.createTextNode('Production')]), el('div', {}, [document.createTextNode(i.estimatedProductionTime)]));
  colC.append(meta);

  const scoreline = el('div', { class: 'scoreline' });
  scoreline.append(
    el('span', { class: scoreCls10(i.brandFitScore) }, [document.createTextNode('Brand fit ' + i.brandFitScore + '/10')]),
    el('span', { class: scoreCls10(i.usefulnessScore) }, [document.createTextNode('Useful ' + i.usefulnessScore + '/10')]),
    el('span', { class: riskCls(i.similarityRisk) }, [document.createTextNode('Risk ' + i.similarityRisk)]),
    el('span', { class: 'score' }, [document.createTextNode('Priority ' + i.priority)]),
    el('span', { class: 'score' }, [document.createTextNode('Difficulty ' + i.difficulty)])
  );
  colC.append(scoreline);

  if (i.plagiarismWarning) {
    colC.append(el('div', { class: 'why', style: 'color:var(--bad)' }, [document.createTextNode('⚠ ' + i.plagiarismWarning)]));
  }
  if (i.whyItFitsTargetAccount) {
    colC.append(el('div', { class: 'why' }, [document.createTextNode('Why it fits: ' + i.whyItFitsTargetAccount)]));
  }

  const actions = el('div', { class: 'actions' });
  const cpAdapt = el('button', {}, [document.createTextNode('Copy adapted post')]);
  cpAdapt.onclick = () => navigator.clipboard.writeText(i.adaptedPostForTarget).then(() => showToast('Adapted post copied'));
  const cpVis = el('button', { class: 'ghost' }, [document.createTextNode('Copy visual brief')]);
  cpVis.onclick = () => navigator.clipboard.writeText(i.visualDirection).then(() => showToast('Visual brief copied'));
  const cpTag = el('button', { class: 'ghost' }, [document.createTextNode('Copy hashtags')]);
  cpTag.onclick = () => navigator.clipboard.writeText(i.suggestedHashtags.join(' ')).then(() => showToast('Hashtags copied'));
  actions.append(cpAdapt, cpVis, cpTag);
  colC.append(actions);

  grid.append(colA, colB, colC);
  card.append(grid);
  return card;
}

function applyFilters() {
  const comp = document.getElementById('f-comp').value;
  const type = document.getElementById('f-type').value;
  const prio = document.getElementById('f-priority').value;
  const risk = document.getElementById('f-risk').value;
  const reuse = document.getElementById('f-reuse').value;
  const origin = document.getElementById('f-origin').value;

  let list = DATA.ideas.slice();
  if (comp) list = list.filter(i => i.sourceCompetitorHandle === comp);
  if (type) list = list.filter(i => i.sourceCompetitorPostType === type);
  if (prio) list = list.filter(i => i.priority === prio);
  if (risk) list = list.filter(i => i.similarityRisk === risk);
  if (reuse) list = list.filter(i => i.reuseMethod === reuse);
  if (origin === 'repost') list = list.filter(i => i.sourceWasRepost);
  if (origin === 'original') list = list.filter(i => !i.sourceWasRepost);

  const root = document.getElementById('cards');
  root.innerHTML = '';
  if (list.length === 0) {
    root.append(el('div', { class: 'empty' }, [document.createTextNode('No ideas match the filters.')]));
  } else {
    for (const i of list) root.append(buildCard(i));
  }
  document.getElementById('count-chip').textContent = list.length + ' shown';
}

['f-comp','f-type','f-priority','f-risk','f-reuse','f-origin'].forEach(id => {
  document.getElementById(id).addEventListener('change', applyFilters);
});
applyFilters();
</script>
</body>
</html>`;

  fs.writeFileSync(outPath, html);
  console.log(`[dashboard] Wrote ${outPath}`);
  return outPath;
}
