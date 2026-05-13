import fs from "node:fs";
import path from "node:path";
import type { Insights, PostCandidate, VoiceProfile } from "../types.js";

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
      case "heatmap": return "Posting Heatmap";
      case "engagement": return "Engagement Over Time";
      case "hashtags": return "Top Hashtags";
      case "posttypes": return "Post Type Breakdown";
      default: return kind;
    }
  };

  const analyticsHtml = charts.length === 0
    ? `<div class="empty">No charts were generated.</div>`
    : `
      ${comparison
        ? `<div class="chart-group"><h2>Head-to-head</h2><div class="chart-section"><h3>Comparison</h3><img src="${escapeHtml(path.basename(comparison.path))}" alt="comparison"/></div></div>`
        : ""}
      ${[...byHandle.entries()].map(([handle, items]) => `
        <div class="chart-group">
          <h2>@${escapeHtml(handle)}</h2>
          ${items.map((c) => `<div class="chart-section"><h3>${escapeHtml(chartLabel(c.kind))}</h3><img src="${escapeHtml(path.basename(c.path))}" alt="${escapeHtml(c.kind)} for ${escapeHtml(handle)}"/></div>`).join("")}
        </div>
      `).join("")}
    `;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Filler Post Studio — @${escapeHtml(insights.target)}</title>
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
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  header { padding: 22px 28px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
  header h1 { margin: 0; font-size: 22px; font-weight: 700; }
  header .meta { color: var(--muted); font-size: 13px; }
  .container { max-width: 980px; margin: 0 auto; padding: 24px 28px; }
  .toolbar { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 20px; padding: 14px; background: var(--panel); border-radius: 10px; border: 1px solid var(--border); }
  .toolbar label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  .toolbar select, .toolbar input { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font: inherit; }
  .toolbar .chip { background: var(--panel-2); padding: 4px 10px; border-radius: 999px; color: var(--muted); font-size: 12px; }
  .tier-header { margin: 28px 0 12px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; gap: 10px; }
  .tier-header::before { content: ""; flex: 1; height: 1px; background: var(--border); }
  .tier-header::after { content: ""; flex: 1; height: 1px; background: var(--border); }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 18px; margin-bottom: 14px; transition: border-color 0.15s; }
  .card:hover { border-color: var(--accent); }
  .card.hero { border-left: 3px solid var(--accent); }
  .card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  .card-head .left { display: flex; gap: 8px; align-items: center; }
  .rank { color: var(--muted); font-size: 12px; font-weight: 600; }
  .pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--panel-2); color: var(--text); border: 1px solid var(--border); text-transform: lowercase; }
  .pill.format { color: var(--accent); border-color: var(--accent); }
  .post-text { font-size: 15px; line-height: 1.55; margin: 8px 0 12px; white-space: pre-wrap; word-wrap: break-word; }
  .image-brief { font-size: 12px; color: var(--muted); border-left: 2px solid var(--border); padding-left: 10px; margin: 0 0 12px; font-style: italic; }
  .scores { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
  .score { font-size: 11px; padding: 3px 8px; border-radius: 4px; background: var(--panel-2); border: 1px solid var(--border); }
  .score-good { color: var(--good); border-color: var(--good); }
  .score-ok { color: var(--ok); border-color: var(--ok); }
  .score-bad { color: var(--bad); border-color: var(--bad); }
  .reasoning { font-size: 13px; color: var(--muted); margin: 8px 0; }
  .card-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 8px; }
  button { background: var(--accent); color: white; border: none; padding: 6px 12px; border-radius: 6px; font: inherit; font-size: 12px; cursor: pointer; }
  button:hover { opacity: 0.9; }
  button.ghost { background: transparent; color: var(--muted); border: 1px solid var(--border); }
  button.ghost:hover { color: var(--text); border-color: var(--text); }
  details.evidence { font-size: 12px; color: var(--muted); margin-top: 6px; }
  details.evidence summary { cursor: pointer; padding: 6px 0; }
  details.evidence ul { margin: 6px 0; padding-left: 18px; }
  details.evidence a { color: var(--accent); }
  .empty { padding: 40px; text-align: center; color: var(--muted); background: var(--panel); border-radius: 10px; }
  .intel { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
  @media (max-width: 720px) { .intel { grid-template-columns: 1fr; } }
  .intel-panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px; }
  .intel-panel h3 { margin: 0 0 8px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
  .intel-panel li { margin: 4px 0; font-size: 13px; }
  .intel-panel .num { color: var(--accent); font-weight: 600; }
  .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--good); color: white; padding: 10px 18px; border-radius: 8px; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
  .toast.show { opacity: 1; }
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
  .tab { background: transparent; color: var(--muted); border: none; border-bottom: 2px solid transparent; padding: 10px 16px; font: inherit; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer; }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  .chart-group { margin-bottom: 28px; }
  .chart-group > h2 { font-size: 16px; margin: 0 0 12px; }
  .chart-section { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 18px; margin-bottom: 16px; }
  .chart-section h3 { margin: 0 0 12px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
  .chart-section img { display: block; width: 100%; max-width: 100%; height: auto; border-radius: 8px; background: #fff; }
</style>
</head>
<body>
<header>
  <div>
    <h1>Filler Post Studio</h1>
    <div class="meta">
      Target: <strong>@${escapeHtml(insights.target)}</strong>  ·
      Competitors: ${insights.competitors.map((c) => "@" + escapeHtml(c)).join(", ")}  ·
      Generated ${new Date(insights.generatedAt).toLocaleString()}
    </div>
  </div>
  <div class="meta">${candidates.length} candidates</div>
</header>

<div class="container">

  <nav class="tabs">
    <button class="tab active" data-tab="posts">Posts</button>
    <button class="tab" data-tab="analytics">Analytics</button>
  </nav>

  <div id="tab-posts" class="tab-panel active">

  <div class="intel">
    <div class="intel-panel">
      <h3>Top Hooks Mined</h3>
      <ul>${insights.topHooks
        .slice(0, 5)
        .map((h) => `<li><span class="num">${h.frequency}×</span> ${escapeHtml(h.signature)} — ${escapeHtml(h.description)}</li>`)
        .join("")}</ul>
    </div>
    <div class="intel-panel">
      <h3>Hot Topics</h3>
      <ul>${insights.hotTopics
        .slice(0, 5)
        .map((t) => `<li><span class="num">${t.mentions}×</span> ${escapeHtml(t.topic)} (avg eng ${t.avgEngagement.toLocaleString()})</li>`)
        .join("")}</ul>
    </div>
  </div>

  <div class="toolbar">
    <label for="filter-format">Format</label>
    <select id="filter-format">
      <option value="">all</option>
      ${allFormats.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("")}
    </select>
    <label for="filter-theme">Theme</label>
    <select id="filter-theme">
      <option value="">all</option>
      ${allThemes.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
    </select>
    <label for="sort">Sort</label>
    <select id="sort">
      <option value="composite">composite</option>
      <option value="quality">quality</option>
      <option value="brandFit">brand fit</option>
      <option value="expectedEngagement">expected engagement</option>
    </select>
    <label><input type="checkbox" id="hide-backup"> hide backup</label>
    <span class="chip" id="count-chip">${candidates.length} shown</span>
  </div>

  <div id="cards"></div>

  </div>

  <div id="tab-analytics" class="tab-panel">
    ${analyticsHtml}
  </div>

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

function pct(n) { return Math.round(n * 100); }

function scoreCls(v, invert) {
  const x = invert ? 1 - v : v;
  if (x >= 0.75) return 'score score-good';
  if (x >= 0.5) return 'score score-ok';
  return 'score score-bad';
}

function buildCard(c) {
  const card = el('div', { class: 'card ' + c.tier });

  const head = el('div', { class: 'card-head' });
  head.append(
    el('div', { class: 'left' }, [
      el('span', { class: 'rank' }, [document.createTextNode('#' + c.rank)]),
      el('span', { class: 'pill format' }, [document.createTextNode(c.format)]),
      el('span', { class: 'pill' }, [document.createTextNode(c.theme)]),
    ]),
    el('span', { class: 'pill' }, [document.createTextNode(c.tier)])
  );
  card.append(head);

  card.append(el('div', { class: 'post-text' }, [document.createTextNode(c.text)]));

  if (c.imageBrief) {
    card.append(el('div', { class: 'image-brief' }, [document.createTextNode('Image idea: ' + c.imageBrief)]));
  }

  const scores = el('div', { class: 'scores' });
  scores.append(
    el('span', { class: scoreCls(c.scores.composite) }, [document.createTextNode('Composite ' + pct(c.scores.composite))]),
    el('span', { class: scoreCls(c.scores.quality) }, [document.createTextNode('Quality ' + pct(c.scores.quality))]),
    el('span', { class: scoreCls(c.scores.brandFit) }, [document.createTextNode('Fit ' + pct(c.scores.brandFit))]),
    el('span', { class: scoreCls(c.scores.plagiarismRisk, true) }, [document.createTextNode('Risk ' + pct(c.scores.plagiarismRisk))]),
    el('span', { class: scoreCls(c.scores.effort, true) }, [document.createTextNode('Effort ' + pct(c.scores.effort))]),
    el('span', { class: scoreCls(c.scores.expectedEngagement) }, [document.createTextNode('Eng ' + pct(c.scores.expectedEngagement))])
  );
  card.append(scores);

  if (c.reasoning) {
    card.append(el('div', { class: 'reasoning' }, [document.createTextNode('Why it lands: ' + c.reasoning)]));
  }

  const actions = el('div', { class: 'card-actions' });
  const copyBtn = el('button', {}, [document.createTextNode('Copy')]);
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(c.text).then(showToast);
  };
  actions.append(copyBtn);

  const tweetUrl = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(c.text);
  const postBtn = el('a', { href: tweetUrl, target: '_blank', rel: 'noopener' }, [document.createTextNode('Open in X')]);
  postBtn.className = 'ghost';
  postBtn.style.cssText = 'text-decoration:none;padding:6px 12px;border-radius:6px;font-size:12px;background:transparent;color:var(--muted);border:1px solid var(--border);';
  actions.append(postBtn);
  card.append(actions);

  if (c.sourceEvidence && c.sourceEvidence.length > 0) {
    const details = el('details', { class: 'evidence' });
    details.append(el('summary', {}, [document.createTextNode('Source evidence (' + c.sourceEvidence.length + ')')]));
    const ul = el('ul');
    for (const ev of c.sourceEvidence) {
      const li = el('li');
      const link = el('a', { href: ev.url, target: '_blank', rel: 'noopener' }, [document.createTextNode('@' + ev.handle)]);
      li.append(link, document.createTextNode(' — "' + ev.excerpt + '..." (' + ev.metric + ')'));
      ul.append(li);
    }
    details.append(ul);
    card.append(details);
  }

  return card;
}

function showToast() {
  const t = document.getElementById('toast');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1200);
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
    root.append(el('div', { class: 'tier-header' }, [document.createTextNode('Hero Tier (' + hero.length + ')')]));
    for (const c of hero) root.append(buildCard(c));
  }
  if (backup.length > 0) {
    root.append(el('div', { class: 'tier-header' }, [document.createTextNode('Backup Tier (' + backup.length + ')')]));
    for (const c of backup) root.append(buildCard(c));
  }
  if (list.length === 0) root.append(el('div', { class: 'empty' }, [document.createTextNode('No candidates match the filters.')]));

  document.getElementById('count-chip').textContent = list.length + ' shown';
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
  return outPath;
}
