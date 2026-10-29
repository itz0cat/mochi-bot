const { PermissionFlagsBits: P } = require('discord.js');
const { UserError } = require('../core/context');
const { hierarchyProblem } = require('../core/perms');
const { parseDuration, fmtDuration, truncate, chunk, ts, idsFrom } = require('../core/util');
const { setLockdown, lockChannel, unlockChannel, lockable } = require('../core/lock');
const cases = require('../core/cases');
const scheduler = require('../core/scheduler');
const { paginate } = require('../core/pager');
const { kv } = require('../core/db');
const ui = require('../core/ui');

const MAX_TIMEOUT = 28 * 86400000;
const REASON = { name: 'reason', type: 'string', rest: true, description: 'Why? (shown in the mod log)', max: 400 };
const USER = (d) => ({ name: 'user', type: 'user', required: true, description: d });
const result = (icon, title, desc, c) => ui.card({ icon, title, desc, hint: c ? `Case ${c.num}` : undefined, color: ui.colors.lavender });
const why = (ctx) => ctx.str('reason') || 'No reason given';

/** Fetch the target member and make sure the moderator and I are allowed to act on them. */
async function target(ctx, verb, { mustBeMember = true } = {}) {
  const user = ctx.user('user');
  const member = await ctx.member('user');
  if (!member && mustBeMember) throw new UserError('Member not found', `${user.username} is not in this server.`, 'Check the mention or ID.');
  const problem = member ? hierarchyProblem(ctx, member, verb) : user.id === ctx.author.id ? `You can't ${verb} yourself.` : null;
  if (problem) throw new UserError(`Can't ${verb} that member`, problem);
  return { user, member };
}

async function dm(user, guild, title, reason, extra = '') {
  const embed = ui.card({ icon: '📩', title, desc: `**Server:** ${guild.name}\n**Reason:** ${reason}${extra ? `\n${extra}` : ''}`, color: ui.colors.cherry });
  return user.send({ embeds: [embed] }).then(() => true).catch(() => false);
}

scheduler.on('unban', async (client, row) => {
  const guild = client.guilds.cache.get(row.guild_id);
  if (!guild) return;
  await guild.members.unban(row.target_id, 'Temporary ban ended').catch(() => {});
  if (row.data?.caseNum) cases.deactivate(guild.id, row.data.caseNum);
  await cases.record(guild, { userId: row.target_id, modId: client.user.id, type: 'unban', reason: 'Temporary ban ended' });
});

const pageOf = (title, rows, color) => chunk(rows, 8).map((part) => ui.card({ icon: '🛡️', title, desc: part.join('\n\n'), color }));
const caseLine = (c) => `**Case ${c.num}** ${cases.TYPE_LABEL[c.type] || c.type}${c.active ? '' : ' (cleared)'} by <@${c.mod_id}> ${ts(c.created_at)}\n${truncate(c.reason || 'No reason given', 150)}`;

