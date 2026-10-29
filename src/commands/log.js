const { ChannelType, PermissionFlagsBits: P, AuditLogEvent } = require('discord.js');
const { UserError } = require('../core/context');
const { kv } = require('../core/db');
const { ts } = require('../core/util');
const logger = require('../core/logger');
const ui = require('../core/ui');

const COLOR = ui.colors.mint;
const adm = (name, description, options, run, extra = {}) => ({ name, description, options, run, ...extra });
const EVENT_CHOICES = Object.entries(logger.EVENTS).map(([k, v]) => [v, k]);

module.exports = {
  category: { key: 'log', label: 'Logs', emoji: '📝', desc: 'Message, member, channel and role logs', color: COLOR },
  commands: [{
    name: 'log', description: 'Server logs', perms: ['ManageGuild'],
    subs: [
      adm('setup', 'One click: create a private log channel and turn on every log', [], async (ctx) => {
        const g = ctx.guild;
        const existing = logger.config(g.id).channel && g.channels.cache.get(logger.config(g.id).channel);
        const ch = existing || (await g.channels.create({
          name: 'server-logs', type: ChannelType.GuildText, reason: `Log setup by ${ctx.author.tag}`,
          permissionOverwrites: [{ id: g.roles.everyone, deny: [P.ViewChannel] }, { id: ctx.client.user.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks] }],
        }).catch(() => { throw new UserError('I could not create the channel', 'I need the **Manage Channels** permission.'); }));
        kv.set(g.id, 'logs', { ...logger.config(g.id), channel: ch.id });
        await ch.send({ embeds: [ui.card({ icon: '📝', title: 'Logs are on', desc: 'I will post deleted and edited messages, joins and leaves, role and channel changes, voice activity and bans here.', hint: 'Only admins can see this channel. Change what is logged with /log events.', color: COLOR })] });
        await ctx.reply(ui.ok('Logging is ready', `Logs go to ${ch}.`, 'Turn single logs off with /log events.'));
      }, { botPerms: ['ManageChannels'] }),
      adm('channel', 'Choose where logs are posted', [{ name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Leave empty to turn logging off' }], async (ctx) => {
        const ch = ctx.chan('channel');
        kv.set(ctx.guild.id, 'logs', { ...logger.config(ctx.guild.id), channel: ch ? ch.id : null });
        await ctx.reply(ch ? ui.ok('Log channel set', `Logs go to ${ch}.`) : ui.ok('Logging turned off', 'Set a channel again to resume.'));
      }),
      adm('modlog', 'Choose where moderation cases are posted', [{ name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Leave empty to turn it off' }], async (ctx) => {
        const ch = ctx.chan('channel');
        if (ch) kv.set(ctx.guild.id, 'modlog', ch.id); else kv.del(ctx.guild.id, 'modlog');
        await ctx.reply(ch ? ui.ok('Mod log set', `Every ban, kick, warning and timeout is posted in ${ch}.`) : ui.ok('Mod log turned off'));
      }),
      adm('status', 'See what is being logged', [], async (ctx) => {
        const c = logger.config(ctx.guild.id);
        const modlog = kv.get(ctx.guild.id, 'modlog', null);
        await ctx.reply(ui.card({
          icon: '📝', title: 'Log status', color: COLOR,
          desc: `${ui.kv([['Log channel', c.channel ? `<#${c.channel}>` : 'Not set'], ['Mod log', modlog ? `<#${modlog}>` : 'Not set'], ['Ignored channels', c.ignore.length ? c.ignore.map((x) => `<#${x}>`).join(' ') : 'None']])}\n\n${Object.entries(logger.EVENTS).map(([k, v]) => `${c.events[k] === false ? '⚪' : '🟢'} ${v}`).join('\n')}`,
          hint: c.channel ? undefined : 'Start with /log setup.',
        }));
      }),
      adm('events', 'Turn one kind of log on or off', [{ name: 'event', type: 'string', required: true, choices: EVENT_CHOICES, description: 'Which log' }, { name: 'enabled', type: 'bool', required: true, description: 'On or off' }], async (ctx) => {
        const c = logger.config(ctx.guild.id);
        c.events[ctx.str('event')] = ctx.bool('enabled');
        kv.set(ctx.guild.id, 'logs', c);
        await ctx.reply(ui.ok(`${logger.EVENTS[ctx.str('event')]} ${ctx.bool('enabled') ? 'on' : 'off'}`));
      }),
      adm('ignore', 'Stop logging a channel', [{ name: 'channel', type: 'channel', required: true, channelTypes: ['text', 'news', 'voice'], description: 'The channel' }], async (ctx) => {
        const c = logger.config(ctx.guild.id);
        if (!c.ignore.includes(ctx.chan('channel').id)) c.ignore.push(ctx.chan('channel').id);
        kv.set(ctx.guild.id, 'logs', c);
        await ctx.reply(ui.ok('Channel ignored', `I will not log activity in ${ctx.chan('channel')}.`));
      }),
      adm('unignore', 'Log a channel again', [{ name: 'channel', type: 'channel', required: true, channelTypes: ['text', 'news', 'voice'], description: 'The channel' }], async (ctx) => {
        const c = logger.config(ctx.guild.id);
        c.ignore = c.ignore.filter((x) => x !== ctx.chan('channel').id);
        kv.set(ctx.guild.id, 'logs', c);
        await ctx.reply(ui.ok('Channel logged again', `I will log activity in ${ctx.chan('channel')}.`));
      }),
      adm('ignored', 'See ignored channels', [], async (ctx) => {
        const c = logger.config(ctx.guild.id);
        await ctx.reply(ui.card({ icon: '🙈', title: 'Ignored channels', desc: c.ignore.length ? c.ignore.map((x) => `<#${x}>`).join('\n') : 'No channels are ignored.', color: COLOR }));
      }),
      adm('test', 'Send a test message to the log channel', [], async (ctx) => {
        const ok = await logger.sendLog(ctx.guild, '__test', ui.card({ icon: '🧪', title: 'Log test', desc: `Everything works. Sent by <@${ctx.author.id}>.`, color: COLOR }));
        if (!ok) throw new UserError('I could not post a log', 'The log channel is not set, or I cannot send messages in it.', 'Run /log setup, or check my channel permissions.');
        await ctx.reply(ui.ok('Test sent', 'Check your log channel.'));
      }),
      adm('audit', 'See the latest audit log entries', [{ name: 'count', type: 'int', min: 1, max: 15, description: 'How many (default 10)' }], async (ctx) => {
        const logs = await ctx.guild.fetchAuditLogs({ limit: ctx.int('count') || 10 }).catch(() => null);
        if (!logs) throw new UserError('I cannot read the audit log', 'I need the **View Audit Log** permission.');
        const name = (a) => Object.keys(AuditLogEvent).find((k) => AuditLogEvent[k] === a) || `Action ${a}`;
        const lines = [...logs.entries.values()].map((e) => `**${name(e.action).replace(/([a-z])([A-Z])/g, '$1 $2')}** by ${e.executor ? `<@${e.executor.id}>` : 'unknown'}${e.target?.id ? ` on \`${e.target.id}\`` : ''} ${ts(e.createdTimestamp)}`);
        await ctx.reply(ui.card({ icon: '📜', title: 'Latest audit log entries', desc: lines.join('\n') || 'Nothing yet.', color: COLOR }));
      }, { perms: ['ViewAuditLog'], botPerms: ['ViewAuditLog'] }),
    ],
  }],
};
