const { db } = require('./db');

// Timers survive restarts: giveaway endings, reminders, temp bans, temp roles...
const handlers = new Map();
let client = null;

const on = (kind, fn) => handlers.set(kind, fn);

function add(kind, runAt, { guildId = null, targetId = null, data = null } = {}) {
  const r = db
    .prepare('INSERT INTO timers (kind, guild_id, target_id, run_at, data) VALUES (?, ?, ?, ?, ?)')
    .run(kind, guildId, targetId, runAt, data ? JSON.stringify(data) : null);
  return Number(r.lastInsertRowid);
}

const cancel = (id) => db.prepare('DELETE FROM timers WHERE id = ?').run(id);
const cancelWhere = (kind, guildId, targetId) =>
  db.prepare('DELETE FROM timers WHERE kind = ? AND guild_id = ? AND target_id = ?').run(kind, guildId, String(targetId));
const listWhere = (kind, guildId, targetId) =>
  db.prepare('SELECT * FROM timers WHERE kind = ? AND guild_id = ? AND target_id = ? ORDER BY run_at').all(kind, guildId, String(targetId))
    .map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null }));

async function tick() {
  const due = db.prepare('SELECT * FROM timers WHERE run_at <= ? ORDER BY run_at LIMIT 50').all(Date.now());
  for (const row of due) {
    db.prepare('DELETE FROM timers WHERE id = ?').run(row.id);
    const fn = handlers.get(row.kind);
    if (!fn) continue;
    try {
      await fn(client, { ...row, data: row.data ? JSON.parse(row.data) : null });
    } catch (err) {
      console.error(`[timer:${row.kind}]`, err);
    }
  }
}

function start(c) {
  client = c;
  setInterval(() => tick().catch((e) => console.error('[timers]', e)), 5000).unref();
  tick().catch(() => {});
}

module.exports = { on, add, cancel, cancelWhere, listWhere, start };
