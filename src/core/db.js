const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(dir, { recursive: true });

const db = new Database(path.join(dir, 'mochi.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  guild_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT,
  PRIMARY KEY (guild_id, key)
);
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL, num INTEGER NOT NULL, user_id TEXT NOT NULL, mod_id TEXT NOT NULL,
  type TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL, expires_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (guild_id, num)
);
CREATE INDEX IF NOT EXISTS idx_cases_user ON cases (guild_id, user_id);
CREATE TABLE IF NOT EXISTS timers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL, guild_id TEXT, target_id TEXT, run_at INTEGER NOT NULL, data TEXT
);
CREATE INDEX IF NOT EXISTS idx_timers_run ON timers (run_at);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL, num INTEGER NOT NULL, channel_id TEXT NOT NULL, opener_id TEXT NOT NULL,
  claimed_by TEXT, reason TEXT, status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL, closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets (channel_id);
CREATE TABLE IF NOT EXISTS giveaways (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT, prize TEXT NOT NULL,
  winners INTEGER NOT NULL DEFAULT 1, host_id TEXT NOT NULL, ends_at INTEGER, remaining INTEGER,
  status TEXT NOT NULL DEFAULT 'running', req TEXT, winner_ids TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_giveaways_msg ON giveaways (message_id);
CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id INTEGER NOT NULL, user_id TEXT NOT NULL, tickets INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (giveaway_id, user_id)
);
CREATE TABLE IF NOT EXISTS invite_stats (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  regular INTEGER NOT NULL DEFAULT 0, fake INTEGER NOT NULL DEFAULT 0,
  leaves INTEGER NOT NULL DEFAULT 0, bonus INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS invite_members (
  guild_id TEXT NOT NULL, member_id TEXT NOT NULL, inviter_id TEXT, code TEXT,
  joined_at INTEGER NOT NULL, fake INTEGER NOT NULL DEFAULT 0, left INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_invite_members_inviter ON invite_members (guild_id, inviter_id);
CREATE TABLE IF NOT EXISTS highlights (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, word TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id, word)
);
CREATE TABLE IF NOT EXISTS afk (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT, since INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS sticky_roles (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id, role_id)
);
CREATE TABLE IF NOT EXISTS reaction_roles (
  guild_id TEXT NOT NULL, message_id TEXT NOT NULL, emoji TEXT NOT NULL, role_id TEXT NOT NULL,
  PRIMARY KEY (message_id, emoji)
);
CREATE TABLE IF NOT EXISTS quarantine (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, roles TEXT,
  PRIMARY KEY (guild_id, user_id)
);
`);

// ---- Per-server settings: any JSON value under a string key ----
const _get = db.prepare('SELECT value FROM settings WHERE guild_id = ? AND key = ?');
const _set = db.prepare(
  `INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?)
   ON CONFLICT (guild_id, key) DO UPDATE SET value = excluded.value`
);
const _del = db.prepare('DELETE FROM settings WHERE guild_id = ? AND key = ?');
const _wipe = db.prepare('DELETE FROM settings WHERE guild_id = ?');

const kv = {
  get(guildId, key, def = null) {
    const row = _get.get(guildId, key);
    if (!row) return def;
    try { return JSON.parse(row.value); } catch { return def; }
  },
  set(guildId, key, value) { _set.run(guildId, key, JSON.stringify(value)); return value; },
  del(guildId, key) { _del.run(guildId, key); },
  wipe(guildId) { _wipe.run(guildId); },
  /** Read an object setting merged over defaults (so new options always have a value). */
  obj(guildId, key, defaults) {
    const stored = kv.get(guildId, key, {});
    const out = {};
    for (const [k, v] of Object.entries(defaults)) {
      out[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...v, ...(stored[k] || {}) } : stored[k] ?? v;
    }
    for (const k of Object.keys(stored)) if (!(k in out)) out[k] = stored[k];
    return out;
  },
  /** Read -> change -> write in one go. fn receives the current value and returns the new one. */
  update(guildId, key, defaults, fn) {
    const isObj = defaults && typeof defaults === 'object' && !Array.isArray(defaults);
    const cur = isObj ? kv.obj(guildId, key, defaults) : kv.get(guildId, key, defaults);
    const next = fn(cur) ?? cur;
    kv.set(guildId, key, next);
    return next;
  },
};

module.exports = { db, kv };