module.exports = {
  category: { key: 'moderation', label: 'Moderation', emoji: '🔨', desc: 'Ban, kick, timeout, warn, purge and more', color: ui.colors.lavender },
  commands: [
    {
      name: 'ban', description: 'Ban a member (they can be banned even if they left)', perms: ['BanMembers'], botPerms: ['BanMembers'],
      options: [USER('Who to ban'), REASON, { name: 'delete_days', type: 'int', min: 0, max: 7, description: 'Delete their messages from the last N days' }],
      async run(ctx) {
        const { user, member } = await target(ctx, 'ban', { mustBeMember: false });
        const reason = why(ctx);
        if (member) await dm(user, ctx.guild, 'You were banned', reason);
        await ctx.guild.members.ban(user.id, { reason: `${ctx.author.tag}: ${reason}`, deleteMessageSeconds: (ctx.int('delete_days') || 0) * 86400 })
          .catch(() => { throw new UserError('Ban failed', 'Discord would not let me ban that user.', 'Check my role is above theirs.'); });
        const c = await cases.record(ctx.guild, { userId: user.id, modId: ctx.author.id, type: 'ban', reason });
        await ctx.reply(result('🔨', `Banned ${user.username}`, `**Reason:** ${reason}`, c));
      },
    },
    {
      name: 'unban', description: 'Lift a ban using the user ID', perms: ['BanMembers'], botPerms: ['BanMembers'],
      options: [{ name: 'user_id', type: 'string', required: true, description: 'ID of the banned user' }, REASON],
      async run(ctx) {
        const id = idsFrom(ctx.str('user_id'))[0];
        const ban = id && (await ctx.guild.bans.fetch(id).catch(() => null));
        if (!ban) throw new UserError('Not banned', 'I could not find a ban for that ID.', 'Copy the ID from Server Settings > Bans.');
        await ctx.guild.members.unban(id, `${ctx.author.tag}: ${why(ctx)}`);
        scheduler.cancelWhere('unban', ctx.guild.id, id);
        const c = await cases.record(ctx.guild, { userId: id, modId: ctx.author.id, type: 'unban', reason: why(ctx) });
        await ctx.reply(result('🕊️', `Unbanned ${ban.user.username}`, `**Reason:** ${why(ctx)}`, c));
      },
    },
    {
      name: 'softban', description: 'Ban then unban right away to wipe their recent messages', perms: ['BanMembers'], botPerms: ['BanMembers'],
      options: [USER('Who to softban'), REASON],
      async run(ctx) {
        const { user, member } = await target(ctx, 'softban');
        const reason = why(ctx);
        await dm(user, ctx.guild, 'You were softbanned (you may rejoin)', reason);
        await ctx.guild.members.ban(member.id, { reason: `Softban by ${ctx.author.tag}: ${reason}`, deleteMessageSeconds: 7 * 86400 });
        await ctx.guild.members.unban(member.id, 'Softban').catch(() => {});
        const c = await cases.record(ctx.guild, { userId: user.id, modId: ctx.author.id, type: 'softban', reason });
        await ctx.reply(result('🧹', `Softbanned ${user.username}`, `Their messages from the last 7 days were removed.\n**Reason:** ${reason}`, c));
      },
    },
    {
      name: 'tempban', description: 'Ban someone for a set time', perms: ['BanMembers'], botPerms: ['BanMembers'],
      options: [USER('Who to ban'), { name: 'duration', type: 'string', required: true, description: 'For how long? Like 3d or 12h' }, REASON],
      async run(ctx) {
        const ms = parseDuration(ctx.str('duration'));
        if (!ms) throw new UserError('Invalid duration', 'Use a number and a unit, like 30m, 12h, 3d or 2w.');
        const { user, member } = await target(ctx, 'ban', { mustBeMember: false });
        const reason = why(ctx);
        if (member) await dm(user, ctx.guild, `You were banned for ${fmtDuration(ms)}`, reason);
        await ctx.guild.members.ban(user.id, { reason: `Tempban by ${ctx.author.tag}: ${reason}` });
        const c = await cases.record(ctx.guild, { userId: user.id, modId: ctx.author.id, type: 'tempban', reason, expiresAt: Date.now() + ms });
        scheduler.add('unban', Date.now() + ms, { guildId: ctx.guild.id, targetId: user.id, data: { caseNum: c.num } });
        await ctx.reply(result('⏳', `Banned ${user.username} for ${fmtDuration(ms)}`, `**Reason:** ${reason}\nThey will be unbanned automatically.`, c));
      },
    },
    {
      name: 'massban', description: 'Ban many users at once by ID or mention', perms: ['Administrator'], botPerms: ['BanMembers'], cooldown: 10,
      options: [{ name: 'users', type: 'string', required: true, description: 'IDs or mentions separated by spaces' }, REASON],
      async run(ctx) {
        const ids = [...new Set(idsFrom(ctx.str('users')))].slice(0, 25);
        if (!ids.length) throw new UserError('No users found', 'Paste user IDs or mentions separated by spaces.');
        await ctx.defer();
        let done = 0;
        const skipped = [];
        for (const id of ids) {
          const m = await ctx.guild.members.fetch(id).catch(() => null);
          if (m && hierarchyProblem(ctx, m, 'ban')) { skipped.push(id); continue; }
          const ok = await ctx.guild.members.ban(id, { reason: `Massban by ${ctx.author.tag}: ${why(ctx)}` }).then(() => true).catch(() => false);
          if (ok) { done++; await cases.record(ctx.guild, { userId: id, modId: ctx.author.id, type: 'ban', reason: `Massban: ${why(ctx)}` }); } else skipped.push(id);
        }
        await ctx.reply(result('🔨', `Banned ${done} of ${ids.length} users`, skipped.length ? `Skipped (higher role or invalid): ${skipped.map((i) => `\`${i}\``).join(', ')}` : 'All done.'));
      },
    },
    {
      name: 'kick', description: 'Kick a member from the server', perms: ['KickMembers'], botPerms: ['KickMembers'],
      options: [USER('Who to kick'), REASON],
      async run(ctx) {
        const { user, member } = await target(ctx, 'kick');
        const reason = why(ctx);
        await dm(user, ctx.guild, 'You were kicked', reason);
        await member.kick(`${ctx.author.tag}: ${reason}`);
        const c = await cases.record(ctx.guild, { userId: user.id, modId: ctx.author.id, type: 'kick', reason });
        await ctx.reply(result('👢', `Kicked ${user.username}`, `**Reason:** ${reason}`, c));
      },
    },
    {
      name: 'mute', description: 'Silence a member (uses a Discord timeout, 28 days by default)', perms: ['ModerateMembers'], botPerms: ['ModerateMembers'],
      options: [USER('Who to mute'), { name: 'duration', type: 'string', description: 'Like 30m or 2d. Leave empty for 28 days' }, REASON],
      async run(ctx) {
        const ms = ctx.str('duration') ? parseDuration(ctx.str('duration')) : MAX_TIMEOUT;
        if (!ms || ms > MAX_TIMEOUT) throw new UserError('Invalid duration', 'Mutes can last from 1 second up to 28 days. Try 30m, 6h or 2d.');
        const { user, member } = await target(ctx, 'mute');
        await member.timeout(ms, `${ctx.author.tag}: ${why(ctx)}`);
        await dm(user, ctx.guild, `You were muted for ${fmtDuration(ms)}`, why(ctx));
        const c = await cases.record(ctx.guild, { userId: user.id, modId: ctx.author.id, type: 'mute', reason: why(ctx), expiresAt: Date.now() + ms });
        await ctx.reply(result('🤐', `Muted ${user.username} for ${fmtDuration(ms)}`, `**Reason:** ${why(ctx)}`, c));
      },
    },
    {
      name: 'unmute', description: 'Let a muted member talk again', perms: ['ModerateMembers'], botPerms: ['ModerateMembers'],
      options: [USER('Who to unmute'), REASON],
      async run(ctx) {
        const { user, member } = await target(ctx, 'unmute');
        if (!member.isCommunicationDisabled()) throw new UserError('Not muted', `${user.username} is not muted right now.`);
        await member.timeout(null, `${ctx.author.tag}: ${why(ctx)}`);
        const c = await cases.record(ctx.guild, { userId: user.id, modId: ctx.author.id, type: 'unmute', reason: why(ctx) });
        await ctx.reply(result('🔊', `Unmuted ${user.username}`, `**Reason:** ${why(ctx)}`, c));
      },
    },
    {
      name: 'timeout', description: 'Put a member in timeout', perms: ['ModerateMembers'], botPerms: ['ModerateMembers'],
      options: [USER('Who to timeout'), { name: 'duration', type: 'string', required: true, description: 'Like 10m, 2h or 1d (up to 28d)' }, REASON],
      async run(ctx) {
        const ms = parseDuration(ctx.str('duration'));
        if (!ms || ms > MAX_TIMEOUT) throw new UserError('Invalid duration', 'Timeouts can last from 1 second up to 28 days. Try 10m, 2h or 1d.');
        const { user, member } = await target(ctx, 'timeout');
        await member.timeout(ms, `${ctx.author.tag}: ${why(ctx)}`);
        await dm(user, ctx.guild, `You were timed out for ${fmtDuration(ms)}`, why(ctx));
        const c = await cases.record(ctx.guild, { userId: user.id, modId: ctx.author.id, type: 'timeout', reason: why(ctx), expiresAt: Date.now() + ms });
        await ctx.reply(result('⏸️', `Timed out ${user.username} for ${fmtDuration(ms)}`, `**Reason:** ${why(ctx)}`, c));
      },
    },
    {
      name: 'untimeout', description: 'Remove a member from timeout', perms: ['ModerateMembers'], botPerms: ['ModerateMembers'],
      options: [USER('Who to release'), REASON],
      async run(ctx) {
        const { user, member } = await target(ctx, 'release');
        if (!member.isCommunicationDisabled()) throw new UserError('Not in timeout', `${user.username} is not in timeout.`);
        await member.timeout(null, `${ctx.author.tag}: ${why(ctx)}`);
        const c = await cases.record(ctx.guild, { userId: user.id, modId: ctx.author.id, type: 'untimeout', reason: why(ctx) });
        await ctx.reply(result('▶️', `Removed timeout for ${user.username}`, `**Reason:** ${why(ctx)}`, c));
      },
    },
    {
      name: 'warn', description: 'Give a member a warning', perms: ['ModerateMembers'],
      options: [USER('Who to warn'), { name: 'reason', type: 'string', required: true, description: 'What did they do?', max: 400 }],
      async run(ctx) {
        const { user } = await target(ctx, 'warn');
        const reason = ctx.str('reason');
        const c = await cases.record(ctx.guild, { userId: user.id, modId: ctx.author.id, type: 'warn', reason });
        const sent = await dm(user, ctx.guild, 'You received a warning', reason);
        const total = cases.userCases(ctx.guild.id, user.id, { type: 'warn', activeOnly: true }).length;
        await ctx.reply(result('⚠️', `Warned ${user.username}`, `**Reason:** ${reason}\nThey now have **${total}** active ${total === 1 ? 'warning' : 'warnings'}.${sent ? '' : '\n-# I could not DM them (their DMs are closed).'}`, c));
      },
    },
    {
      name: 'warnings', description: "See a member's warnings", perms: ['ModerateMembers'],
      options: [{ name: 'user', type: 'user', description: 'Whose warnings? Leave empty for yours' }],
      async run(ctx) {
        const user = ctx.user('user') || ctx.author;
        const list = cases.userCases(ctx.guild.id, user.id, { type: 'warn', activeOnly: true });
        if (!list.length) return ctx.reply(ui.card({ icon: '🌷', title: `${user.username} has no warnings`, desc: 'A clean record.', color: ui.colors.mint }));
        await paginate(ctx, pageOf(`Warnings for ${user.username}`, list.map(caseLine), ui.colors.butter));
      },
    },
    {
      name: 'clearwarns', description: 'Clear all active warnings for a member', perms: ['ModerateMembers'],
      options: [USER('Whose warnings to clear')],
      async run(ctx) {
        const user = ctx.user('user');
        const list = cases.userCases(ctx.guild.id, user.id, { type: 'warn', activeOnly: true });
        if (!list.length) throw new UserError('Nothing to clear', `${user.username} has no active warnings.`);
        list.forEach((c) => cases.deactivate(ctx.guild.id, c.num));
        await ctx.reply(result('🧼', `Cleared ${list.length} ${list.length === 1 ? 'warning' : 'warnings'} for ${user.username}`, 'The cases stay in the history marked as cleared.'));
      },
    },
    {
      name: 'delwarn', description: 'Remove one warning by case number', perms: ['ModerateMembers'],
      options: [{ name: 'case', type: 'int', required: true, min: 1, description: 'Case number of the warning' }],
      async run(ctx) {
        const c = cases.getCase(ctx.guild.id, ctx.int('case'));
        if (!c || c.type !== 'warn') throw new UserError('Warning not found', `Case ${ctx.int('case')} is not a warning.`, 'Check /warnings for the right number.');
        cases.deactivate(ctx.guild.id, c.num);
        await ctx.reply(result('🧼', `Removed warning from case ${c.num}`, `For <@${c.user_id}>.`));
      },
    },
    {
      name: 'note', description: 'Save a private note about a member', perms: ['ModerateMembers'],
      options: [USER('Who the note is about'), { name: 'text', type: 'string', required: true, description: 'The note', max: 400 }],
      async run(ctx) {
        const user = ctx.user('user');
        const c = await cases.record(ctx.guild, { userId: user.id, modId: ctx.author.id, type: 'note', reason: ctx.str('text') });
        await ctx.reply(result('📝', `Saved a note for ${user.username}`, ctx.str('text'), c), { ephemeral: true });
      },
    },
    {
      name: 'purge', description: 'Delete a bunch of recent messages', perms: ['ManageMessages'], botPerms: ['ManageMessages', 'ReadMessageHistory'], cooldown: 3,
      options: [{ name: 'amount', type: 'int', required: true, min: 1, max: 100, description: 'How many messages (1-100)' }, { name: 'user', type: 'user', description: 'Only delete this member\'s messages' }],
      async run(ctx) {
        await ctx.defer({ ephemeral: true });
        const user = ctx.user('user');
        let msgs = await ctx.channel.messages.fetch({ limit: 100 });
        if (user) msgs = msgs.filter((m) => m.author.id === user.id);
        const pick = [...msgs.values()].filter((m) => m.id !== ctx.message?.id).slice(0, ctx.int('amount'));
        const gone = await ctx.channel.bulkDelete(pick, true).catch(() => null);
        if (ctx.message?.deletable) ctx.message.delete().catch(() => {});
        if (!gone) throw new UserError('Could not delete', 'I was not able to delete messages in this channel.', 'Messages older than 14 days cannot be bulk deleted.');
        await ctx.reply(ui.ok(`Deleted ${gone.size} ${gone.size === 1 ? 'message' : 'messages'}`, pick.length > gone.size ? 'Some were older than 14 days, which Discord will not let me bulk delete.' : undefined), { ephemeral: true });
      },
    },
    {
      name: 'clean', description: 'Delete my own recent messages in this channel', perms: ['ManageMessages'], botPerms: ['ManageMessages'],
      options: [{ name: 'amount', type: 'int', min: 1, max: 100, description: 'How many to look through (default 50)' }],
      async run(ctx) {
        await ctx.defer({ ephemeral: true });
        const msgs = await ctx.channel.messages.fetch({ limit: ctx.int('amount') || 50 });
        const mine = [...msgs.values()].filter((m) => m.author.id === ctx.client.user.id);
        const gone = await ctx.channel.bulkDelete(mine, true).catch(() => null);
        await ctx.reply(ui.ok(`Cleaned up ${gone?.size ?? 0} of my messages`), { ephemeral: true });
      },
    },
    {
      name: 'slowmode', description: 'Set slowmode in a channel', perms: ['ManageChannels'], botPerms: ['ManageChannels'],
      options: [{ name: 'seconds', type: 'int', required: true, min: 0, max: 21600, description: '0 turns slowmode off' }, { name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Defaults to this channel' }],
      async run(ctx) {
        const ch = ctx.chan('channel') || ctx.channel;
        await ch.setRateLimitPerUser(ctx.int('seconds'), `Slowmode by ${ctx.author.tag}`);
        await ctx.reply(result('🐢', ctx.int('seconds') ? `Slowmode set to ${ctx.int('seconds')}s in #${ch.name}` : `Slowmode turned off in #${ch.name}`, 'Members with Manage Messages are not affected.'));
      },
    },
    {
      name: 'lock', description: 'Stop @everyone from chatting in a channel', perms: ['ManageChannels'], botPerms: ['ManageChannels'],
      options: [{ name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Defaults to this channel' }, REASON],
      async run(ctx) {
        const ch = ctx.chan('channel') || ctx.channel;
        if (!lockable(ch)) throw new UserError('Cannot lock that', 'Pick a text channel.');
        await lockChannel(ch, `${ctx.author.tag}: ${why(ctx)}`);
        await ctx.reply(result('🔒', `Locked #${ch.name}`, `**Reason:** ${why(ctx)}\n-# Undo it with /unlock.`));
      },
    },
    {
      name: 'unlock', description: 'Let @everyone chat in a channel again', perms: ['ManageChannels'], botPerms: ['ManageChannels'],
      options: [{ name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Defaults to this channel' }],
      async run(ctx) {
        const ch = ctx.chan('channel') || ctx.channel;
        await unlockChannel(ch, `Unlocked by ${ctx.author.tag}`);
        await ctx.reply(result('🔓', `Unlocked #${ch.name}`, 'Everyone can chat again.'));
      },
    },
    {
      name: 'lockdown', description: 'Lock every public channel at once (or lift it)', perms: ['Administrator'], botPerms: ['ManageChannels'], cooldown: 10,
      options: [{ name: 'mode', type: 'string', choices: [['Start lockdown', 'start'], ['End lockdown', 'end']], description: 'Defaults to start' }, REASON],
      async run(ctx) {
        await ctx.defer();
        const on = (ctx.str('mode') || 'start') === 'start';
        const r = await setLockdown(ctx.guild, on, `${ctx.author.tag}: ${why(ctx)}`);
        await ctx.reply(result(on ? '🚨' : '🌤️', on ? 'Server locked down' : 'Lockdown lifted', `${on ? 'Locked' : 'Restored'} **${r.changed}** of ${r.total} channels.\n${on ? '-# End it with /lockdown mode:end.' : ''}`));
      },
    },
    {
      name: 'nuke', description: 'Delete and recreate this channel to wipe all messages', perms: ['ManageChannels'], botPerms: ['ManageChannels'], cooldown: 10,
      options: [{ name: 'confirm', type: 'bool', required: true, description: 'Set to true to confirm. This cannot be undone' }],
      async run(ctx) {
        if (!ctx.bool('confirm')) throw new UserError('Nuke cancelled', 'Nothing was deleted.', 'Run it again with confirm set to true if you are sure.');
        const old = ctx.channel;
        if (!old.clone) throw new UserError('Cannot nuke here', 'Use this in a normal text channel.');
        const fresh = await old.clone({ reason: `Nuked by ${ctx.author.tag}` });
        await fresh.setPosition(old.position).catch(() => {});
        await ctx.reply(ui.ok('Channel nuked', `The fresh channel is ${fresh}.`), { ephemeral: true }).catch(() => {});
        await old.delete(`Nuked by ${ctx.author.tag}`);
        await fresh.send({ embeds: [result('💥', 'Channel nuked', `Wiped by <@${ctx.author.id}>. Fresh start!`)] });
      },
    },
    {
      name: 'case', description: 'Look up a moderation case', perms: ['ModerateMembers'],
      options: [{ name: 'number', type: 'int', required: true, min: 1, description: 'The case number' }],
      async run(ctx) {
        const c = cases.getCase(ctx.guild.id, ctx.int('number'));
        if (!c) throw new UserError('Case not found', `There is no case ${ctx.int('number')} in this server.`);
        await ctx.reply(cases.caseEmbed(c));
      },
    },
    {
      name: 'reason', description: 'Change the reason of a case', perms: ['ModerateMembers'],
      options: [{ name: 'case', type: 'int', required: true, min: 1, description: 'The case number' }, { name: 'reason', type: 'string', required: true, description: 'The new reason', max: 400 }],
      async run(ctx) {
        if (!cases.getCase(ctx.guild.id, ctx.int('case'))) throw new UserError('Case not found', `There is no case ${ctx.int('case')} in this server.`);
        cases.setReason(ctx.guild.id, ctx.int('case'), ctx.str('reason'));
        await ctx.reply(ui.ok(`Updated case ${ctx.int('case')}`, ctx.str('reason')));
      },
    },
    {
      name: 'modlogs', description: "Everything moderators did to a member", perms: ['ModerateMembers'],
      options: [USER('Whose history to show')],
      async run(ctx) {
        const user = ctx.user('user');
        const list = cases.userCases(ctx.guild.id, user.id);
        if (!list.length) return ctx.reply(ui.card({ icon: '🌷', title: `No history for ${user.username}`, desc: 'No moderation cases yet.', color: ui.colors.mint }));
        await paginate(ctx, pageOf(`History for ${user.username} (${list.length} cases)`, list.map(caseLine), ui.colors.lavender));
      },
    },
    {
      name: 'modstats', description: 'See how many actions a moderator has taken', perms: ['ModerateMembers'],
      options: [{ name: 'moderator', type: 'user', description: 'Defaults to you' }],
      async run(ctx) {
        const mod = ctx.user('moderator') || ctx.author;
        const list = cases.modCases(ctx.guild.id, mod.id);
        const count = {};
        for (const c of list) count[c.type] = (count[c.type] || 0) + 1;
        const lines = Object.entries(count).map(([t, n]) => `**${cases.TYPE_LABEL[t] || t}:** ${n}`);
        await ctx.reply(ui.card({ icon: '📊', title: `Moderation stats for ${mod.username}`, desc: lines.length ? `${lines.join('\n')}\n\n**Total:** ${list.length}` : 'No actions yet.', color: ui.colors.lavender }));
      },
    },
    {
      name: 'moderations', description: 'List bans and mutes that will end by themselves', perms: ['ModerateMembers'],
      async run(ctx) {
        const list = cases.activeTimed(ctx.guild.id);
        if (!list.length) return ctx.reply(ui.card({ icon: '🌷', title: 'Nothing running', desc: 'No temporary actions are active.', color: ui.colors.mint }));
        await ctx.reply(ui.card({ icon: '⏳', title: 'Active temporary actions', desc: list.slice(0, 15).map((c) => `**Case ${c.num}** ${cases.TYPE_LABEL[c.type]} for <@${c.user_id}> ends ${ts(c.expires_at)}`).join('\n'), color: ui.colors.lavender }));
      },
    },
    {
      name: 'setnick', description: "Change a member's nickname", perms: ['ManageNicknames'], botPerms: ['ManageNicknames'],
      options: [USER('Whose nickname'), { name: 'nickname', type: 'string', max: 32, description: 'New nickname. Leave empty to reset' }],
      async run(ctx) {
        const { user, member } = await target(ctx, 'rename');
        await member.setNickname(ctx.str('nickname') || null, `Changed by ${ctx.author.tag}`);
        await ctx.reply(result('🏷️', ctx.str('nickname') ? `Renamed ${user.username}` : `Reset ${user.username}'s nickname`, ctx.str('nickname') ? `New nickname: **${ctx.str('nickname')}**` : 'Back to their username.'));
      },
    },
    {
      name: 'vckick', description: 'Disconnect a member from their voice channel', perms: ['MoveMembers'], botPerms: ['MoveMembers'],
      options: [USER('Who to disconnect')],
      async run(ctx) {
        const { user, member } = await target(ctx, 'disconnect');
        if (!member.voice.channel) throw new UserError('Not in voice', `${user.username} is not in a voice channel.`);
        await member.voice.disconnect(`By ${ctx.author.tag}`);
        await ctx.reply(result('🔇', `Disconnected ${user.username}`, 'They were removed from voice.'));
      },
    },
  ],
};
