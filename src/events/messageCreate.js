const { Events, PermissionFlagsBits: P } = require('discord.js');
const registry = require('../core/registry');
const { Ctx, UserError } = require('../core/context');
const { runCommand } = require('../core/dispatch');
const { lex, parseArgs } = require('../core/prefix');
const { defaultPrefix } = require('../config');
const { db, kv } = require('../core/db');
const { fillTemplate, truncate, fmtDuration, ts } = require('../core/util');
const automod = require('../core/automod');
const ui = require('../core/ui');

const cooldown = new Map();      // key -> last time (autoresponders, afk notices, highlights)
const stickyTimers = new Map();  // channelId -> timeout
const recently = (key, ms) => { const now = Date.now(); if (now - (cooldown.get(key) || 0) < ms) return true; cooldown.set(key, now); return false; };
setInterval(() => { const cut = Date.now() - 600_000; for (const [k, t] of cooldown) if (t < cut) cooldown.delete(k); }, 300_000).unref();

async function afk(message) {
  const { guild, author } = message;
  const mine = db.prepare('SELECT * FROM afk WHERE guild_id = ? AND user_id = ?').get(guild.id, author.id);
  if (mine && Date.now() - mine.since > 5000) {
    db.prepare('DELETE FROM afk WHERE guild_id = ? AND user_id = ?').run(guild.id, author.id);
    const note = await message.channel.send({ embeds: [ui.card({ icon: '☀️', title: `Welcome back, ${author.username}`, desc: `You were away for **${fmtDuration(Date.now() - mine.since)}**.`, color: ui.colors.butter })] }).catch(() => null);
    if (note) setTimeout(() => note.delete().catch(() => {}), 8000);
  }
  for (const u of message.mentions.users.values()) {
    if (u.id === author.id || u.bot) continue;
    const row = db.prepare('SELECT * FROM afk WHERE guild_id = ? AND user_id = ?').get(guild.id, u.id);
    if (row && !recently(`afk:${message.channelId}:${u.id}`, 30_000)) {
      await message.reply({ embeds: [ui.card({ icon: '🌙', title: `${u.username} is AFK`, desc: `**${truncate(row.reason, 120)}**\n-# Since ${ts(row.since)}`, color: ui.colors.butter })], allowedMentions: { repliedUser: false } }).catch(() => {});
    }
  }
}

async function highlights(message) {
  const rows = db.prepare('SELECT user_id, word FROM highlights WHERE guild_id = ?').all(message.guild.id);
  if (!rows.length || !message.content) return;
  const text = message.content.toLowerCase();
  const blocks = kv.get(message.guild.id, 'hlblocks', {});
  const byUser = new Map();
  for (const r of rows) {
    if (r.user_id === message.author.id) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${r.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu');
    if (re.test(text)) byUser.set(r.user_id, r.word);
  }
  let sent = 0;
  for (const [userId, word] of byUser) {
    if (sent >= 10 || recently(`hl:${userId}:${message.channelId}`, 300_000)) continue;
    if ((blocks[userId] || []).includes(message.channelId)) continue;
    const member = message.guild.members.cache.get(userId) || (await message.guild.members.fetch(userId).catch(() => null));
    if (!member || !message.channel.permissionsFor(member)?.has(P.ViewChannel)) continue;
    await member.send({ embeds: [ui.card({ icon: '✨', title: `You were highlighted in ${message.guild.name}`, desc: `**${message.author.username}** said "${word}" in <#${message.channelId}>:\n>>> ${truncate(message.content, 500)}`, hint: message.url, color: ui.colors.peach })] }).then(() => { sent++; }).catch(() => {});
  }
}

async function autoresponders(message) {
  const list = kv.get(message.guild.id, 'autoresponders', []);
  if (!list.length) return;
  const text = message.content.trim().toLowerCase();
  const hit = list.find((a) => (a.mode === 'exact' ? text === a.trigger : text.includes(a.trigger)));
  if (!hit || recently(`ar:${message.guild.id}:${hit.trigger}`, 5000)) return;
  await message.channel.send({ content: fillTemplate(hit.response, { user: message.author, guild: message.guild }), allowedMentions: { users: [message.author.id] }, reply: { messageReference: message.id, failIfNotExists: false } }).catch(() => {});
}

function sticky(message) {
  const all = kv.get(message.guild.id, 'stickies', {});
  const cur = all[message.channelId];
  if (!cur || message.author.id === message.client.user.id) return;
  clearTimeout(stickyTimers.get(message.channelId));
  stickyTimers.set(message.channelId, setTimeout(async () => {
    const fresh = kv.get(message.guild.id, 'stickies', {});
    if (!fresh[message.channelId]) return;
    if (fresh[message.channelId].msgId) await message.channel.messages.delete(fresh[message.channelId].msgId).catch(() => {});
    const msg = await message.channel.send({ embeds: [ui.card({ icon: '📌', title: 'Sticky', desc: fresh[message.channelId].text, color: ui.colors.butter })] }).catch(() => null);
    if (msg) { fresh[message.channelId].msgId = msg.id; kv.set(message.guild.id, 'stickies', fresh); }
  }, 4000));
}

async function prefixCommand(client, message) {
  const prefix = message.guild ? kv.get(message.guild.id, 'prefix', defaultPrefix) : defaultPrefix;
  const content = message.content;
  if (new RegExp(`^<@!?${client.user.id}>$`).test(content.trim())) {
    return message.reply({ embeds: [ui.card({ icon: '🌸', title: `Hi ${message.author.username}!`, desc: `My prefix here is \`${prefix}\`. Try \`${prefix}help\` or type \`/\` to see my slash commands.`, color: ui.colors.strawberry })], allowedMentions: { repliedUser: false } }).catch(() => {});
  }
  if (!content.startsWith(prefix)) return;
  const raw = content.slice(prefix.length).trim();
  if (!raw) return;
  const tokens = lex(raw);
  const words = tokens.map((t) => t.text.toLowerCase());
  const found = registry.resolveTokens(words);

  if (!found) {
    const custom = message.guild && kv.get(message.guild.id, 'customcmds', {})[words[0]];
    if (custom) await message.channel.send({ content: fillTemplate(custom, { user: message.author, guild: message.guild }), allowedMentions: { users: [message.author.id] } }).catch(() => {});
    return;
  }

  const ctx = new Ctx(client, { message, args: {}, path: raw });
  ctx.prefixUsed = prefix;
  if (found.needSub) {
    const list = found.def.subs.map((s) => `\`${prefix}${s.usage.slice(1)}\``).join('\n').slice(0, 3800);
    return ctx.reply(ui.info(`${found.def.name}`, `Pick one:\n${list}`, `Or use /${found.def.name} for the slash version.`));
  }
  const cmd = found.sub || found.def;
  const label = `${prefix}${(found.sub ? found.sub.usage : found.def.usage).slice(1)}`;
  try {
    ctx.args = await parseArgs({ client, guild: message.guild, raw, opts: cmd.options || [], tokens: tokens.slice(found.used), label });
  } catch (err) {
    if (err instanceof UserError) return ctx.reply(ui.err(err.title, err.desc, err.hint));
    throw err;
  }
  return runCommand(ctx, found.def, found.sub);
}

module.exports = {
  name: Events.MessageCreate,
  async run(client, message) {
    if (message.author.bot || message.system || message.webhookId) return;
    if (message.partial) await message.fetch().catch(() => {});
    if (message.guild) {
      if (await automod.handleMessage(message)) return;
      await afk(message);
      await highlights(message);
      await autoresponders(message);
      sticky(message);
    }
    await prefixCommand(client, message);
  },
};
