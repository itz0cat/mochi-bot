const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ExplicitContentFilter } = require('discord.js');
const { UserError } = require('../core/context');
const { db } = require('../core/db');
const { truncate } = require('../core/util');
const A = require('../core/automod');
const cases = require('../core/cases');
const ui = require('../core/ui');
const { hierarchyProblem } = require('../core/perms');

const COLOR = ui.colors.lavender;
const ENABLED = { name: 'enabled', type: 'bool', required: true, description: 'Turn it on or off' };
const adm = (name, group, description, options, run, extra = {}) => ({ name, group, description, options, run, ...extra });
const dot = (on) => (on ? '🟢' : '⚪');

// Each filter becomes /automod filter <name> enabled:<bool> [settings]
const FILTERS = [
  { key: 'spam', title: 'Spam filter', about: (f) => `Removes anyone sending more than **${f.limit}** messages in **${f.window}** seconds.`, opts: [{ name: 'limit', type: 'int', min: 2, max: 20, description: 'Messages allowed (default 5)' }, { name: 'seconds', type: 'int', min: 2, max: 30, description: 'Per how many seconds (default 5)' }], apply: (ctx, f) => ({ limit: ctx.int('limit') ?? f.limit, window: ctx.int('seconds') ?? f.window }) },
  { key: 'flood', title: 'Repeat filter', about: (f) => `Removes a message repeated **${f.repeats}** times within 30 seconds.`, opts: [{ name: 'repeats', type: 'int', min: 2, max: 10, description: 'How many repeats (default 3)' }], apply: (ctx, f) => ({ repeats: ctx.int('repeats') ?? f.repeats }) },
  { key: 'caps', title: 'Caps filter', about: (f) => `Removes messages that are **${f.pct}%** or more capital letters (at least ${f.min} letters).`, opts: [{ name: 'percent', type: 'int', min: 30, max: 100, description: 'Capital letter percent (default 70)' }, { name: 'min_letters', type: 'int', min: 5, max: 100, description: 'Ignore shorter messages (default 10)' }], apply: (ctx, f) => ({ pct: ctx.int('percent') ?? f.pct, min: ctx.int('min_letters') ?? f.min }) },
  { key: 'invite', title: 'Invite filter', about: () => 'Removes Discord invite links to other servers.', opts: [], apply: () => ({}) },
  { key: 'link', title: 'Link filter', about: () => 'Removes messages containing links.', opts: [], apply: () => ({}) },
  { key: 'massmention', title: 'Mass mention filter', about: (f) => `Removes messages mentioning **${f.limit}** or more people or roles, and @everyone from regular members.`, opts: [{ name: 'limit', type: 'int', min: 2, max: 30, description: 'Mentions allowed (default 5)' }], apply: (ctx, f) => ({ limit: ctx.int('limit') ?? f.limit }) },
  { key: 'zalgo', title: 'Zalgo filter', about: () => 'Removes messages with glitchy zalgo text.', opts: [], apply: () => ({}) },
  { key: 'ghostping', title: 'Ghost ping alerts', about: () => 'Tells the channel when someone mentions people and then deletes the message.', opts: [], apply: () => ({}) },
  { key: 'nsfw', title: 'Explicit media scan', about: () => 'Turns on Discord\'s built-in scan for explicit images from every member.', opts: [], apply: () => ({}) },
  { key: 'alt', title: 'New account filter', about: (f) => `Kicks new members whose account is younger than **${f.days}** days.`, opts: [{ name: 'days', type: 'int', min: 1, max: 365, description: 'Minimum account age in days (default 3)' }], apply: (ctx, f) => ({ days: ctx.int('days') ?? f.days }) },
  { key: 'raid', title: 'Raid detection', about: (f) => `If more than **${f.joins}** people join within **${f.window}** seconds, raid mode turns on and new joins are kicked.`, opts: [{ name: 'joins', type: 'int', min: 3, max: 50, description: 'Joins allowed (default 5)' }, { name: 'seconds', type: 'int', min: 3, max: 60, description: 'Per how many seconds (default 10)' }], apply: (ctx, f) => ({ joins: ctx.int('joins') ?? f.joins, window: ctx.int('seconds') ?? f.window }) },
];

