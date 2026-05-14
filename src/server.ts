import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { ProgressEmitter, ProgressEvent } from "./progress.js";

const OUTPUT_DIR = path.resolve("./output");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function safeOutputPath(reqPath: string): string | null {
  // Strip leading slash, decode, resolve against OUTPUT_DIR, reject traversal.
  const rel = decodeURIComponent(reqPath.replace(/^\/+/, ""));
  if (!rel) return null;
  const abs = path.resolve(OUTPUT_DIR, rel);
  if (!abs.startsWith(OUTPUT_DIR + path.sep) && abs !== OUTPUT_DIR) return null;
  return abs;
}

function serveFile(absPath: string, res: http.ServerResponse): void {
  fs.stat(absPath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
    res.setHeader("Content-Length", String(stat.size));
    fs.createReadStream(absPath).pipe(res);
  });
}

function sseSend(res: http.ServerResponse, e: ProgressEvent): void {
  res.write(`data: ${JSON.stringify(e)}\n\n`);
}

export interface ServerHandle {
  port: number;
  url: string;
  close(): Promise<void>;
}

export async function startServer(
  progress: ProgressEmitter,
  preferredPort = Number(process.env.PROGRESS_PORT ?? 4173),
): Promise<ServerHandle> {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";

    if (url === "/" || url === "/index.html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(progressPageHtml());
      return;
    }

    if (url === "/events") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      // Replay history so a late-connecting browser sees past stages.
      for (const e of progress.history()) sseSend(res, e);

      const unsubscribe = progress.onEvent((e) => sseSend(res, e));
      const keepalive = setInterval(() => {
        res.write(`: keepalive\n\n`);
      }, 15_000);

      req.on("close", () => {
        clearInterval(keepalive);
        unsubscribe();
      });
      return;
    }

    if (url === "/dashboard") {
      const dashboardFile = path.join(OUTPUT_DIR, "dashboard.html");
      serveFile(dashboardFile, res);
      return;
    }

    if (url === "/favicon.ico") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === "GET") {
      // Strip query string before resolving.
      const cleanPath = url.split("?")[0];
      const abs = safeOutputPath(cleanPath);
      if (abs) {
        serveFile(abs, res);
        return;
      }
    }

    res.statusCode = 404;
    res.end("Not found");
  });

  return new Promise((resolve, reject) => {
    const tryListen = (port: number, attemptsLeft: number) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("error", onError);
        if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
          tryListen(port + 1, attemptsLeft - 1);
        } else {
          reject(err);
        }
      };
      server.once("error", onError);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", onError);
        const addr = server.address() as AddressInfo;
        resolve({
          port: addr.port,
          url: `http://localhost:${addr.port}`,
          close: () =>
            new Promise<void>((res) =>
              server.close(() => res()),
            ),
        });
      });
    };
    tryListen(preferredPort, 10);
  });
}

const STAGES: Array<{ id: string; label: string }> = [
  { id: "fetch", label: "[1/7] Fetch profiles + tweets" },
  { id: "voice", label: "[2/7] Voice profile" },
  { id: "mining", label: "[3/7] Pattern mining" },
  { id: "charts", label: "[3.5/7] Analytics charts" },
  { id: "generate", label: "[4/7] Generate candidates" },
  { id: "score", label: "[5/7] Score candidates" },
  { id: "rank", label: "[6/7] Filter + rank" },
  { id: "write", label: "[7/7] Write artifacts + dashboard" },
];

