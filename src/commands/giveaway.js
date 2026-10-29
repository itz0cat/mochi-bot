const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { UserError } = require('../core/context');
const { parseDuration, fmtDuration, ts, truncate, chunk, ID_RE } = require('../core/util');
const scheduler = require('../core/scheduler');
const { paginate } = require('../core/pager');
const { db } = require('../core/db');
const G = require('../core/giveaways');
const ui = require('../core/ui');

const COLOR = ui.colors.peach;
const ID = { name: 'id', type: 'int', min: 1, description: 'Giveaway ID (defaults to the newest)' };

const isManager = async (ctx) => {
  const m = G.cfg(ctx.guild.id).manager;
  return Boolean(m && ctx.me.roles.cache.has(m));
};
const dur = (ctx, name = 'duration') => {
  const ms = parseDuration(ctx.str(name));
  if (!ms || ms < 10_000) throw new UserError('Invalid duration', 'Use a number and a unit, like 30m, 6h, 2d or 1w (at least 10s).');
  return ms;
};
const link = (g) => `https://discord.com/channels/${g.guild_id}/${g.channel_id}/${g.message_id}`;
const line = (g) => `**${g.id}** [${truncate(g.prize, 50)}](${link(g)}) ${g.status === 'paused' ? 'paused' : g.status === 'ended' ? 'ended' : `ends ${ts(g.ends_at)}`}`;

const sub = (name, description, extra, run) => ({ name, description, check: isManager, ...extra, run });
const adminSub = (name, group, description, extra, run) => ({ name, group, description, ...extra, run });