const filterSubs = FILTERS.map((F) => adm(F.key, 'filter', `Turn the ${F.title.toLowerCase()} on or off`, [ENABLED, ...F.opts], async (ctx) => {
  const on = ctx.bool('enabled');
  let note = '';
  if (F.key === 'nsfw') {
    try { await ctx.guild.setExplicitContentFilter(on ? ExplicitContentFilter.AllMembers : ExplicitContentFilter.MembersWithoutRoles, 'Automod explicit media scan'); }
    catch { note = '\n-# I could not change Discord\'s media scan. I need the **Manage Server** permission.'; }
  }
  const cur = A.cfg(ctx.guild.id).filters[F.key];
  const next = { ...cur, ...F.apply(ctx, cur), on };
  A.update(ctx.guild.id, (c) => { c.filters[F.key] = next; });
  const c = A.cfg(ctx.guild.id);
  const punish = ['ghostping', 'nsfw', 'alt', 'raid'].includes(F.key) ? '' : `\n-# Punishment: ${c.action}${c.action === 'timeout' ? ` ${c.timeoutMins}m` : ''}. Change it with /automod action.`;
  await ctx.reply(ui.ok(`${F.title} ${on ? 'on' : 'off'}`, `${on ? F.about(next) : 'It will no longer act.'}${note}${punish}`));
}));

