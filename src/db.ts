import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { PostCandidate, Tweet } from "./types.js";

const DB_PATH = "./data/agent.db";

let _db: Database.Database | null = null;

export function openDb(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  _db = db;
  return db;
}

export function getDb(): Database.Database | null {
  return _db;
}

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tweets (
      id            TEXT NOT NULL,
      handle        TEXT NOT NULL,
      text          TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      like_count    INTEGER NOT NULL DEFAULT 0,
      retweet_count INTEGER NOT NULL DEFAULT 0,
      reply_count   INTEGER NOT NULL DEFAULT 0,
      quote_count   INTEGER NOT NULL DEFAULT 0,
      hashtags      TEXT NOT NULL DEFAULT '[]',
      has_media     INTEGER NOT NULL DEFAULT 0,
      media_type    TEXT,
      url           TEXT NOT NULL DEFAULT '',
      fetched_at    TEXT NOT NULL,
      PRIMARY KEY (id, handle)
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id                 TEXT PRIMARY KEY,
      run_id             TEXT NOT NULL,
      target             TEXT NOT NULL,
      tier               TEXT NOT NULL,
      rank               INTEGER NOT NULL,
      text               TEXT NOT NULL,
      image_brief        TEXT,
      format             TEXT NOT NULL,
      theme              TEXT NOT NULL,
      scores             TEXT NOT NULL,
      reasoning          TEXT NOT NULL,
      source_pattern_ids TEXT NOT NULL DEFAULT '[]',
      source_evidence    TEXT NOT NULL DEFAULT '[]',
      created_at         TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS posted_performance (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      likes        INTEGER NOT NULL DEFAULT 0,
      retweets     INTEGER NOT NULL DEFAULT 0,
      replies      INTEGER NOT NULL DEFAULT 0,
      posted_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS context_docs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      label      TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_config (
      id                  INTEGER PRIMARY KEY CHECK (id = 1),
      target_handle       TEXT NOT NULL,
      competitor_handles  TEXT NOT NULL,
      notify_chat_id      INTEGER NOT NULL,
      updated_at          TEXT NOT NULL
    );
  `);
}

// ── tweets ────────────────────────────────────────────────────────────────────

export function getTweets(handle: string): Tweet[] | null {
  const db = getDb();
  if (!db) return null;
  const rows = db
    .prepare("SELECT * FROM tweets WHERE handle = ? ORDER BY created_at DESC")
    .all(handle) as RawTweetRow[];
  if (rows.length === 0) return null;
  return rows.map(rowToTweet);
}

export function getTweetsLimited(handle: string, limit: number): Tweet[] {
  const db = getDb();
  if (!db) return [];
  const rows = db
    .prepare("SELECT * FROM tweets WHERE handle = ? ORDER BY created_at DESC LIMIT ?")
    .all(handle, limit) as RawTweetRow[];
  return rows.map(rowToTweet);
}

export function getTweetsSince(handle: string, days: number): Tweet[] {
  const db = getDb();
  if (!db) return [];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare("SELECT * FROM tweets WHERE handle = ? AND created_at >= ? ORDER BY created_at DESC")
    .all(handle, since) as RawTweetRow[];
  return rows.map(rowToTweet);
}

export function getTweetsByEngagement(handle: string, limit: number): Tweet[] {
  const db = getDb();
  if (!db) return [];
  const rows = db
    .prepare(
      "SELECT * FROM tweets WHERE handle = ? ORDER BY (like_count + retweet_count + reply_count) DESC LIMIT ?"
    )
    .all(handle, limit) as RawTweetRow[];
  return rows.map(rowToTweet);
}

export function getTopCandidates(
  handle: string,
  n: number
): { text: string; tier: string; format: string; scores: string; created_at: string }[] {
  const db = getDb();
  if (!db) return [];
  return db
    .prepare(
      "SELECT text, tier, format, scores, created_at FROM candidates WHERE target = ? ORDER BY created_at DESC, rank ASC LIMIT ?"
    )
    .all(handle.replace(/^@/, ""), n) as {
    text: string;
    tier: string;
    format: string;
    scores: string;
    created_at: string;
  }[];
}

export function saveTweets(handle: string, tweets: Tweet[]): void {
  const db = getDb();
  if (!db) return;
  const insert = db.prepare(`
    INSERT OR REPLACE INTO tweets
      (id, handle, text, created_at, like_count, retweet_count, reply_count,
       quote_count, hashtags, has_media, media_type, url, fetched_at)
    VALUES
      (@id, @handle, @text, @created_at, @like_count, @retweet_count, @reply_count,
       @quote_count, @hashtags, @has_media, @media_type, @url, @fetched_at)
  `);
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const t of tweets) {
      insert.run({
        id: t.id,
        handle,
        text: t.text,
        created_at: t.createdAt,
        like_count: t.likeCount,
        retweet_count: t.retweetCount,
        reply_count: t.replyCount,
        quote_count: t.quoteCount,
        hashtags: JSON.stringify(t.hashtags),
        has_media: t.hasMedia ? 1 : 0,
        media_type: t.mediaType ?? null,
        url: t.url,
        fetched_at: now,
      });
    }
  })();
}

// ── candidates ────────────────────────────────────────────────────────────────

export function saveCandidates(
  runId: string,
  target: string,
  candidates: PostCandidate[]
): void {
  const db = getDb();
  if (!db) return;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO candidates
      (id, run_id, target, tier, rank, text, image_brief, format, theme,
       scores, reasoning, source_pattern_ids, source_evidence, created_at)
    VALUES
      (@id, @run_id, @target, @tier, @rank, @text, @image_brief, @format, @theme,
       @scores, @reasoning, @source_pattern_ids, @source_evidence, @created_at)
  `);
  db.transaction(() => {
    for (const c of candidates) {
      insert.run({
        id: c.id,
        run_id: runId,
        target,
        tier: c.tier,
        rank: c.rank,
        text: c.text,
        image_brief: c.imageBrief ?? null,
        format: c.format,
        theme: c.theme,
        scores: JSON.stringify(c.scores),
        reasoning: c.reasoning,
        source_pattern_ids: JSON.stringify(c.sourcePatternIds),
        source_evidence: JSON.stringify(c.sourceEvidence),
        created_at: c.createdAt,
      });
    }
  })();
}

