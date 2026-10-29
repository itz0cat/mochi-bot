const {
  ChannelType, PermissionFlagsBits: P, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder,
} = require('discord.js');
const { db, kv } = require('./db');
const { UserError } = require('./context');
const { can } = require('./perms');
const { ts, truncate } = require('./util');
const ui = require('./ui');

const COLOR = ui.colors.sky;
const defaults = { staffRole: null, category: null, logChannel: null, panelChannel: null, blacklist: [], max: 1 };
const cfg = (gid) => kv.obj(gid, 'ticket', defaults);
const saveCfg = (gid, patch) => kv.set(gid, 'ticket', { ...cfg(gid), ...patch });

const byChannel = (channelId) => db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId) || null;
const openOf = (gid, userId) => db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND opener_id = ? AND status != 'deleted' AND status = 'open'").all(gid, userId);
const openAll = (gid) => db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND status IN ('open','closed') ORDER BY num").all(gid);
const setStatus = (id, status) => db.prepare('UPDATE tickets SET status = ?, closed_at = ? WHERE id = ?').run(status, status === 'open' ? null : Date.now(), id);
const setClaim = (id, userId) => db.prepare('UPDATE tickets SET claimed_by = ? WHERE id = ?').run(userId, id);

const isStaff = (member, c) => Boolean(member && ((c.staffRole && member.roles.cache.has(c.staffRole)) || can(member, ['ManageChannels'])));

function panelMessage(title, description) {
  const embed = ui.card({
    icon: '🎫', title: title || 'Need help?', color: COLOR,
    desc: description || 'Press the button below and a private channel will open just for you and our staff.',
    hint: 'One open ticket at a time, please.',
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:open').setLabel('Create ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row] };
}

const controlRow = (ticket) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  new ButtonBuilder().setCustomId('ticket:claim').setLabel(ticket?.claimed_by ? 'Claimed' : 'Claim').setEmoji('🙋').setStyle(ButtonStyle.Secondary).setDisabled(Boolean(ticket?.claimed_by))
);
const closedRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('ticket:reopen').setLabel('Reopen').setEmoji('🔓').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId('ticket:transcript').setLabel('Transcript').setEmoji('📄').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('ticket:delete').setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
);

async function logTo(guild, payload) {
  const id = cfg(guild.id).logChannel;
  if (!id) return;
  const ch = guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
  if (ch?.isTextBased()) await ch.send({ allowedMentions: { parse: [] }, ...payload }).catch(() => {});
}