module.exports = {
  category: { key: 'automod', label: 'Automod', emoji: '🛡️', desc: 'Spam, raid and nuke protection, word filter, verification', color: COLOR },
  commands: [{
    name: 'automod', description: 'Automod and server protection', perms: ['ManageGuild'],
    groups: { filter: 'Turn individual filters on or off', words: 'Blocked word list', whitelist: 'Exempt roles, channels and invites', antinuke: 'Stop people from wrecking the server' },
    subs: [
      adm('status', null, 'See what is on and off', [], async (ctx) => {
        const c = A.cfg(ctx.guild.id);
        const lines = FILTERS.map((F) => `${dot(c.filters[F.key].on)} **${F.title}**`);
        lines.splice(FILTERS.length, 0, `${dot(c.filters.words.on)} **Blocked words** (${c.words.length})`);
        await ctx.reply(ui.card({
          icon: '🛡️', title: 'Automod status', color: COLOR, desc: lines.join('\n'),
          fields: [
            { name: 'Punishment', value: c.action === 'timeout' ? `timeout ${c.timeoutMins}m` : c.action },
            { name: 'Raid mode', value: c.raidmode ? 'On' : 'Off' }, { name: 'Panic mode', value: c.panic ? 'On' : 'Off' },
            { name: 'Anti-nuke', value: c.antinuke.on ? `On (${c.antinuke.limit} actions in ${c.antinuke.window}s)` : 'Off' },
          ],
          hint: 'Turn on the basics in one go with /automod setup.',
        }));
      }),
      adm('setup', null, 'One click: turn on a sensible set of protections', [], async (ctx) => {
        A.update(ctx.guild.id, (c) => {
          for (const k of ['spam', 'flood', 'invite', 'massmention', 'caps', 'zalgo', 'ghostping']) c.filters[k].on = true;
          c.filters.raid.on = true;
          if (c.action === 'delete') { c.action = 'timeout'; c.timeoutMins = 10; }
        });
        await ctx.reply(ui.ok('Automod is on', 'I am now watching for spam, repeats, invite links, mass mentions, caps, zalgo, ghost pings and raids. Offenders get a 10 minute timeout.', 'Fine-tune with /automod filter or see everything with /automod status.'));
      }),
      adm('action', null, 'Choose what happens to rule breakers', [{ name: 'punishment', type: 'string', required: true, choices: [['Just delete the message', 'delete'], ['Delete and warn', 'warn'], ['Delete and timeout', 'timeout'], ['Delete and kick', 'kick'], ['Delete and ban', 'ban']], description: 'The punishment' }, { name: 'minutes', type: 'int', min: 1, max: 40320, description: 'Timeout length in minutes (default 10)' }], async (ctx) => {
        A.update(ctx.guild.id, (c) => { c.action = ctx.str('punishment'); if (ctx.int('minutes')) c.timeoutMins = ctx.int('minutes'); });
        const c = A.cfg(ctx.guild.id);
        await ctx.reply(ui.ok('Punishment set', c.action === 'timeout' ? `Rule breakers get a **${c.timeoutMins} minute** timeout.` : `Rule breakers will be: **${c.action}**.`, c.action === 'ban' || c.action === 'kick' ? 'Tip: this is strict. Consider timeout for first offences.' : undefined));
      }),
      adm('panic', null, 'Panic button: lock the server and kick new joins', [ENABLED], async (ctx) => {
        await ctx.defer();
        const r = await A.setPanic(ctx.guild, ctx.bool('enabled'), ctx.author.tag);
        await ctx.reply(ui.card({ icon: ctx.bool('enabled') ? '🚨' : '🌤️', title: ctx.bool('enabled') ? 'Panic mode on' : 'Panic mode off', color: ctx.bool('enabled') ? ui.colors.cherry : ui.colors.matcha, desc: ctx.bool('enabled') ? `Locked **${r.changed}** channels. New members are kicked and members who joined in the last 24 hours cannot chat.` : `Restored **${r.changed}** channels. New members can join again.` }));
      }, { perms: ['Administrator'], botPerms: ['ManageChannels', 'KickMembers'] }),
      adm('raidmode', null, 'Kick everyone who tries to join', [ENABLED], async (ctx) => {
        A.update(ctx.guild.id, (c) => { c.raidmode = ctx.bool('enabled'); });
        await ctx.reply(ui.ok(ctx.bool('enabled') ? 'Raid mode on' : 'Raid mode off', ctx.bool('enabled') ? 'New members will be kicked with a friendly message until you turn this off.' : 'New members can join again.'));
      }, { botPerms: ['KickMembers'] }),
      adm('quarantine', null, 'Strip roles and silence a suspicious member', [{ name: 'user', type: 'user', required: true, description: 'Who to quarantine' }, { name: 'reason', type: 'string', rest: true, max: 300, description: 'Why?' }], async (ctx) => {
        const user = ctx.user('user'); const m = await ctx.member('user');
        if (!m) throw new UserError('Member not found', `${user.username} is not in this server.`);
        const problem = hierarchyProblem(ctx, m, 'quarantine');
        if (problem) throw new UserError("Can't quarantine that member", problem);
        const roles = m.roles.cache.filter((r) => r.id !== ctx.guild.id && !r.managed).map((r) => r.id);
        db.prepare('INSERT OR REPLACE INTO quarantine (guild_id, user_id, roles) VALUES (?, ?, ?)').run(ctx.guild.id, m.id, JSON.stringify(roles));
        await m.roles.remove(roles, `Quarantine by ${ctx.author.tag}`).catch(() => {});
        await m.timeout(28 * 86400000, `Quarantine: ${ctx.str('reason') || 'no reason'}`).catch(() => {});
        const c = await cases.record(ctx.guild, { userId: m.id, modId: ctx.author.id, type: 'quarantine', reason: ctx.str('reason') || 'No reason given' });
        await ctx.reply(ui.card({ icon: '🧊', title: `Quarantined ${user.username}`, desc: `Their ${roles.length} roles were saved and removed, and they are silenced.`, hint: `Case ${c.num}. Undo with /automod unquarantine.`, color: COLOR }));
      }, { perms: ['ModerateMembers'], botPerms: ['ManageRoles', 'ModerateMembers'] }),
      adm('unquarantine', null, 'Give a quarantined member their roles back', [{ name: 'user', type: 'user', required: true, description: 'Who to release' }], async (ctx) => {
        const user = ctx.user('user'); const m = await ctx.member('user');
        const row = db.prepare('SELECT * FROM quarantine WHERE guild_id = ? AND user_id = ?').get(ctx.guild.id, user.id);
        if (!m || !row) throw new UserError('Not quarantined', `${user.username} is not in quarantine.`);
        const roles = JSON.parse(row.roles || '[]').filter((id) => ctx.guild.roles.cache.has(id));
        await m.roles.add(roles, `Released by ${ctx.author.tag}`).catch(() => {});
        await m.timeout(null).catch(() => {});
        db.prepare('DELETE FROM quarantine WHERE guild_id = ? AND user_id = ?').run(ctx.guild.id, user.id);
        await ctx.reply(ui.ok(`Released ${user.username}`, `Gave back **${roles.length}** roles and removed the timeout.`));
      }, { perms: ['ModerateMembers'], botPerms: ['ManageRoles', 'ModerateMembers'] }),
      adm('verify', null, 'Post a verification button that gives a role', [{ name: 'role', type: 'role', description: 'Role to give (leave empty to create "Verified")' }, { name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Where to post it (defaults to here)' }], async (ctx) => {
        const role = ctx.role('role') || (await ctx.guild.roles.create({ name: 'Verified', color: 0xa8e6cf, reason: 'Verification setup' }));
        const ch = ctx.chan('channel') || ctx.channel;
        A.update(ctx.guild.id, (c) => { c.verify.role = role.id; });
        await ch.send({
          embeds: [ui.card({ icon: '✅', title: 'Verify to join the server', desc: 'Press the button below to prove you are human and unlock the server.', color: ui.colors.matcha })],
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify:go').setLabel('Verify me').setEmoji('🌸').setStyle(ButtonStyle.Success))],
        });
        await ctx.reply(ui.ok('Verification is ready', `Pressing the button gives ${role}.`, `Last step: make your channels visible only to ${role.name} in the channel permissions.`), { ephemeral: true });
      }, { botPerms: ['ManageRoles', 'SendMessages'] }),
      adm('reset', null, 'Reset all automod settings', [{ name: 'confirm', type: 'bool', required: true, description: 'Set to true to confirm' }], async (ctx) => {
        if (!ctx.bool('confirm')) throw new UserError('Cancelled', 'Nothing was changed.', 'Run it again with confirm set to true.');
        A.save(ctx.guild.id, A.defaults);
        await ctx.reply(ui.ok('Automod reset', 'Everything is back to the defaults (all off).'));
      }),

      ...filterSubs,
      adm('words', 'filter', 'Turn the blocked word filter on or off', [ENABLED], async (ctx) => {
        A.update(ctx.guild.id, (c) => { c.filters.words.on = ctx.bool('enabled'); });
        const n = A.cfg(ctx.guild.id).words.length;
        await ctx.reply(ui.ok(`Word filter ${ctx.bool('enabled') ? 'on' : 'off'}`, ctx.bool('enabled') ? `Watching for **${n}** blocked ${n === 1 ? 'word' : 'words'}.` : 'Blocked words are allowed again.', n === 0 && ctx.bool('enabled') ? 'Add words with /automod words add.' : undefined));
      }),

      adm('add', 'words', 'Block a word or phrase', [{ name: 'word', type: 'string', required: true, max: 60, description: 'The word or phrase' }], async (ctx) => {
        const w = ctx.str('word').toLowerCase().trim();
        A.update(ctx.guild.id, (c) => { if (!c.words.includes(w)) c.words.push(w); c.filters.words.on = true; });
        await ctx.reply(ui.ok('Word blocked', `"${truncate(w, 40)}" is now blocked and the word filter is on.`), { ephemeral: true });
      }),
      adm('remove', 'words', 'Unblock a word', [{ name: 'word', type: 'string', required: true, description: 'The word or phrase' }], async (ctx) => {
        const w = ctx.str('word').toLowerCase().trim();
        if (!A.cfg(ctx.guild.id).words.includes(w)) throw new UserError('Not on the list', `"${truncate(w, 40)}" is not blocked.`);
        A.update(ctx.guild.id, (c) => { c.words = c.words.filter((x) => x !== w); });
        await ctx.reply(ui.ok('Word unblocked', `"${truncate(w, 40)}" is allowed again.`), { ephemeral: true });
      }),
      adm('list', 'words', 'See blocked words', [], async (ctx) => {
        const w = A.cfg(ctx.guild.id).words;
        await ctx.reply(ui.card({ icon: '🚫', title: 'Blocked words', desc: w.length ? w.map((x) => `||${x}||`).join(', ') : 'No blocked words yet.', hint: 'Words are hidden behind spoilers.', color: COLOR }), { ephemeral: true });
      }),

      adm('channel', 'whitelist', 'Exempt a channel from automod', [{ name: 'channel', type: 'channel', required: true, channelTypes: ['text', 'news', 'voice'], description: 'The channel' }], async (ctx) => {
        A.update(ctx.guild.id, (c) => { if (!c.whitelist.channels.includes(ctx.chan('channel').id)) c.whitelist.channels.push(ctx.chan('channel').id); });
        await ctx.reply(ui.ok('Channel exempt', `${ctx.chan('channel')} is ignored by automod.`));
      }),
      adm('role', 'whitelist', 'Exempt a role from automod', [{ name: 'role', type: 'role', required: true, description: 'The role' }], async (ctx) => {
        A.update(ctx.guild.id, (c) => { if (!c.whitelist.roles.includes(ctx.role('role').id)) c.whitelist.roles.push(ctx.role('role').id); });
        await ctx.reply(ui.ok('Role exempt', `Members with ${ctx.role('role')} are ignored by automod.`));
      }),
      adm('invite', 'whitelist', 'Allow a specific invite code', [{ name: 'code', type: 'string', required: true, max: 40, description: 'The invite code, like abc123' }], async (ctx) => {
        const code = ctx.str('code').toLowerCase().replace(/^.*\//, '');
        A.update(ctx.guild.id, (c) => { if (!c.whitelist.invites.includes(code)) c.whitelist.invites.push(code); });
        await ctx.reply(ui.ok('Invite allowed', `\`${code}\` will not be removed.`));
      }),
      adm('remove', 'whitelist', 'Remove something from the exempt list', [{ name: 'channel', type: 'channel', channelTypes: ['text', 'news', 'voice'], description: 'A channel' }, { name: 'role', type: 'role', description: 'Or a role' }, { name: 'invite', type: 'string', description: 'Or an invite code' }], async (ctx) => {
        if (!ctx.chan('channel') && !ctx.role('role') && !ctx.str('invite')) throw new UserError('Nothing selected', 'Pick a channel, a role or an invite code to remove.');
        A.update(ctx.guild.id, (c) => {
          if (ctx.chan('channel')) c.whitelist.channels = c.whitelist.channels.filter((x) => x !== ctx.chan('channel').id);
          if (ctx.role('role')) c.whitelist.roles = c.whitelist.roles.filter((x) => x !== ctx.role('role').id);
          if (ctx.str('invite')) c.whitelist.invites = c.whitelist.invites.filter((x) => x !== ctx.str('invite').toLowerCase());
        });
        await ctx.reply(ui.ok('Removed from the exempt list'));
      }),
      adm('list', 'whitelist', 'See everything that is exempt', [], async (ctx) => {
        const w = A.cfg(ctx.guild.id).whitelist;
        await ctx.reply(ui.card({ icon: '🤍', title: 'Exempt from automod', color: COLOR, desc: ui.kv([['Channels', w.channels.map((x) => `<#${x}>`).join(' ') || 'None'], ['Roles', w.roles.map((x) => `<@&${x}>`).join(' ') || 'None'], ['Invite codes', w.invites.map((x) => `\`${x}\``).join(' ') || 'None']]) }));
      }),

      adm('toggle', 'antinuke', 'Turn anti-nuke on or off', [ENABLED], async (ctx) => {
        A.update(ctx.guild.id, (c) => { c.antinuke.on = ctx.bool('enabled'); });
        const n = A.cfg(ctx.guild.id).antinuke;
        await ctx.reply(ui.ok(`Anti-nuke ${ctx.bool('enabled') ? 'on' : 'off'}`, ctx.bool('enabled') ? `Anyone who deletes channels or roles, or bans and kicks members, **${n.limit}** times in **${n.window}** seconds is banned.` : 'I will no longer watch for destructive actions.', ctx.bool('enabled') ? 'I need View Audit Log and Ban Members. The owner and trusted members are never punished.' : undefined));
      }, { perms: ['Administrator'], botPerms: ['ViewAuditLog', 'BanMembers'] }),
      adm('limits', 'antinuke', 'Set how many actions trigger anti-nuke', [{ name: 'actions', type: 'int', required: true, min: 2, max: 20, description: 'Destructive actions allowed' }, { name: 'seconds', type: 'int', min: 5, max: 300, description: 'Within how many seconds (default 30)' }], async (ctx) => {
        A.update(ctx.guild.id, (c) => { c.antinuke.limit = ctx.int('actions'); if (ctx.int('seconds')) c.antinuke.window = ctx.int('seconds'); });
        const n = A.cfg(ctx.guild.id).antinuke;
        await ctx.reply(ui.ok('Anti-nuke limits set', `**${n.limit}** actions in **${n.window}** seconds triggers a ban.`));
      }, { perms: ['Administrator'] }),
      adm('trust', 'antinuke', 'Never punish a member with anti-nuke', [{ name: 'user', type: 'user', required: true, description: 'Who to trust' }, { name: 'trusted', type: 'bool', description: 'Trust (default) or stop trusting' }], async (ctx) => {
        const id = ctx.user('user').id; const trust = ctx.bool('trusted') ?? true;
        A.update(ctx.guild.id, (c) => { c.antinuke.trusted = trust ? [...new Set([...c.antinuke.trusted, id])] : c.antinuke.trusted.filter((x) => x !== id); });
        await ctx.reply(ui.ok(trust ? 'Member trusted' : 'Trust removed', `${ctx.user('user')} ${trust ? 'can now do destructive actions without anti-nuke stepping in' : 'is watched like everyone else'}.`));
      }, { perms: ['Administrator'] }),
    ],
  }],
};
