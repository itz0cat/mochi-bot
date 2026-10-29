const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { db, kv } = require('./db');
const { UserError } = require('./context');
const scheduler = require('./scheduler');
const { ts, truncate } = require('./util');
const ui = require('./ui');

const COLOR = ui.colors.peach;
const defaults = { channel: null, manager: null, ping: null, partner: null, role: null, invites: 0, bonus: [], blacklist: [], templates: {} };
const cfg = (gid) => kv.obj(gid, 'giveaway', defaults);
const saveCfg = (gid, patch) => kv.set(gid, 'giveaway', { ...cfg(gid), ...patch });

const parse = (row) => (row ? { ...row, req: row.req ? JSON.parse(row.req) : {}, winner_ids: row.winner_ids ? JSON.parse(row.winner_ids) : [] } : null);
const get = (id) => parse(db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id));
const getByMessage = (messageId) => parse(db.prepare('SELECT * FROM giveaways WHERE message_id = ?').get(messageId));
const listFor = (gid, statuses) => db.prepare(`SELECT * FROM giveaways WHERE guild_id = ? AND status IN (${statuses.map(() => '?').join(',')}) ORDER BY id DESC`).all(gid, ...statuses).map(parse);
const latest = (gid, statuses) => listFor(gid, statuses)[0] || null;
const entries = (id) => db.prepare('SELECT * FROM giveaway_entries WHERE giveaway_id = ?').all(id);
const entryCount = (id) => db.prepare('SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?').get(id).n;

/** Find a giveaway from the optional id option, falling back to the newest one in the given states. */
function find(ctx, statuses, idOpt = 'id') {
  const id = ctx.int(idOpt);
  const g = id ? get(id) : latest(ctx.guild.id, statuses);
  if (!g || g.guild_id !== ctx.guild.id) throw new UserError('Giveaway not found', id ? `There is no giveaway with ID ${id} here.` : 'There are no matching giveaways right now.', 'See /giveaway list for IDs.');
  return g;
}

const total = (gid, userId) => {
  const s = db.prepare('SELECT * FROM invite_stats WHERE guild_id = ? AND user_id = ?').get(gid, userId);
  return s ? s.regular + s.bonus - s.leaves - s.fake : 0;
};

function reqLines(req) {
  const out = [];
  if (req.role) out.push(`Needs <@&${req.role}>`);
  if (req.invites) out.push(`At least ${req.invites} invites`);
  if (req.partner) out.push('Must be in the partner server');
  if (req.bonus?.length) out.push(`Bonus entries: ${req.bonus.map((b) => `<@&${b.role}> +${b.entries}`).join(', ')}`);
  return out;
}

function buildEmbed(g, count) {
  const ended = g.status === 'ended';
  const paused = g.status === 'paused';
  const winners = g.winner_ids || [];
  const lines = [
    ended ? null : paused ? '**Paused.** The timer is stopped until a manager resumes it.' : 'Press the button below to enter.',
    ended ? null : '',
    ui.kv([
      [ended ? 'Ended' : 'Ends', paused ? 'when resumed' : `${ts(g.ends_at)} (${ts(g.ends_at, 'f')})`],
      ['Hosted by', `<@${g.host_id}>`],
      ['Winners', ended ? (winners.length ? winners.map((w) => `<@${w}>`).join(', ') : 'Nobody entered') : g.winners],
      ['Entries', count],
      ['Requirements', reqLines(g.req).join('\n') || null],
    ]),
  ].filter((x) => x !== null);
  return ui.card({
    icon: ended ? '🏆' : '🎁', title: ended ? `Giveaway ended: ${truncate(g.prize, 200)}` : truncate(g.prize, 240),
    desc: lines.join('\n'), hint: `Giveaway ${g.id}`, color: ended ? ui.colors.matcha : paused ? ui.colors.butter : COLOR,
  });
}

const enterRow = (disabled = false) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('giveaway:enter').setLabel('Enter').setEmoji('🎉').setStyle(ButtonStyle.Success).setDisabled(disabled),
  new ButtonBuilder().setCustomId('giveaway:entrants').setLabel('Entrants').setEmoji('👥').setStyle(ButtonStyle.Secondary)
);

async function refreshMessage(client, g) {
  const ch = client.channels.cache.get(g.channel_id) || (await client.channels.fetch(g.channel_id).catch(() => null));
  const msg = ch && g.message_id ? await ch.messages.fetch(g.message_id).catch(() => null) : null;
  if (msg) await msg.edit({ embeds: [buildEmbed(g, entryCount(g.id))], components: g.status === 'ended' ? [] : [enterRow(g.status === 'paused')] }).catch(() => {});
  return { ch, msg };
}

