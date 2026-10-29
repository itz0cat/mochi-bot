const { PermissionFlagsBits: P } = require('discord.js');
const { db, kv } = require('./db');
const { ts } = require('./util');
const ui = require('./ui');

const COLOR = ui.colors.sky;
const defaults = { channel: null, log: true, minAge: 0, blacklist: [], ranks: [] };
const cfg = (gid) => kv.obj(gid, 'invites', defaults);
const saveCfg = (gid, patch) => kv.set(gid, 'invites', { ...cfg(gid), ...patch });

const cache = new Map(); // guildId -> Map(code -> uses)  (plus "vanity")

const statsOf = (gid, uid) => {
  const s = db.prepare('SELECT * FROM invite_stats WHERE guild_id = ? AND user_id = ?').get(gid, uid) || { regular: 0, fake: 0, leaves: 0, bonus: 0 };
  return { regular: s.regular, fake: s.fake, leaves: s.leaves, bonus: s.bonus, total: s.regular + s.bonus - s.leaves - s.fake };
};
const bump = (gid, uid, field, n = 1) => {
  db.prepare(`INSERT INTO invite_stats (guild_id, user_id, ${field}) VALUES (?, ?, ?)
              ON CONFLICT (guild_id, user_id) DO UPDATE SET ${field} = MAX(0, ${field} + ?)`).run(gid, uid, Math.max(0, n), n);
};

async function snapshot(guild) {
  if (!guild.members.me?.permissions.has(P.ManageGuild)) return null;
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return null;
  const map = new Map(invites.map((i) => [i.code, i.uses ?? 0]));
  if (guild.vanityURLCode) {
    const v = await guild.fetchVanityData().catch(() => null);
    if (v) map.set('__vanity', v.uses);
  }
  cache.set(guild.id, map);
  return map;
}

async function applyRanks(guild, inviterId) {
  const ranks = cfg(guild.id).ranks;
  if (!ranks.length) return;
  const { total } = statsOf(guild.id, inviterId);
  const member = await guild.members.fetch(inviterId).catch(() => null);
  if (!member) return;
  for (const r of ranks) {
    if (total >= r.count && !member.roles.cache.has(r.role) && guild.roles.cache.has(r.role)) {
      await member.roles.add(r.role, `Reached ${r.count} invites`).catch(() => {});
    }
  }
}

async function postLog(guild, embed) {
  const c = cfg(guild.id);
  if (!c.log || !c.channel) return;
  const ch = guild.channels.cache.get(c.channel);
  if (ch?.isTextBased()) await ch.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

async function onJoin(member) {
  const guild = member.guild;
  const before = cache.get(guild.id) || new Map();
  const after = await snapshot(guild);
  let code = null;
  let inviterId = null;
  let usedVanity = false;

  if (after) {
    for (const [c, uses] of after) {
      if (c === '__vanity') { if (uses > (before.get('__vanity') ?? uses)) usedVanity = true; continue; }
      if (uses > (before.get(c) ?? 0)) { code = c; break; }
    }
    if (!code && !usedVanity) {
      for (const c of before.keys()) if (c !== '__vanity' && !after.has(c)) { code = c; break; } // one-use invite that vanished
    }
    if (code) {
      const invites = await guild.invites.fetch().catch(() => null);
      inviterId = invites?.get(code)?.inviterId ?? null;
      if (!inviterId) { const prev = db.prepare('SELECT inviter_id FROM invite_members WHERE guild_id = ? AND code = ? AND inviter_id IS NOT NULL LIMIT 1').get(guild.id, code); inviterId = prev?.inviter_id ?? null; }
    }
  }

  const c = cfg(guild.id);
  const prior = db.prepare('SELECT * FROM invite_members WHERE guild_id = ? AND member_id = ?').get(guild.id, member.id);
  const young = c.minAge > 0 && Date.now() - member.user.createdTimestamp < c.minAge * 86400000;
  const blocked = inviterId && c.blacklist.includes(inviterId);
  const rejoin = Boolean(prior && prior.left && prior.inviter_id === inviterId);
  const fake = young || rejoin;

  db.prepare(`INSERT INTO invite_members (guild_id, member_id, inviter_id, code, joined_at, fake, left) VALUES (?, ?, ?, ?, ?, ?, 0)
              ON CONFLICT (guild_id, member_id) DO UPDATE SET inviter_id = excluded.inviter_id, code = excluded.code, joined_at = excluded.joined_at, fake = excluded.fake, left = 0`)
    .run(guild.id, member.id, inviterId, code || (usedVanity ? 'vanity' : null), Date.now(), fake ? 1 : 0);

  if (inviterId && !blocked) {
    if (rejoin) { /* counted before; the leave already subtracted it, so add it back */ bump(guild.id, inviterId, 'leaves', -1); }
    else bump(guild.id, inviterId, fake ? 'fake' : 'regular');
    if (!fake || rejoin) await applyRanks(guild, inviterId);
  }

  const who = inviterId ? `<@${inviterId}>${statsOf(guild.id, inviterId).total >= 0 ? ` (${statsOf(guild.id, inviterId).total} invites)` : ''}` : usedVanity ? 'the vanity link' : 'someone I could not find';
  await postLog(guild, ui.card({
    icon: '📨', title: `${member.user.username} joined`, color: COLOR,
    desc: `Invited by ${who}.${young ? '\n-# Counted as fake: the account is very new.' : ''}${rejoin ? '\n-# Rejoined, so it was not counted twice.' : ''}`,
    thumb: member.user.displayAvatarURL(),
  }));
  return { inviterId, code, fake };
}

async function onLeave(member) {
  const guild = member.guild;
  const row = db.prepare('SELECT * FROM invite_members WHERE guild_id = ? AND member_id = ?').get(guild.id, member.id);
  if (!row || row.left) return;
  db.prepare('UPDATE invite_members SET left = 1 WHERE guild_id = ? AND member_id = ?').run(guild.id, member.id);
  const c = cfg(guild.id);
  if (row.inviter_id && !row.fake && !c.blacklist.includes(row.inviter_id)) bump(guild.id, row.inviter_id, 'leaves');
  await postLog(guild, ui.card({
    icon: '👋', title: `${member.user.username} left`, color: ui.colors.butter,
    desc: row.inviter_id ? `They were invited by <@${row.inviter_id}>, who now has ${statsOf(guild.id, row.inviter_id).total} invites.` : 'I do not know who invited them.',
    hint: `Joined ${ts(row.joined_at)}`,
  }));
}

module.exports = { cfg, saveCfg, statsOf, bump, snapshot, onJoin, onLeave, applyRanks, cache, COLOR, defaults };