// ── posted_performance ────────────────────────────────────────────────────────

export function logPerformance(
  candidateId: string,
  likes: number,
  retweets: number,
  replies: number,
  postedAt: string
): void {
  const db = getDb();
  if (!db) return;
  db.prepare(`
    INSERT INTO posted_performance (candidate_id, likes, retweets, replies, posted_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(candidateId, likes, retweets, replies, postedAt);
}

// ── context_docs ──────────────────────────────────────────────────────────────

export function addContextDoc(label: string, content: string): void {
  const db = getDb();
  if (!db) return;
  db.prepare(
    "INSERT INTO context_docs (label, content, created_at) VALUES (?, ?, ?)"
  ).run(label, content, new Date().toISOString());
}

export function getContextDocs(): { label: string; content: string }[] {
  const db = getDb();
  if (!db) return [];
  return db
    .prepare("SELECT label, content FROM context_docs ORDER BY id ASC")
    .all() as { label: string; content: string }[];
}

export function getContextDocsByLabel(label: string): string[] {
  const db = getDb();
  if (!db) return [];
  const normalized = label.replace(/^@/, "").toLowerCase();
  return (
    db
      .prepare(
        "SELECT content FROM context_docs WHERE LOWER(REPLACE(label,'@','')) = ? ORDER BY id ASC"
      )
      .all(normalized) as { content: string }[]
  ).map((r) => r.content);
}

export function getContextDocsByLabelFull(label: string): { id: number; content: string; created_at: string }[] {
  const db = getDb();
  if (!db) return [];
  const normalized = label.replace(/^@/, "").toLowerCase();
  return db
    .prepare(
      "SELECT id, content, created_at FROM context_docs WHERE LOWER(REPLACE(label,'@','')) = ? ORDER BY id ASC"
    )
    .all(normalized) as { id: number; content: string; created_at: string }[];
}

export function getContextDocsFull(): { id: number; label: string; content: string; created_at: string }[] {
  const db = getDb();
  if (!db) return [];
  return db
    .prepare("SELECT id, label, content, created_at FROM context_docs ORDER BY label ASC, id ASC")
    .all() as { id: number; label: string; content: string; created_at: string }[];
}

// ── project_config ────────────────────────────────────────────────────────────

export interface ProjectConfig {
  targetHandle: string;
  competitorHandles: string[];
  notifyChatId: number;
}

export function setProjectConfig(config: ProjectConfig): void {
  const db = getDb();
  if (!db) return;
  db.prepare(`
    INSERT INTO project_config (id, target_handle, competitor_handles, notify_chat_id, updated_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      target_handle      = excluded.target_handle,
      competitor_handles = excluded.competitor_handles,
      notify_chat_id     = excluded.notify_chat_id,
      updated_at         = excluded.updated_at
  `).run(
    config.targetHandle,
    JSON.stringify(config.competitorHandles),
    config.notifyChatId,
    new Date().toISOString(),
  );
}

export function getProjectConfig(): ProjectConfig | null {
  const db = getDb();
  if (!db) return null;
  const row = db.prepare("SELECT * FROM project_config WHERE id = 1").get() as
    | { target_handle: string; competitor_handles: string; notify_chat_id: number }
    | undefined;
  if (!row) return null;
  return {
    targetHandle: row.target_handle,
    competitorHandles: JSON.parse(row.competitor_handles) as string[],
    notifyChatId: row.notify_chat_id,
  };
}

// ── internal types ────────────────────────────────────────────────────────────

interface RawTweetRow {
  id: string;
  handle: string;
  text: string;
  created_at: string;
  like_count: number;
  retweet_count: number;
  reply_count: number;
  quote_count: number;
  hashtags: string;
  has_media: number;
  media_type: string | null;
  url: string;
  fetched_at: string;
}

function rowToTweet(row: RawTweetRow): Tweet {
  return {
    id: row.id,
    text: row.text,
    createdAt: row.created_at,
    likeCount: row.like_count,
    retweetCount: row.retweet_count,
    replyCount: row.reply_count,
    quoteCount: row.quote_count,
    hashtags: JSON.parse(row.hashtags) as string[],
    hasMedia: row.has_media === 1,
    mediaType: (row.media_type as Tweet["mediaType"]) ?? undefined,
    url: row.url,
  };
}
