const { PermissionFlagsBits: P, AuditLogEvent } = require('discord.js');
const { kv } = require('./db');
const { can } = require('./perms');
const { setLockdown } = require('./lock');
const cases = require('./cases');
const invites = require('./invites');
const ui = require('./ui');

const COLOR = ui.colors.lavender;
const defaults = {
  filters: {
    spam: { on: false, limit: 5, window: 5 },
    flood: { on: false, repeats: 3 },
    caps: { on: false, pct: 70, min: 10 },
    invite: { on: false },
    link: { on: false },
    massmention: { on: false, limit: 5 },
    zalgo: { on: false },
    ghostping: { on: false },
    nsfw: { on: false },
    alt: { on: false, days: 3 },
    raid: { on: false, joins: 5, window: 10 },
    words: { on: false },
  },
  words: [],
  action: 'delete',
  timeoutMins: 10,
  whitelist: { channels: [], roles: [], invites: [] },
  raidmode: false,
  panic: false,
  antinuke: { on: false, limit: 3, window: 30, trusted: [] },
  verify: { role: null },
};
const cfg = (gid) => kv.obj(gid, 'automod', defaults);
const save = (gid, next) => kv.set(gid, 'automod', next);
const update = (gid, fn) => { const c = cfg(gid); fn(c); return save(gid, c); };

const spamLog = new Map();   // guild:user -> [timestamps]
const floodLog = new Map();  // guild:user -> [{text, t}]
const joinLog = new Map();   // guild -> [timestamps]
setInterval(() => { const cut = Date.now() - 120_000; for (const [k, v] of spamLog) { const keep = v.filter((t) => t > cut); keep.length ? spamLog.set(k, keep) : spamLog.delete(k); } for (const [k, v] of floodLog) { const keep = v.filter((e) => e.t > cut); keep.length ? floodLog.set(k, keep) : floodLog.delete(k); } }, 60_000).unref();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const INVITE_RE = /(?:discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg)\/([\w-]+)/i;

