const { UserError } = require('../core/context');
const { chunk, ts } = require('../core/util');
const { paginate } = require('../core/pager');
const { db } = require('../core/db');
const I = require('../core/invites');
const ui = require('../core/ui');

const COLOR = ui.colors.sky;
const USER = { name: 'user', type: 'user', description: 'Defaults to you' };
const pub = (name, description, options, run) => ({ name, description, perms: [], options, run });
const adm = (name, group, description, options, run) => ({ name, group, description, perms: ['ManageGuild'], options, run });
const AMOUNT = { name: 'amount', type: 'int', required: true, min: 1, max: 10000, description: 'How many' };

module.exports = {
  category: { key: 'invites', label: 'Invites', emoji: '📨', desc: 'Invite tracking, leaderboard and reward roles', color: COLOR },
  commands: [{
    name: 'invites', description: 'Invite tracker',
    defaultSub: 'view',
    aliases: ['inv'],
    groups: { manage: 'Add or remove invites', rank: 'Reward roles for reaching invite counts', blacklist: 'Ignore invites from certain members', setup: 'Invite tracker setup' },
    subs: [
      pub('view', "See someone's invites", [USER], async (ctx) => {
        const u = ctx.user('user') || ctx.author;
        const s = I.statsOf(ctx.guild.id, u.id);
        await ctx.reply(ui.card({
          icon: '📨', title: `${u.username} has ${s.total} ${s.total === 1 ? 'invite' : 'invites'}`, color: COLOR, thumb: u.displayAvatarURL(),
          desc: ui.kv([['Joined', s.regular], ['Left', s.leaves], ['Fake', s.fake], ['Bonus', s.bonus]]),
        }));
      }),
      pub('inviter', 'See who invited a member', [USER], async (ctx) => {
        const u = ctx.user('user') || ctx.author;
        const row = db.prepare('SELECT * FROM invite_members WHERE guild_id = ? AND member_id = ?').get(ctx.guild.id, u.id);
        if (!row) throw new UserError('No record', `I do not know who invited ${u.username}.`, 'I only track people who joined after I was added.');
        await ctx.reply(ui.card({ icon: '📨', title: `${u.username} was invited by ${row.inviter_id ? '' : 'someone unknown'}`.trim(), desc: ui.kv([['Inviter', row.inviter_id ? `<@${row.inviter_id}>` : null], ['Link', row.code ? `\`${row.code}\`` : null], ['Joined', ts(row.joined_at)]]), color: COLOR }));
      }),
      pub('invited', 'See who a member invited', [USER], async (ctx) => {
        const u = ctx.user('user') || ctx.author;
        const rows = db.prepare('SELECT * FROM invite_members WHERE guild_id = ? AND inviter_id = ? ORDER BY joined_at DESC').all(ctx.guild.id, u.id);
        if (!rows.length) return ctx.reply(ui.card({ icon: '🌷', title: `${u.username} has not invited anyone yet`, desc: 'Share an invite link to get started.', color: COLOR }));
        await paginate(ctx, chunk(rows, 12).map((part) => ui.card({ icon: '📨', title: `People ${u.username} invited (${rows.length})`, desc: part.map((r) => `<@${r.member_id}> ${r.left ? '(left)' : ''}${r.fake ? ' (fake)' : ''}`).join('\n'), color: COLOR })));
      }),
      pub('leaderboard', 'The top inviters', [], async (ctx) => {
        const rows = db.prepare('SELECT *, (regular + bonus - leaves - fake) AS total FROM invite_stats WHERE guild_id = ? AND (regular + bonus - leaves - fake) > 0 ORDER BY total DESC LIMIT 50').all(ctx.guild.id);
        if (!rows.length) return ctx.reply(ui.card({ icon: '🌷', title: 'Nobody has invites yet', desc: 'Invite friends to claim the first spot!', color: COLOR }));
        const medals = ['🥇', '🥈', '🥉'];
        let n = 0;
        await paginate(ctx, chunk(rows, 10).map((part) => ui.card({ icon: '🏆', title: 'Invite leaderboard', desc: part.map((r) => `${medals[n] || `**${n + 1}.**`} <@${r.user_id}> with **${r.total}** ${(n++, '')}`).join('\n'), color: COLOR })));
      }),
      pub('codes', 'See the invite links someone created', [USER], async (ctx) => {
        const u = ctx.user('user') || ctx.author;
        const all = await ctx.guild.invites.fetch().catch(() => null);
        if (!all) throw new UserError('I cannot see invites', 'I need the **Manage Server** permission to list invite links.');
        const mine = [...all.values()].filter((i) => i.inviterId === u.id);
        await ctx.reply(ui.card({ icon: '🔗', title: `${u.username}'s links`, color: COLOR, desc: mine.length ? mine.slice(0, 15).map((i) => `\`${i.code}\` in <#${i.channelId}> with ${i.uses ?? 0} uses`).join('\n') : 'No active invite links.' }));
      }),
      pub('stats', 'Server-wide invite numbers', [], async (ctx) => {
        const t = db.prepare('SELECT COUNT(*) AS inviters, COALESCE(SUM(regular),0) AS regular, COALESCE(SUM(fake),0) AS fake, COALESCE(SUM(leaves),0) AS leaves FROM invite_stats WHERE guild_id = ?').get(ctx.guild.id);
        await ctx.reply(ui.card({ icon: '📊', title: 'Invite stats', color: COLOR, desc: ui.kv([['Inviters', t.inviters], ['Joins tracked', t.regular], ['Left since', t.leaves], ['Fake', t.fake]]) }));
      }),
      { ...pub('vanity', 'See how often the vanity link was used', [], async (ctx) => {
        const v = await ctx.guild.fetchVanityData().catch(() => null);
        if (!v?.code) throw new UserError('No vanity link', 'This server does not have a vanity URL.');
        await ctx.reply(ui.card({ icon: '✨', title: `discord.gg/${v.code}`, desc: `Used **${v.uses}** times.`, color: COLOR }));
      }) },
      adm('sync', null, 'Refresh my list of invite links', [], async (ctx) => {
        const map = await I.snapshot(ctx.guild);
        if (!map) throw new UserError('I cannot see invites', 'I need the **Manage Server** permission to track invites.', 'Give me Manage Server, then run this again.');
        await ctx.reply(ui.ok('Invite links refreshed', `Tracking **${map.size}** links.`));
      }),
      adm('settings', null, 'See invite tracker settings', [], async (ctx) => {
        const c = I.cfg(ctx.guild.id);
        await ctx.reply(ui.card({ icon: '📨', title: 'Invite tracker settings', color: COLOR, desc: ui.kv([['Log channel', c.channel ? `<#${c.channel}>` : 'Not set'], ['Join and leave messages', c.log ? 'On' : 'Off'], ['Fake after', c.minAge ? `accounts younger than ${c.minAge} days` : 'Off'], ['Reward roles', c.ranks.length], ['Ignored inviters', c.blacklist.length]]) }));
      }),

      adm('add', 'manage', 'Give someone bonus invites', [{ name: 'user', type: 'user', required: true, description: 'Who' }, AMOUNT], async (ctx) => {
        I.bump(ctx.guild.id, ctx.user('user').id, 'bonus', ctx.int('amount'));
        await I.applyRanks(ctx.guild, ctx.user('user').id);
        await ctx.reply(ui.ok('Bonus invites added', `${ctx.user('user')} now has **${I.statsOf(ctx.guild.id, ctx.user('user').id).total}** invites.`));
      }),
      adm('remove', 'manage', 'Take bonus invites away', [{ name: 'user', type: 'user', required: true, description: 'Who' }, AMOUNT], async (ctx) => {
        I.bump(ctx.guild.id, ctx.user('user').id, 'bonus', -ctx.int('amount'));
        await ctx.reply(ui.ok('Bonus invites removed', `${ctx.user('user')} now has **${I.statsOf(ctx.guild.id, ctx.user('user').id).total}** invites.`));
      }),
      adm('reset', 'manage', "Reset one member's invites to zero", [{ name: 'user', type: 'user', required: true, description: 'Who' }], async (ctx) => {
        db.prepare('DELETE FROM invite_stats WHERE guild_id = ? AND user_id = ?').run(ctx.guild.id, ctx.user('user').id);
        await ctx.reply(ui.ok('Invites reset', `${ctx.user('user')} is back to zero.`));
      }),
      adm('resetall', 'manage', 'Reset everyone to zero', [{ name: 'confirm', type: 'bool', required: true, description: 'Set to true to confirm' }], async (ctx) => {
        if (!ctx.bool('confirm')) throw new UserError('Cancelled', 'Nothing was reset.', 'Run it again with confirm set to true.');
        db.prepare('DELETE FROM invite_stats WHERE guild_id = ?').run(ctx.guild.id);
        await ctx.reply(ui.ok('All invites reset', 'The leaderboard is clean.'));
      }),

      adm('set', 'rank', 'Give a role when someone reaches an invite count', [{ name: 'role', type: 'role', required: true, description: 'The reward role' }, { name: 'count', type: 'int', required: true, min: 1, max: 10000, description: 'Invites needed' }], async (ctx) => {
        const c = I.cfg(ctx.guild.id);
        I.saveCfg(ctx.guild.id, { ranks: c.ranks.filter((r) => r.role !== ctx.role('role').id).concat({ role: ctx.role('role').id, count: ctx.int('count') }).sort((a, b) => a.count - b.count) });
        await ctx.reply(ui.ok('Reward role saved', `${ctx.role('role')} is given at **${ctx.int('count')}** invites.`));
      }),
      adm('remove', 'rank', 'Stop rewarding a role', [{ name: 'role', type: 'role', required: true, description: 'The reward role' }], async (ctx) => {
        const c = I.cfg(ctx.guild.id);
        if (!c.ranks.some((r) => r.role === ctx.role('role').id)) throw new UserError('Not a reward role', `${ctx.role('role')} is not an invite reward.`);
        I.saveCfg(ctx.guild.id, { ranks: c.ranks.filter((r) => r.role !== ctx.role('role').id) });
        await ctx.reply(ui.ok('Reward role removed', `${ctx.role('role')} is no longer given.`));
      }),
      adm('list', 'rank', 'See invite reward roles', [], async (ctx) => {
        const c = I.cfg(ctx.guild.id);
        await ctx.reply(ui.card({ icon: '🎖️', title: 'Invite rewards', color: COLOR, desc: c.ranks.length ? c.ranks.map((r) => `**${r.count}** invites: <@&${r.role}>`).join('\n') : 'No reward roles yet.', hint: 'Add one with /invites rank set.' }));
      }),

      adm('add', 'blacklist', "Stop counting a member's invites", [{ name: 'user', type: 'user', required: true, description: 'Who' }], async (ctx) => {
        const c = I.cfg(ctx.guild.id);
        if (!c.blacklist.includes(ctx.user('user').id)) c.blacklist.push(ctx.user('user').id);
        I.saveCfg(ctx.guild.id, { blacklist: c.blacklist });
        await ctx.reply(ui.ok('Invites ignored', `${ctx.user('user')} will not earn invites from now on.`));
      }),
      adm('remove', 'blacklist', 'Count a member\'s invites again', [{ name: 'user', type: 'user', required: true, description: 'Who' }], async (ctx) => {
        const c = I.cfg(ctx.guild.id);
        I.saveCfg(ctx.guild.id, { blacklist: c.blacklist.filter((x) => x !== ctx.user('user').id) });
        await ctx.reply(ui.ok('Invites counted again', `${ctx.user('user')} earns invites again.`));
      }),
      adm('list', 'blacklist', 'See ignored inviters', [], async (ctx) => {
        const c = I.cfg(ctx.guild.id);
        await ctx.reply(ui.card({ icon: '🚫', title: 'Ignored inviters', desc: c.blacklist.length ? c.blacklist.map((id) => `<@${id}>`).join('\n') : 'Nobody is ignored.', color: COLOR }));
      }),

      adm('channel', 'setup', 'Choose where join and leave messages go', [{ name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Leave empty to turn off' }], async (ctx) => {
        const ch = ctx.chan('channel');
        I.saveCfg(ctx.guild.id, { channel: ch ? ch.id : null, log: Boolean(ch) });
        await ctx.reply(ch ? ui.ok('Invite log set', `I will post who invited each member in ${ch}.`, 'Make sure I have Manage Server so I can track links.') : ui.ok('Invite log turned off'));
      }),
      adm('log', 'setup', 'Turn join and leave messages on or off', [{ name: 'enabled', type: 'bool', required: true, description: 'On or off' }], async (ctx) => {
        I.saveCfg(ctx.guild.id, { log: ctx.bool('enabled') });
        await ctx.reply(ui.ok(ctx.bool('enabled') ? 'Join messages on' : 'Join messages off', ctx.bool('enabled') && !I.cfg(ctx.guild.id).channel ? 'Pick a channel with /invites setup channel.' : undefined));
      }),
      adm('minage', 'setup', 'Count accounts younger than N days as fake', [{ name: 'days', type: 'int', required: true, min: 0, max: 365, description: '0 turns it off' }], async (ctx) => {
        I.saveCfg(ctx.guild.id, { minAge: ctx.int('days') });
        await ctx.reply(ui.ok(ctx.int('days') ? 'Fake detection on' : 'Fake detection off', ctx.int('days') ? `Accounts younger than **${ctx.int('days')}** days count as fake invites.` : undefined));
      }),
    ],
  }],
};
