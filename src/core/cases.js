const { db, kv } = require('./db');
const ui = require('./ui');
const { ts } = require('./util');

const TYPE_LABEL = {
  ban: 'Ban', unban: 'Unban', softban: 'Softban', tempban: 'Temporary ban', kick: 'Kick', mute: 'Mute', unmute: 'Unmute',
  timeout: 'Timeout', untimeout: 'Timeout removed', warn: 'Warning', note: 'Note', quarantine: 'Quarantine', automod: 'Automod',
};

const addCase = db.transaction((guildId, { userId, modId, type, reason = null, expiresAt = null }) => {
  const num = db.prepare('SELECT COALESCE(MAX(num), 0) + 1 AS n FROM cases WHERE guild_id = ?').get(guildId).n;
  db.prepare('INSERT INTO cases (guild_id, num, user_id, mod_id, type, reason, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(guildId, num, userId, modId, type, reason, Date.now(), expiresAt);
  return db.prepare('SELECT * FROM cases WHERE guild_id = ? AND num = ?').get(guildId, num);
});

const getCase = (guildId, num) => db.prepare('SELECT * FROM cases WHERE guild_id = ? AND num = ?').get(guildId, num) || null;
const setReason = (guildId, num, reason) => db.prepare('UPDATE cases SET reason = ? WHERE guild_id = ? AND num = ?').run(reason, guildId, num);
const deactivate = (guildId, num) => db.prepare('UPDATE cases SET active = 0 WHERE guild_id = ? AND num = ?').run(guildId, num);

function userCases(guildId, userId, { type = null, activeOnly = false } = {}) {
  let sql = 'SELECT * FROM cases WHERE guild_id = ? AND user_id = ?';
  const args = [guildId, userId];
  if (type) { sql += ' AND type = ?'; args.push(type); }
  if (activeOnly) sql += ' AND active = 1';
  return db.prepare(`${sql} ORDER BY num DESC`).all(...args);
}

const modCases = (guildId, modId) => db.prepare('SELECT * FROM cases WHERE guild_id = ? AND mod_id = ? ORDER BY num DESC').all(guildId, modId);
const activeTimed = (guildId) => db.prepare('SELECT * FROM cases WHERE guild_id = ? AND active = 1 AND expires_at IS NOT NULL AND expires_at > ? ORDER BY expires_at').all(guildId, Date.now());

function caseEmbed(c) {
  return ui.card({
    icon: '🛡️',
    title: `Case ${c.num}: ${TYPE_LABEL[c.type] || c.type}`,
    desc: ui.kv([
      ['Member', `<@${c.user_id}>`],
      ['Moderator', `<@${c.mod_id}>`],
      ['Reason', c.reason || 'No reason given'],
      ['When', ts(c.created_at)],
      ['Ends', c.expires_at ? ts(c.expires_at) : null],
    ]),
    color: ui.colors.lavender,
  });
}

/** Record an action: saves the case and posts it to the mod log channel (if one is set). */
async function record(guild, data) {
  const c = addCase(guild.id, data);
  const channelId = kv.get(guild.id, 'modlog', null);
  if (channelId) {
    const ch = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
    if (ch?.isTextBased()) await ch.send({ embeds: [caseEmbed(c)] }).catch(() => {});
  }
  return c;
}

module.exports = { TYPE_LABEL, addCase, getCase, setReason, deactivate, userCases, modCases, activeTimed, caseEmbed, record };