function progressPageHtml(): string {
  const stagesJson = JSON.stringify(STAGES);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Filler Post Agent — Running…</title>
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
  h2 { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 12px; }
  .stages { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 10px; margin-bottom: 20px; }
  .stage { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 8px; }
  .stage + .stage { border-top: 1px solid var(--border); }
  .stage .label { flex: 1; }
  .stage .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--border); flex-shrink: 0; }
  .stage.running .dot { background: var(--accent); box-shadow: 0 0 0 4px rgba(29, 155, 240, 0.18); animation: pulse 1.2s ease-in-out infinite; }
  .stage.done .dot { background: var(--good); }
  .stage.error .dot { background: var(--bad); }
  .stage .timing { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 12px; min-width: 60px; text-align: right; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
  .feed-wrap { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  .feed-head { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
  .feed-head h2 { margin: 0; }
  .feed { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.55; max-height: 480px; overflow-y: auto; padding: 12px 16px; }
  .feed .line { padding: 1px 0; white-space: pre-wrap; word-break: break-word; }
  .feed .time { color: var(--muted); margin-right: 8px; }
  .feed .src { display: inline-block; min-width: 90px; margin-right: 8px; color: var(--accent); }
  .feed .src.cache { color: var(--ok); }
  .feed .src.twitterapi { color: #b794f4; }
  .feed .src.artifacts { color: var(--good); }
  .feed .src.dashboard { color: var(--good); }
  .feed .src.pipeline { color: var(--accent); }
  .feed .line.warn .msg { color: var(--ok); }
  .feed .line.error .msg { color: var(--bad); }
  .banner { display: none; padding: 14px 18px; background: rgba(244, 33, 46, 0.12); border: 1px solid var(--bad); color: var(--bad); border-radius: 10px; margin-bottom: 16px; }
  .banner.show { display: block; }
  .pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--panel-2); color: var(--muted); border: 1px solid var(--border); }
  #status-pill.running { color: var(--accent); border-color: var(--accent); }
  #status-pill.done { color: var(--good); border-color: var(--good); }
  #status-pill.error { color: var(--bad); border-color: var(--bad); }
</style>
</head>
<body>
<header>
  <div>
    <h1>Filler Post Intelligence Agent</h1>
    <div class="meta">Live pipeline progress · the dashboard will open automatically when finished</div>
  </div>
  <span class="pill" id="status-pill">connecting…</span>
</header>

<div class="container">
  <div class="banner" id="error-banner"></div>

  <h2>Stages</h2>
  <div class="stages" id="stages"></div>

  <div class="feed-wrap">
    <div class="feed-head">
      <h2>Log feed</h2>
      <span class="pill" id="line-count">0 lines</span>
    </div>
    <div class="feed" id="feed"></div>
  </div>
</div>

<script>
const STAGES = ${stagesJson};
const stageState = new Map();
const stagesEl = document.getElementById('stages');
const feedEl = document.getElementById('feed');
const lineCountEl = document.getElementById('line-count');
const statusPill = document.getElementById('status-pill');
const errorBanner = document.getElementById('error-banner');

let lineCount = 0;
let autoScroll = true;
feedEl.addEventListener('scroll', () => {
  const nearBottom = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 24;
  autoScroll = nearBottom;
});

function renderStages() {
  stagesEl.innerHTML = '';
  for (const s of STAGES) {
    const st = stageState.get(s.id) || { status: 'pending' };
    const row = document.createElement('div');
    row.className = 'stage ' + st.status;
    row.dataset.id = s.id;
    row.innerHTML =
      '<span class="dot"></span>' +
      '<span class="label">' + escapeHtml(s.label) + '</span>' +
      '<span class="timing">' + (st.timing || '') + '</span>';
    stagesEl.appendChild(row);
  }
}

function fmtDuration(ms) {
  if (ms < 1000) return ms + 'ms';
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + 's';
  const m = Math.floor(s / 60);
  return m + 'm' + Math.round(s - m * 60) + 's';
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

setInterval(() => {
  let changed = false;
  for (const [id, st] of stageState) {
    if (st.status === 'running' && st.startedAt) {
      const elapsed = Date.now() - st.startedAt;
      const t = fmtDuration(elapsed);
      if (t !== st.timing) { st.timing = t; changed = true; }
    }
  }
  if (changed) renderStages();
}, 250);

function appendLog(ev) {
  const line = document.createElement('div');
  line.className = 'line ' + (ev.level || 'info');
  line.innerHTML =
    '<span class="time">' + fmtTime(ev.ts) + '</span>' +
    '<span class="src ' + escapeHtml(ev.source) + '">[' + escapeHtml(ev.source) + ']</span>' +
    '<span class="msg">' + escapeHtml(ev.msg) + '</span>';
  feedEl.appendChild(line);
  lineCount++;
  lineCountEl.textContent = lineCount + ' lines';
  if (autoScroll) feedEl.scrollTop = feedEl.scrollHeight;
}

function handle(ev) {
  if (ev.kind === 'stage-start') {
    stageState.set(ev.id, { status: 'running', startedAt: ev.ts, timing: '0ms' });
    statusPill.className = 'pill running';
    statusPill.textContent = 'running';
    renderStages();
  } else if (ev.kind === 'stage-end') {
    const prev = stageState.get(ev.id) || {};
    stageState.set(ev.id, { ...prev, status: 'done', timing: fmtDuration(ev.durationMs) });
    renderStages();
  } else if (ev.kind === 'log') {
    appendLog(ev);
  } else if (ev.kind === 'done') {
    statusPill.className = 'pill done';
    statusPill.textContent = 'done';
    setTimeout(() => { window.location.href = ev.dashboardUrl; }, 450);
  } else if (ev.kind === 'error') {
    statusPill.className = 'pill error';
    statusPill.textContent = 'error';
    errorBanner.textContent = ev.msg;
    errorBanner.classList.add('show');
    for (const [id, st] of stageState) {
      if (st.status === 'running') stageState.set(id, { ...st, status: 'error' });
    }
    renderStages();
  }
}

renderStages();

const es = new EventSource('/events');
es.onopen = () => {
  if (statusPill.textContent === 'connecting…') {
    statusPill.className = 'pill running';
    statusPill.textContent = 'connected';
  }
};
es.onmessage = (m) => {
  try { handle(JSON.parse(m.data)); } catch (e) { console.error('bad event', e); }
};
es.onerror = () => {
  statusPill.className = 'pill';
  statusPill.textContent = 'disconnected';
};
</script>
</body>
</html>`;
}