function detect(message, c) {
  const f = c.filters;
  const text = message.content || '';
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();

  if (f.spam.on) {
    const list = (spamLog.get(key) || []).filter((t) => now - t < f.spam.window * 1000);
    list.push(now); spamLog.set(key, list);
    if (list.length > f.spam.limit) return 'Sending messages too fast';
  }
  if (f.flood.on && text.length > 2) {
    const list = (floodLog.get(key) || []).filter((e) => now - e.t < 30_000);
    list.push({ text: text.toLowerCase(), t: now }); floodLog.set(key, list);
    if (list.filter((e) => e.text === text.toLowerCase()).length >= f.flood.repeats) return 'Repeating the same message';
  }
  if (f.invite.on) {
    const m = text.match(INVITE_RE);
    if (m) {
      const code = m[1].toLowerCase();
      const own = invites.cache.get(message.guild.id);
      if (!c.whitelist.invites.includes(code) && !(own && own.has(m[1])) && message.guild.vanityURLCode?.toLowerCase() !== code) return 'Posting invite links';
    }
  }
  if (f.link.on && /https?:\/\/\S+/i.test(text) && !INVITE_RE.test(text)) return 'Posting links';
  if (f.massmention.on) {
    const n = message.mentions.users.size + message.mentions.roles.size;
    if (n >= f.massmention.limit) return 'Mentioning too many people';
    if (message.mentions.everyone) return 'Mentioning @everyone';
  }
  if (f.caps.on) {
    const letters = text.replace(/[^a-zA-Z]/g, '');
    if (letters.length >= f.caps.min && (letters.replace(/[^A-Z]/g, '').length / letters.length) * 100 >= f.caps.pct) return 'Too many capital letters';
  }
  if (f.zalgo.on && /[\u0300-\u036f\u0489]{3,}/.test(text)) return 'Using zalgo text';
  if (f.words.on && c.words.length) {
    const lower = text.toLowerCase();
    if (c.words.some((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}($|[^\\p{L}\\p{N}])`, 'iu').test(lower))) return 'Using a blocked word';
  }
  return null;
}

async function punish(guild, member, reason, c, { channel } = {}) {
  const user = member.user;
  const me = guild.members.me;
  const action = c.action;
  let did = 'Message removed';
  try {
    if (action === 'timeout' && member.moderatable) { await member.timeout(c.timeoutMins * 60_000, `Automod: ${reason}`); did = `Timed out for ${c.timeoutMins}m`; }
    else if (action === 'kick' && member.kickable) { await member.kick(`Automod: ${reason}`); did = 'Kicked'; }
    else if (action === 'ban' && member.bannable) { await guild.members.ban(user.id, { reason: `Automod: ${reason}` }); did = 'Banned'; }
    else if (action === 'warn') did = 'Warning recorded';
  } catch { did = 'Message removed'; }
  if (action !== 'delete') await cases.record(guild, { userId: user.id, modId: me.id, type: action === 'warn' ? 'warn' : 'automod', reason: `Automod: ${reason}. ${did}.` });
  return did;
}

/** Called for every guild message. Returns true when it acted on the message. */
async function handleMessage(message) {
  const guild = message.guild;
  const c = cfg(guild.id);
  if (!Object.values(c.filters).some((f) => f.on) && !c.panic) return false;
  const member = message.member;
  if (!member || member.user.bot) return false;
  if (can(member, ['ManageMessages']) || member.roles.cache.some((r) => c.whitelist.roles.includes(r.id)) || c.whitelist.channels.includes(message.channelId)) return false;

  let reason = detect(message, c);
  if (!reason && c.panic && Date.now() - (member.joinedTimestamp || 0) < 24 * 3600_000) reason = 'Server is in panic mode';
  if (!reason) return false;

  await message.delete().catch(() => {});
  const did = await punish(guild, member, reason, c);
  const note = await message.channel.send({ embeds: [ui.card({ icon: '🛡️', title: reason, desc: `${member}, that is not allowed here. ${did}.`, color: COLOR })], allowedMentions: { users: [member.id] } }).catch(() => null);
  if (note) setTimeout(() => note.delete().catch(() => {}), 6000);
  return true;
}

/** Called on member join: account age check, raid detection and raid/panic mode. */
async function handleJoin(member) {
  const guild = member.guild;
  const c = cfg(guild.id);
  const kickNew = async (why, text) => {
    await member.send({ embeds: [ui.card({ icon: '🛡️', title: `You could not join ${guild.name}`, desc: text, color: ui.colors.cherry })] }).catch(() => {});
    if (member.kickable) await member.kick(why).catch(() => {});
    await cases.record(guild, { userId: member.id, modId: guild.members.me.id, type: 'automod', reason: `${why}. Kicked.` });
    return true;
  };

  if (c.panic || c.raidmode) return kickNew('Raid mode is on', 'The server is locked to new members right now. Please try again later.');
  if (c.filters.alt.on && Date.now() - member.user.createdTimestamp < c.filters.alt.days * 86400000) {
    return kickNew(`Account younger than ${c.filters.alt.days} days`, `This server only accepts accounts older than ${c.filters.alt.days} days.`);
  }
  if (c.filters.raid.on) {
    const now = Date.now();
    const list = (joinLog.get(guild.id) || []).filter((t) => now - t < c.filters.raid.window * 1000);
    list.push(now); joinLog.set(guild.id, list);
    if (list.length > c.filters.raid.joins) {
      update(guild.id, (x) => { x.raidmode = true; });
      await cases.record(guild, { userId: member.id, modId: guild.members.me.id, type: 'automod', reason: `Raid detected: ${list.length} joins in ${c.filters.raid.window}s. Raid mode turned on.` });
      return kickNew('Raid detected', 'Too many people joined at once, so the server is protecting itself. Try again in a little while.');
    }
  }
  return false;
}

async function setPanic(guild, on, who) {
  update(guild.id, (c) => { c.panic = on; c.raidmode = on; });
  return setLockdown(guild, on, `Panic mode ${on ? 'on' : 'off'} by ${who}`);
}

// ---- Anti-nuke: punish people who delete lots of channels/roles or ban/kick lots of members ----
const actions = new Map(); // guild:executor -> [timestamps]
async function nukeCheck(guild, auditType) {
  const c = cfg(guild.id);
  if (!c.antinuke.on || !guild.members.me.permissions.has(P.ViewAuditLog)) return;
  const logs = await guild.fetchAuditLogs({ type: auditType, limit: 1 }).catch(() => null);
  const entry = logs?.entries.first();
  if (!entry || Date.now() - entry.createdTimestamp > 8000 || !entry.executor) return;
  const id = entry.executor.id;
  if (id === guild.ownerId || id === guild.client.user.id || c.antinuke.trusted.includes(id)) return;
  const key = `${guild.id}:${id}`;
  const list = (actions.get(key) || []).filter((t) => Date.now() - t < c.antinuke.window * 1000);
  list.push(Date.now()); actions.set(key, list);
  if (list.length < c.antinuke.limit) return;
  actions.delete(key);
  const member = await guild.members.fetch(id).catch(() => null);
  let result = 'I could not stop them (their role is above mine).';
  if (member?.bannable) { await guild.members.ban(id, { reason: 'Anti-nuke: too many destructive actions' }).catch(() => {}); result = 'They were banned.'; }
  else if (member?.manageable) { await member.roles.set([], 'Anti-nuke').catch(() => {}); result = 'Their roles were removed.'; }
  await cases.record(guild, { userId: id, modId: guild.client.user.id, type: 'automod', reason: `Anti-nuke: ${list.length} destructive actions in ${c.antinuke.window}s. ${result}` });
}
const NUKE_EVENTS = { channelDelete: AuditLogEvent.ChannelDelete, roleDelete: AuditLogEvent.RoleDelete, ban: AuditLogEvent.MemberBanAdd, kick: AuditLogEvent.MemberKick };

module.exports = { cfg, save, update, defaults, handleMessage, handleJoin, setPanic, nukeCheck, NUKE_EVENTS, detect, COLOR };