module.exports = {
  category: { key: 'giveaway', label: 'Giveaways', emoji: '🎁', desc: 'Giveaways, drops, requirements and bonus entries', color: COLOR },
  commands: [{
    name: 'giveaway', description: 'Run giveaways', perms: ['ManageGuild'],
    groups: {
      requirements: 'Entry requirements and bonus entries',
      blacklist: 'Block members from giveaways',
      template: 'Reusable giveaway presets',
      settings: 'Giveaway server settings',
    },
    subs: [
      sub('start', 'Start a giveaway', {
        options: [
          { name: 'prize', type: 'string', required: true, max: 200, description: 'What are you giving away?' },
          { name: 'duration', type: 'string', required: true, description: 'How long? Like 30m, 6h, 2d' },
          { name: 'winners', type: 'int', min: 1, max: 20, description: 'How many winners (default 1)' },
          { name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Where to post it (defaults to the giveaway channel or here)' },
          { name: 'role', type: 'role', description: 'Members need this role to enter' },
          { name: 'invites', type: 'int', min: 1, description: 'Members need this many invites to enter' },
          { name: 'partner', type: 'string', description: 'ID of a server members must be in (I must be in it too)' },
        ],
      }, async (ctx) => {
        const c = G.cfg(ctx.guild.id);
        const ch = ctx.chan('channel') || (c.channel && ctx.guild.channels.cache.get(c.channel)) || ctx.channel;
        const partner = ctx.str('partner');
        if (partner && !ID_RE.test(partner)) throw new UserError('Invalid server ID', 'The partner must be a server ID (a long number).');
        const { g, msg } = await G.start(ctx.client, ctx.guild, {
          channel: ch, host: ctx.author, prize: ctx.str('prize'), winners: ctx.int('winners') || 1, durationMs: dur(ctx),
          req: { role: ctx.role('role')?.id, invites: ctx.int('invites'), partner },
        });
        await ctx.reply(ui.card({ icon: '🎁', title: 'Giveaway started', desc: `**${truncate(g.prize, 100)}** ends ${ts(g.ends_at)} in ${ch}.`, hint: `Giveaway ${g.id}. Jump to it: ${msg.url}`, color: COLOR }), { ephemeral: true });
      }),
      sub('drop', 'Instant drop: the first person to click wins', {
        options: [{ name: 'prize', type: 'string', required: true, max: 200, description: 'What is being dropped?' }, { name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Defaults to this channel' }],
      }, async (ctx) => {
        const ch = ctx.chan('channel') || ctx.channel;
        const { g, msg } = await G.start(ctx.client, ctx.guild, { channel: ch, host: ctx.author, prize: ctx.str('prize'), winners: 1, durationMs: 10 * 60_000, req: { kind: 'drop' } });
        await msg.edit({
          embeds: [ui.card({ icon: '⚡', title: `Drop: ${truncate(g.prize, 200)}`, desc: 'Be the first to press the button to win.', hint: `Giveaway ${g.id}`, color: COLOR })],
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('giveaway:claim').setLabel('Claim').setEmoji('⚡').setStyle(ButtonStyle.Success))],
        });
        await ctx.reply(ui.ok('Drop is live', `Posted in ${ch}. It expires in 10 minutes if nobody claims it.`), { ephemeral: true });
      }),
      sub('end', 'End a giveaway now and pick winners', { options: [ID] }, async (ctx) => {
        const g = G.find(ctx, ['running', 'paused']);
        await G.end(ctx.client, g.id);
        await ctx.reply(ui.ok('Giveaway ended', `Winners for **${truncate(g.prize, 80)}** have been picked.`), { ephemeral: true });
      }),
      sub('reroll', 'Pick new winners for an ended giveaway', { options: [ID, { name: 'winners', type: 'int', min: 1, max: 20, description: 'How many new winners (default: same as before)' }] }, async (ctx) => {
        const g = G.find(ctx, ['ended']);
        const winners = await G.reroll(ctx.client, g, ctx.int('winners'));
        if (!winners.length) throw new UserError('Nobody left to pick', 'Everyone who entered has already won or left the server.');
        await ctx.reply(ui.ok('Picked new winners', winners.map((w) => `<@${w}>`).join(', ')), { ephemeral: true });
      }),
      sub('pause', 'Pause a giveaway timer', { options: [ID] }, async (ctx) => {
        const g = G.find(ctx, ['running']);
        scheduler.cancelWhere('giveaway_end', g.guild_id, String(g.id));
        db.prepare("UPDATE giveaways SET status = 'paused', remaining = ? WHERE id = ?").run(Math.max(1000, g.ends_at - Date.now()), g.id);
        await G.refreshMessage(ctx.client, G.get(g.id));
        await ctx.reply(ui.ok('Giveaway paused', 'Resume it with /giveaway resume.'), { ephemeral: true });
      }),
      sub('resume', 'Resume a paused giveaway', { options: [ID] }, async (ctx) => {
        const g = G.find(ctx, ['paused']);
        const endsAt = Date.now() + (g.remaining || 60_000);
        db.prepare("UPDATE giveaways SET status = 'running', ends_at = ? WHERE id = ?").run(endsAt, g.id);
        scheduler.add('giveaway_end', endsAt, { guildId: g.guild_id, targetId: String(g.id) });
        await G.refreshMessage(ctx.client, G.get(g.id));
        await ctx.reply(ui.ok('Giveaway resumed', `It now ends ${ts(endsAt)}.`), { ephemeral: true });
      }),
      sub('edit', 'Change the prize, winners or time of a running giveaway', {
        options: [ID, { name: 'prize', type: 'string', max: 200, description: 'New prize' }, { name: 'winners', type: 'int', min: 1, max: 20, description: 'New number of winners' }, { name: 'extend', type: 'string', description: 'Add time, like 1h or 1d' }],
      }, async (ctx) => {
        const g = G.find(ctx, ['running', 'paused']);
        const patch = { prize: ctx.str('prize') || g.prize, winners: ctx.int('winners') || g.winners, ends_at: g.ends_at };
        if (ctx.str('extend')) {
          patch.ends_at = g.ends_at + dur(ctx, 'extend');
          if (g.status === 'running') { scheduler.cancelWhere('giveaway_end', g.guild_id, String(g.id)); scheduler.add('giveaway_end', patch.ends_at, { guildId: g.guild_id, targetId: String(g.id) }); }
        }
        db.prepare('UPDATE giveaways SET prize = ?, winners = ?, ends_at = ? WHERE id = ?').run(patch.prize, patch.winners, patch.ends_at, g.id);
        await G.refreshMessage(ctx.client, G.get(g.id));
        await ctx.reply(ui.ok('Giveaway updated', `**${truncate(patch.prize, 100)}** ends ${ts(patch.ends_at)}.`), { ephemeral: true });
      }),
      sub('delete', 'Delete a giveaway without picking winners', { options: [ID] }, async (ctx) => {
        const g = G.find(ctx, ['running', 'paused', 'ended']);
        scheduler.cancelWhere('giveaway_end', g.guild_id, String(g.id));
        const ch = ctx.guild.channels.cache.get(g.channel_id);
        const msg = ch && g.message_id ? await ch.messages.fetch(g.message_id).catch(() => null) : null;
        await msg?.delete().catch(() => {});
        db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ?').run(g.id);
        db.prepare('DELETE FROM giveaways WHERE id = ?').run(g.id);
        await ctx.reply(ui.ok('Giveaway deleted', `Giveaway ${g.id} is gone.`), { ephemeral: true });
      }),
      sub('list', 'See active giveaways', { check: undefined, perms: [] }, async (ctx) => {
        const list = G.listFor(ctx.guild.id, ['running', 'paused']);
        if (!list.length) return ctx.reply(ui.card({ icon: '🌷', title: 'No giveaways running', desc: 'Start one with /giveaway start.', color: COLOR }));
        await ctx.reply(ui.card({ icon: '🎁', title: `${list.length} active ${list.length === 1 ? 'giveaway' : 'giveaways'}`, desc: list.slice(0, 15).map(line).join('\n'), color: COLOR }));
      }),
      sub('info', 'Details about one giveaway', { check: undefined, perms: [], options: [ID] }, async (ctx) => {
        const g = G.find(ctx, ['running', 'paused', 'ended']);
        await ctx.reply(ui.card({
          icon: '🎁', title: truncate(g.prize, 200), color: COLOR,
          desc: ui.kv([['Status', g.status], ['Host', `<@${g.host_id}>`], ['Winners', g.winners], ['Entries', G.entryCount(g.id)], [g.status === 'ended' ? 'Ended' : 'Ends', g.ends_at ? ts(g.ends_at) : null], ['Requirements', G.buildEmbed(g, 0) && (g.req.role || g.req.invites || g.req.partner ? `${g.req.role ? `<@&${g.req.role}> ` : ''}${g.req.invites ? `${g.req.invites} invites ` : ''}${g.req.partner ? 'partner server' : ''}` : 'None')], ['Message', `[Jump](${link(g)})`]]),
          hint: `Giveaway ${g.id}`,
        }));
      }),
      sub('entrants', 'See who entered', { check: undefined, perms: [], options: [ID] }, async (ctx) => {
        const g = G.find(ctx, ['running', 'paused', 'ended']);
        const list = G.entries(g.id);
        if (!list.length) return ctx.reply(ui.card({ icon: '🌷', title: 'No entries yet', desc: 'Be the first to enter!', color: COLOR }));
        await paginate(ctx, chunk(list, 15).map((part) => ui.card({ icon: '👥', title: `Entrants for ${truncate(g.prize, 60)} (${list.length})`, desc: part.map((e) => `<@${e.user_id}>${e.tickets > 1 ? ` with ${e.tickets} tickets` : ''}`).join('\n'), color: COLOR })));
      }),
      sub('winnerinfo', 'See who won a giveaway', { check: undefined, perms: [], options: [ID] }, async (ctx) => {
        const g = G.find(ctx, ['ended']);
        await ctx.reply(ui.card({ icon: '🏆', title: truncate(g.prize, 200), desc: g.winner_ids.length ? g.winner_ids.map((w) => `<@${w}>`).join('\n') : 'Nobody entered.', hint: `Giveaway ${g.id}`, color: ui.colors.matcha }));
      }),

      adminSub('role', 'requirements', 'Require a role to enter (default for new giveaways)', { options: [{ name: 'role', type: 'role', description: 'Leave empty to remove the requirement' }] }, async (ctx) => {
        const r = ctx.role('role'); G.saveCfg(ctx.guild.id, { role: r ? r.id : null });
        await ctx.reply(r ? ui.ok('Role requirement set', `New giveaways need ${r}.`) : ui.ok('Role requirement removed'));
      }),
      adminSub('invites', 'requirements', 'Require a number of invites to enter (default for new giveaways)', { options: [{ name: 'count', type: 'int', required: true, min: 0, max: 1000, description: '0 removes the requirement' }] }, async (ctx) => {
        G.saveCfg(ctx.guild.id, { invites: ctx.int('count') });
        await ctx.reply(ctx.int('count') ? ui.ok('Invite requirement set', `New giveaways need **${ctx.int('count')}** invites.`) : ui.ok('Invite requirement removed'));
      }),
      adminSub('bonusrole', 'requirements', 'Give a role extra entries', { options: [{ name: 'role', type: 'role', required: true, description: 'Which role' }, { name: 'entries', type: 'int', required: true, min: 1, max: 50, description: 'Extra entries' }] }, async (ctx) => {
        const c = G.cfg(ctx.guild.id);
        const bonus = c.bonus.filter((b) => b.role !== ctx.role('role').id).concat({ role: ctx.role('role').id, entries: ctx.int('entries') });
        G.saveCfg(ctx.guild.id, { bonus });
        await ctx.reply(ui.ok('Bonus role saved', `${ctx.role('role')} now gets **+${ctx.int('entries')}** extra entries.`));
      }),
      adminSub('bonuses', 'requirements', 'List bonus entry roles', {}, async (ctx) => {
        const c = G.cfg(ctx.guild.id);
        await ctx.reply(ui.card({ icon: '🎁', title: 'Bonus entries', desc: c.bonus.length ? c.bonus.map((b) => `<@&${b.role}> gets +${b.entries}`).join('\n') : 'No bonus roles yet.', hint: 'Add one with /giveaway requirements bonusrole.', color: COLOR }));
      }),
      adminSub('delbonus', 'requirements', 'Remove a bonus entry role', { options: [{ name: 'role', type: 'role', required: true, description: 'Which role' }] }, async (ctx) => {
        const c = G.cfg(ctx.guild.id);
        if (!c.bonus.some((b) => b.role === ctx.role('role').id)) throw new UserError('Not a bonus role', `${ctx.role('role')} does not have bonus entries.`);
        G.saveCfg(ctx.guild.id, { bonus: c.bonus.filter((b) => b.role !== ctx.role('role').id) });
        await ctx.reply(ui.ok('Bonus role removed', `${ctx.role('role')} no longer gets extra entries.`));
      }),

      adminSub('add', 'blacklist', 'Block a member from giveaways', { options: [{ name: 'user', type: 'user', required: true, description: 'Who to block' }] }, async (ctx) => {
        const c = G.cfg(ctx.guild.id); const u = ctx.user('user');
        if (!c.blacklist.includes(u.id)) c.blacklist.push(u.id);
        G.saveCfg(ctx.guild.id, { blacklist: c.blacklist });
        await ctx.reply(ui.ok(`Blocked ${u.username}`, 'They can no longer enter giveaways here.'));
      }),
      adminSub('remove', 'blacklist', 'Let a blocked member enter again', { options: [{ name: 'user', type: 'user', required: true, description: 'Who to unblock' }] }, async (ctx) => {
        const c = G.cfg(ctx.guild.id); const u = ctx.user('user');
        if (!c.blacklist.includes(u.id)) throw new UserError('Not blocked', `${u.username} is not on the list.`);
        G.saveCfg(ctx.guild.id, { blacklist: c.blacklist.filter((x) => x !== u.id) });
        await ctx.reply(ui.ok(`Unblocked ${u.username}`, 'They can enter giveaways again.'));
      }),
      adminSub('list', 'blacklist', 'See blocked members', {}, async (ctx) => {
        const c = G.cfg(ctx.guild.id);
        await ctx.reply(ui.card({ icon: '🚫', title: 'Blocked from giveaways', desc: c.blacklist.length ? c.blacklist.map((id) => `<@${id}>`).join('\n') : 'Nobody is blocked.', color: COLOR }));
      }),

      adminSub('save', 'template', 'Save a giveaway preset', { options: [
        { name: 'name', type: 'string', required: true, max: 30, description: 'Preset name' }, { name: 'prize', type: 'string', required: true, max: 200, description: 'Prize' },
        { name: 'duration', type: 'string', required: true, description: 'Like 1d' }, { name: 'winners', type: 'int', min: 1, max: 20, description: 'Winners (default 1)' }] }, async (ctx) => {
        dur(ctx);
        const c = G.cfg(ctx.guild.id);
        const name = ctx.str('name').toLowerCase();
        G.saveCfg(ctx.guild.id, { templates: { ...c.templates, [name]: { prize: ctx.str('prize'), duration: ctx.str('duration'), winners: ctx.int('winners') || 1 } } });
        await ctx.reply(ui.ok('Preset saved', `Start it any time with /giveaway template use ${name}.`));
      }),
      adminSub('list', 'template', 'See saved presets', {}, async (ctx) => {
        const t = Object.entries(G.cfg(ctx.guild.id).templates);
        await ctx.reply(ui.card({ icon: '🎁', title: 'Giveaway presets', desc: t.length ? t.map(([n, v]) => `**${n}**: ${truncate(v.prize, 50)}, ${v.winners} ${v.winners === 1 ? 'winner' : 'winners'}, ${v.duration}`).join('\n') : 'No presets yet.', color: COLOR }));
      }),
      adminSub('delete', 'template', 'Delete a preset', { options: [{ name: 'name', type: 'string', required: true, description: 'Preset name' }] }, async (ctx) => {
        const c = G.cfg(ctx.guild.id); const name = ctx.str('name').toLowerCase();
        if (!c.templates[name]) throw new UserError('Preset not found', `There is no preset called "${name}".`, 'See /giveaway template list.');
        delete c.templates[name]; G.saveCfg(ctx.guild.id, { templates: c.templates });
        await ctx.reply(ui.ok('Preset deleted', name));
      }),
      adminSub('use', 'template', 'Start a giveaway from a preset', { check: isManager, options: [{ name: 'name', type: 'string', required: true, description: 'Preset name' }, { name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Where to post it' }] }, async (ctx) => {
        const t = G.cfg(ctx.guild.id).templates[ctx.str('name').toLowerCase()];
        if (!t) throw new UserError('Preset not found', `There is no preset called "${ctx.str('name')}".`, 'See /giveaway template list.');
        const ch = ctx.chan('channel') || ctx.channel;
        const { g, msg } = await G.start(ctx.client, ctx.guild, { channel: ch, host: ctx.author, prize: t.prize, winners: t.winners, durationMs: parseDuration(t.duration), req: {} });
        await ctx.reply(ui.ok('Giveaway started', `**${truncate(g.prize, 80)}** is live in ${ch}.`, { hint: msg.url }), { ephemeral: true });
      }),

      adminSub('view', 'settings', 'See all giveaway settings', {}, async (ctx) => {
        const c = G.cfg(ctx.guild.id);
        await ctx.reply(ui.card({
          icon: '🎁', title: 'Giveaway settings', color: COLOR,
          desc: ui.kv([['Channel', c.channel ? `<#${c.channel}>` : 'Where the command is used'], ['Manager role', c.manager ? `<@&${c.manager}>` : 'Only Manage Server'], ['Ping', c.ping ? (c.ping === 'everyone' || c.ping === 'here' ? `@${c.ping}` : `<@&${c.ping}>`) : 'Nobody'], ['Partner server', c.partner || 'None'],
            ['Default role', c.role ? `<@&${c.role}>` : 'None'], ['Default invites', c.invites || 'None'], ['Bonus roles', c.bonus.length], ['Blocked members', c.blacklist.length], ['Presets', Object.keys(c.templates).length]]),
        }));
      }),
      adminSub('channel', 'settings', 'Choose where giveaways are posted by default', { options: [{ name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Leave empty to post where the command is used' }] }, async (ctx) => {
        const ch = ctx.chan('channel'); G.saveCfg(ctx.guild.id, { channel: ch ? ch.id : null });
        await ctx.reply(ch ? ui.ok('Giveaway channel set', `New giveaways go to ${ch}.`) : ui.ok('Giveaway channel cleared', 'They post where the command is used.'));
      }),
      adminSub('manager', 'settings', 'Let a role run giveaways without Manage Server', { options: [{ name: 'role', type: 'role', description: 'Leave empty to remove' }] }, async (ctx) => {
        const r = ctx.role('role'); G.saveCfg(ctx.guild.id, { manager: r ? r.id : null });
        await ctx.reply(r ? ui.ok('Manager role set', `${r} can now start, end and reroll giveaways.`) : ui.ok('Manager role removed'));
      }),
      adminSub('ping', 'settings', 'Ping a role when a giveaway starts', { options: [{ name: 'target', type: 'string', choices: [['@everyone', 'everyone'], ['@here', 'here'], ['Nobody', 'none']], description: 'Who to ping' }, { name: 'role', type: 'role', description: 'Or pick a role' }] }, async (ctx) => {
        const r = ctx.role('role'); const t = ctx.str('target');
        const value = r ? r.id : t && t !== 'none' ? t : null;
        G.saveCfg(ctx.guild.id, { ping: value });
        await ctx.reply(value ? ui.ok('Ping set', `New giveaways will ping ${r || `@${t}`}.`) : ui.ok('Ping removed', 'Giveaways start quietly.'));
      }),
      adminSub('partner', 'settings', 'Require a partner server for entry', { options: [{ name: 'server_id', type: 'string', description: 'Server ID. Leave empty to remove. I must be in it too' }] }, async (ctx) => {
        const id = ctx.str('server_id');
        if (id && !ID_RE.test(id)) throw new UserError('Invalid server ID', 'Server IDs are long numbers.', 'Enable Developer Mode, right-click the server icon, Copy Server ID.');
        G.saveCfg(ctx.guild.id, { partner: id || null });
        await ctx.reply(id ? ui.ok('Partner server set', 'New giveaways require membership there. I must be in that server to check it.') : ui.ok('Partner requirement removed'));
      }),
    ],
  }],
};
