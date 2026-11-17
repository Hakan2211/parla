import type { Database } from 'better-sqlite3'

const MIGRATIONS: string[] = [
  // 001 — core schema
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE personas (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    voice_id      TEXT NOT NULL DEFAULT 'af_heart',
    color         TEXT NOT NULL DEFAULT '#7c5cff',
    is_builtin    INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );

  CREATE TABLE chats (
    id                TEXT PRIMARY KEY,
    persona_id        TEXT REFERENCES personas(id) ON DELETE SET NULL,
    title             TEXT,
    summary           TEXT,
    provider          TEXT,
    model             TEXT,
    started_at        INTEGER NOT NULL,
    ended_at          INTEGER,
    extraction_status TEXT NOT NULL DEFAULT 'pending'
  );
  CREATE INDEX idx_chats_started ON chats(started_at DESC);

  CREATE TABLE messages (
    id          TEXT PRIMARY KEY,
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content     TEXT NOT NULL,
    interrupted INTEGER NOT NULL DEFAULT 0,
    metrics     TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX idx_messages_chat ON messages(chat_id, created_at);

  CREATE TABLE memory_entries (
    id             TEXT PRIMARY KEY,
    kind           TEXT NOT NULL CHECK (kind IN ('fact','person','thread','commitment')),
    content        TEXT NOT NULL,
    importance     INTEGER NOT NULL DEFAULT 3,
    status         TEXT NOT NULL DEFAULT 'active',
    source_chat_id TEXT REFERENCES chats(id) ON DELETE SET NULL,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );
  CREATE INDEX idx_memory_status ON memory_entries(status, kind);
  `,
  // 002 — builtin personas (docs Phase 1: persona = pure config)
  `
  INSERT INTO personas (id, name, system_prompt, voice_id, color, is_builtin, created_at, updated_at) VALUES
  ('builtin-friend', 'The Friend',
   'You are Parla, a warm, curious friend. You are having a spoken conversation: keep responses short and natural — one to three sentences unless asked to elaborate. Be genuinely interested in the user''s life, remember what they tell you, and ask follow-up questions that show you care. Never use markdown, lists, or emoji; you are speaking out loud.',
   'af_heart', '#7c5cff', 1, 1700000000000, 1700000000000),
  ('builtin-coach', 'The Coach',
   'You are Parla in coach mode: direct, energizing, goal-focused. You are having a spoken conversation: keep responses short and punchy — one to three sentences. Push the user toward clarity and action, call out vagueness kindly but firmly, and always end tricky topics with a concrete next step. Never use markdown, lists, or emoji; you are speaking out loud.',
   'am_michael', '#f59e0b', 1, 1700000000001, 1700000000001),
  ('builtin-thinker', 'The Thinker',
   'You are Parla in thinker mode: calm, socratic, reflective. You are having a spoken conversation: keep responses short — one to three sentences. Prefer asking one sharp question over giving answers, help the user examine their own reasoning, and be comfortable with silence and uncertainty. Never use markdown, lists, or emoji; you are speaking out loud.',
   'bf_emma', '#10b981', 1, 1700000000002, 1700000000002);
  `,
  // 003 — usage & cost ledger. One row per usage.delta / extraction call.
  // Cost is priced at insert time so later price changes never rewrite
  // history. chat_id is SET NULL (not CASCADE): deleting a conversation
  // must not make past spend disappear from the totals.
  `
  CREATE TABLE usage_events (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id            TEXT REFERENCES chats(id) ON DELETE SET NULL,
    kind               TEXT NOT NULL CHECK (kind IN ('conversation','extraction')),
    provider           TEXT NOT NULL,
    model              TEXT,
    input_tokens       INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens      INTEGER NOT NULL DEFAULT 0,
    tts_chars          INTEGER NOT NULL DEFAULT 0,
    tts_seconds        REAL NOT NULL DEFAULT 0,
    stt_seconds        REAL NOT NULL DEFAULT 0,
    cost_usd           REAL NOT NULL DEFAULT 0,
    cost_source        TEXT NOT NULL,
    created_at         INTEGER NOT NULL
  );
  CREATE INDEX idx_usage_chat ON usage_events(chat_id);
  CREATE INDEX idx_usage_created ON usage_events(created_at);
  `
]

export function migrate(db: Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)')
  const applied = new Set(
    (db.prepare('SELECT version FROM _migrations').all() as { version: number }[]).map(
      (r) => r.version
    )
  )
  MIGRATIONS.forEach((sql, i) => {
    const version = i + 1
    if (applied.has(version)) return
    const run = db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(version)
    })
    run()
  })
}