async function openTicket(client, guild, user, reason) {
  const c = cfg(guild.id);
  if (c.blacklist.includes(user.id)) throw new UserError('You cannot open tickets', 'You have been blocked from opening tickets here.', 'Ask a moderator if you think this is a mistake.');
  const mine = openOf(guild.id, user.id);
  if (mine.length >= c.max) {
    throw new UserError('You already have a ticket', `Your open ticket is <#${mine[0].channel_id}>.`, 'Close it before opening another one.');
  }
  const me = guild.members.me;
  if (!me.permissions.has(P.ManageChannels)) throw new UserError('I need more permissions', 'I need **Manage Channels** to create tickets.');

  const num = db.prepare('SELECT COALESCE(MAX(num), 0) + 1 AS n FROM tickets WHERE guild_id = ?').get(guild.id).n;
  const parent = c.category && guild.channels.cache.get(c.category)?.type === ChannelType.GuildCategory ? c.category : null;
  const base = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];
  const overwrites = [
    { id: guild.roles.everyone, deny: [P.ViewChannel] },
    { id: user.id, allow: base },
    { id: client.user.id, allow: [...base, P.ManageChannels, P.ManageMessages] },
  ];
  if (c.staffRole && guild.roles.cache.has(c.staffRole)) overwrites.push({ id: c.staffRole, allow: [...base, P.ManageMessages] });

  const channel = await guild.channels.create({
    name: `ticket-${String(num).padStart(4, '0')}`,
    type: ChannelType.GuildText,
    parent,
    topic: `Ticket ${num} opened by ${user.tag} (${user.id})`,
    permissionOverwrites: overwrites,
    reason: `Ticket opened by ${user.tag}`,
  });

  db.prepare('INSERT INTO tickets (guild_id, num, channel_id, opener_id, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(guild.id, num, channel.id, user.id, reason || null, 'open', Date.now());
  const ticket = byChannel(channel.id);

  await channel.send({
    content: `<@${user.id}>${c.staffRole ? ` <@&${c.staffRole}>` : ''}`,
    allowedMentions: { users: [user.id], roles: c.staffRole ? [c.staffRole] : [] },
    embeds: [ui.card({
      icon: '🎫', title: `Ticket ${num}`, color: COLOR,
      desc: `Hi ${user.username}! Tell us what you need and someone will be with you soon.${reason ? `\n\n**Your note:** ${truncate(reason, 400)}` : ''}`,
      hint: 'Press Close when you are done.',
    })],
    components: [controlRow(ticket)],
  });
  await logTo(guild, { embeds: [ui.card({ icon: '🎫', title: `Ticket ${num} opened`, desc: ui.kv([['By', `<@${user.id}>`], ['Channel', `<#${channel.id}>`], ['Note', reason ? truncate(reason, 200) : null]]), color: COLOR })] });
  return { channel, ticket };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function buildTranscript(channel) {
  let all = [];
  let before;
  for (let i = 0; i < 10; i++) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || !batch.size) break;
    all = all.concat([...batch.values()]);
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const rows = all.map((m) => {
    const files = [...m.attachments.values()].map((a) => `<a href="${esc(a.url)}">${esc(a.name)}</a>`).join(' ');
    const embeds = m.embeds.length ? `<em>[${m.embeds.length} embed]</em>` : '';
    return `<div class="m"><b>${esc(m.author.tag)}</b> <span>${new Date(m.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19)} UTC</span><p>${esc(m.content).replace(/\n/g, '<br>')} ${embeds} ${files}</p></div>`;
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(channel.name)}</title><style>
body{background:#fff7fb;font-family:system-ui,sans-serif;color:#4a3f55;max-width:760px;margin:24px auto;padding:0 16px}
h1{font-size:20px}.m{background:#fff;border-left:4px solid #aed9f7;border-radius:8px;padding:8px 12px;margin:8px 0}
.m span{color:#9a8fa8;font-size:12px;margin-left:6px}.m p{margin:4px 0 0}a{color:#7a6bd6}</style></head>
<body><h1>Transcript of #${esc(channel.name)}</h1><p>${all.length} messages</p>${rows.join('\n')}</body></html>`;
  return { file: new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `transcript-${channel.name}.html` }), count: all.length };
}

async function closeTicket(guild, ticket, closer, reason) {
  const channel = guild.channels.cache.get(ticket.channel_id);
  setStatus(ticket.id, 'closed');
  if (channel) await channel.permissionOverwrites.edit(ticket.opener_id, { SendMessages: false }).catch(() => {});
  await logTo(guild, { embeds: [ui.card({ icon: '🔒', title: `Ticket ${ticket.num} closed`, desc: ui.kv([['By', `<@${closer.id}>`], ['Opened by', `<@${ticket.opener_id}>`], ['Reason', reason]]), color: ui.colors.butter })] });
  return {
    embeds: [ui.card({ icon: '🔒', title: 'Ticket closed', desc: `Closed by <@${closer.id}>.${reason ? `\n**Reason:** ${truncate(reason, 300)}` : ''}`, hint: 'Reopen it, save a transcript, or delete the channel.', color: ui.colors.butter })],
    components: [closedRow()],
  };
}

async function reopenTicket(guild, ticket, by) {
  const channel = guild.channels.cache.get(ticket.channel_id);
  setStatus(ticket.id, 'open');
  if (channel) await channel.permissionOverwrites.edit(ticket.opener_id, { SendMessages: true }).catch(() => {});
  await logTo(guild, { embeds: [ui.card({ icon: '🔓', title: `Ticket ${ticket.num} reopened`, desc: `By <@${by.id}>.`, color: COLOR })] });
  return { embeds: [ui.card({ icon: '🔓', title: 'Ticket reopened', desc: `<@${ticket.opener_id}> can chat again.`, color: COLOR })], components: [controlRow(byChannel(ticket.channel_id))] };
}

/** Saves a transcript to the log channel, DMs the opener, then deletes the channel after a short delay. */
async function deleteTicket(client, guild, ticket, by) {
  const channel = guild.channels.cache.get(ticket.channel_id);
  if (channel) {
    const { file, count } = await buildTranscript(channel);
    await logTo(guild, { embeds: [ui.card({ icon: '🗑️', title: `Ticket ${ticket.num} deleted`, desc: ui.kv([['By', `<@${by.id}>`], ['Opened by', `<@${ticket.opener_id}>`], ['Messages saved', count]]), color: ui.colors.cherry })], files: [file] });
    const opener = await client.users.fetch(ticket.opener_id).catch(() => null);
    if (opener) {
      const copy = await buildTranscript(channel);
      await opener.send({ embeds: [ui.card({ icon: '🎫', title: `Your ticket in ${guild.name} was closed`, desc: 'A copy of the conversation is attached.', color: COLOR })], files: [copy.file] }).catch(() => {});
    }
  }
  setStatus(ticket.id, 'deleted');
  setTimeout(() => channel?.delete(`Ticket deleted by ${by.tag}`).catch(() => {}), 5000);
}

module.exports = {
  cfg, saveCfg, byChannel, openOf, openAll, setClaim, isStaff, panelMessage, controlRow, closedRow,
  openTicket, closeTicket, reopenTicket, deleteTicket, buildTranscript, logTo, defaults,
};