async function start(client, guild, { channel, host, prize, winners, durationMs, req }) {
  const c = cfg(guild.id);
  const fullReq = {
    role: req.role ?? c.role ?? null,
    invites: req.invites ?? c.invites ?? 0,
    partner: req.partner ?? c.partner ?? null,
    bonus: c.bonus || [],
    kind: req.kind || 'normal',
  };
  const endsAt = Date.now() + durationMs;
  const r = db.prepare('INSERT INTO giveaways (guild_id, channel_id, prize, winners, host_id, ends_at, status, req, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(guild.id, channel.id, prize, winners, host.id, endsAt, 'running', JSON.stringify(fullReq), Date.now());
  const id = Number(r.lastInsertRowid);
  let g = get(id);
  const ping = c.ping === 'everyone' ? '@everyone' : c.ping === 'here' ? '@here' : c.ping ? `<@&${c.ping}>` : '';
  const msg = await channel.send({
    content: ping || undefined,
    allowedMentions: c.ping === 'everyone' || c.ping === 'here' ? { parse: ['everyone'] } : c.ping ? { roles: [c.ping] } : { parse: [] },
    embeds: [buildEmbed(g, 0)], components: [enterRow()],
  });
  db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?').run(msg.id, id);
  scheduler.add('giveaway_end', endsAt, { guildId: guild.id, targetId: String(id) });
  g = get(id);
  return { g, msg };
}

/** Weighted random pick of winners who are still in the server. */
async function pickWinners(guild, id, count, exclude = []) {
  const pool = entries(id).filter((e) => !exclude.includes(e.user_id));
  const winners = [];
  while (winners.length < count && pool.length) {
    const sum = pool.reduce((n, e) => n + e.tickets, 0);
    let roll = Math.random() * sum;
    let idx = 0;
    for (; idx < pool.length; idx++) { roll -= pool[idx].tickets; if (roll <= 0) break; }
    const [pick] = pool.splice(Math.min(idx, pool.length - 1), 1);
    const member = await guild.members.fetch(pick.user_id).catch(() => null);
    if (member) winners.push(pick.user_id);
  }
  return winners;
}

async function announce(client, g, winners, { reroll = false } = {}) {
  const ch = client.channels.cache.get(g.channel_id) || (await client.channels.fetch(g.channel_id).catch(() => null));
  if (!ch) return;
  const reply = g.message_id ? { messageReference: g.message_id, failIfNotExists: false } : undefined;
  if (winners.length) {
    await ch.send({
      content: `🎉 ${reroll ? 'New winner' : 'Congratulations'} ${winners.map((w) => `<@${w}>`).join(', ')}! You won **${g.prize}**.`,
      allowedMentions: { users: winners }, reply,
    }).catch(() => {});
    for (const w of winners) {
      const u = await client.users.fetch(w).catch(() => null);
      await u?.send({ embeds: [ui.card({ icon: '🏆', title: 'You won!', desc: `You won **${g.prize}** in **${ch.guild?.name ?? 'a server'}**.\n${g.message_id ? `https://discord.com/channels/${g.guild_id}/${g.channel_id}/${g.message_id}` : ''}`, color: COLOR })] }).catch(() => {});
    }
  } else {
    await ch.send({ embeds: [ui.warn('No winner this time', `Nobody entered the **${g.prize}** giveaway.`)], reply }).catch(() => {});
  }
}

async function end(client, id) {
  const g = get(id);
  if (!g || g.status === 'ended') return null;
  const guild = client.guilds.cache.get(g.guild_id);
  if (!guild) return null;
  scheduler.cancelWhere('giveaway_end', g.guild_id, String(g.id));
  const winners = await pickWinners(guild, g.id, g.winners);
  db.prepare("UPDATE giveaways SET status = 'ended', winner_ids = ? WHERE id = ?").run(JSON.stringify(winners), g.id);
  const done = get(id);
  await refreshMessage(client, done);
  await announce(client, done, winners);
  return done;
}

async function reroll(client, g, count) {
  const guild = client.guilds.cache.get(g.guild_id);
  const winners = await pickWinners(guild, g.id, count || g.winners, g.winner_ids);
  db.prepare('UPDATE giveaways SET winner_ids = ? WHERE id = ?').run(JSON.stringify([...g.winner_ids, ...winners]), g.id);
  await announce(client, { ...g, winner_ids: winners }, winners, { reroll: true });
  return winners;
}

scheduler.on('giveaway_end', (client, row) => end(client, Number(row.target_id)));

/** Throws a UserError describing why this member can't enter. Returns how many tickets they get. */
async function eligibility(client, guild, member, g) {
  const c = cfg(guild.id);
  if (c.blacklist.includes(member.id)) throw new UserError('You cannot enter', 'You have been blocked from giveaways in this server.');
  if (g.req.role && !member.roles.cache.has(g.req.role)) throw new UserError('Role needed', `You need <@&${g.req.role}> to enter this giveaway.`);
  if (g.req.invites && total(guild.id, member.id) < g.req.invites) throw new UserError('Not enough invites', `You need ${g.req.invites} invites to enter. You have ${Math.max(0, total(guild.id, member.id))}.`, 'Check yours with /invites view.');
  if (g.req.partner) {
    const partner = client.guilds.cache.get(g.req.partner);
    if (partner && !(await partner.members.fetch(member.id).catch(() => null))) throw new UserError('Join the partner server first', `You need to be a member of **${partner.name}** to enter.`);
  }
  let tickets = 1;
  for (const b of g.req.bonus || []) if (member.roles.cache.has(b.role)) tickets += Number(b.entries) || 0;
  return tickets;
}

module.exports = {
  cfg, saveCfg, get, getByMessage, listFor, latest, entries, entryCount, find, total, buildEmbed, enterRow, refreshMessage,
  start, end, reroll, pickWinners, eligibility, COLOR, defaults,
};
