const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { UserError } = require('../core/context');
const { parseDuration, fmtDuration, parseColor, chunk, idsFrom, truncate, ts } = require('../core/util');
const { paginate } = require('../core/pager');
const { db, kv } = require('../core/db');
const scheduler = require('../core/scheduler');
const ui = require('../core/ui');

const COLOR = ui.colors.lavender;
const adm = (name, group, description, options, run, extra = {}) => ({ name, group, description, options, run, ...extra });
const ROLE = (d = 'Which role') => ({ name: 'role', type: 'role', required: true, description: d });
const USER = (d = 'Which member') => ({ name: 'user', type: 'user', required: true, description: d });

function assignable(ctx, role) {
  if (role.managed || role.id === ctx.guild.id) throw new UserError('Cannot use that role', `${role} is managed by Discord or an integration, so it cannot be given out.`);
  if (role.position >= ctx.guild.members.me.roles.highest.position) throw new UserError('That role is above mine', `I can only manage roles below my own role.`, 'Drag my role higher in Server Settings > Roles.');
  if (ctx.me.id !== ctx.guild.ownerId && role.position >= ctx.me.roles.highest.position) throw new UserError('That role is above yours', 'You can only give out roles below your own top role.');
}

scheduler.on('role_remove', async (client, row) => {
  const guild = client.guilds.cache.get(row.guild_id);
  const member = guild && (await guild.members.fetch(row.target_id).catch(() => null));
  await member?.roles.remove(row.data.roleId, 'Temporary role ended').catch(() => {});
});

const buildPanelRoles = (ctx, text) => {
  const roles = [...new Set(idsFrom(text, 'role'))].map((id) => ctx.guild.roles.cache.get(id)).filter(Boolean);
  if (!roles.length) throw new UserError('No roles found', 'Mention the roles in the order you want them, like @Gamer @Artist.');
  if (roles.length > 10) throw new UserError('Too many roles', 'A panel can hold up to 10 roles.');
  roles.forEach((r) => assignable(ctx, r));
  return roles;
};

module.exports = {
  category: { key: 'role', label: 'Roles', emoji: '🎭', desc: 'Give roles, temp roles, sticky roles and self-assign panels', color: COLOR },
  commands: [{
    name: 'role', description: 'Manage roles', perms: ['ManageRoles'], botPerms: ['ManageRoles'],
    groups: { sticky: 'Roles that come back when a member rejoins', panel: 'Let members pick their own roles' },
    subs: [
      adm('add', null, 'Give a member a role', [USER(), ROLE()], async (ctx) => {
        const m = await ctx.member('user'); const role = ctx.role('role');
        if (!m) throw new UserError('Member not found', 'That user is not in this server.');
        assignable(ctx, role);
        if (m.roles.cache.has(role.id)) throw new UserError('Already has it', `${m} already has ${role}.`);
        await m.roles.add(role, `By ${ctx.author.tag}`);
        await ctx.reply(ui.ok('Role added', `${m} now has ${role}.`));
      }),
      adm('remove', null, 'Take a role from a member', [USER(), ROLE()], async (ctx) => {
        const m = await ctx.member('user'); const role = ctx.role('role');
        if (!m) throw new UserError('Member not found', 'That user is not in this server.');
        assignable(ctx, role);
        if (!m.roles.cache.has(role.id)) throw new UserError("They don't have it", `${m} does not have ${role}.`);
        await m.roles.remove(role, `By ${ctx.author.tag}`);
        await ctx.reply(ui.ok('Role removed', `${m} no longer has ${role}.`));
      }),
      adm('all', null, 'Give a role to everyone (or all humans or bots)', [ROLE(), { name: 'who', type: 'string', choices: [['Everyone', 'all'], ['Only humans', 'humans'], ['Only bots', 'bots']], description: 'Who gets it (default everyone)' }], async (ctx) => {
        const role = ctx.role('role'); assignable(ctx, role);
        await ctx.defer();
        const all = await ctx.guild.members.fetch();
        const who = ctx.str('who') || 'all';
        const targets = [...all.values()].filter((m) => !m.roles.cache.has(role.id) && (who === 'all' || (who === 'bots') === m.user.bot)).slice(0, 2000);
        if (!targets.length) throw new UserError('Nothing to do', 'Everyone already has that role.');
        await ctx.reply(ui.card({ icon: '⏳', title: `Adding ${role.name} to ${targets.length} members`, desc: 'This can take a while on big servers. I will tell you when it is done.', color: COLOR }));
        let done = 0;
        for (const m of targets) { if (await m.roles.add(role, `Role all by ${ctx.author.tag}`).then(() => true).catch(() => false)) done++; }
        await ctx.send(ui.ok('Role added to everyone', `Gave ${role} to **${done}** of ${targets.length} members.`));
      }, { cooldown: 30 }),
      adm('temp', null, 'Give a role for a limited time', [USER(), ROLE(), { name: 'duration', type: 'string', required: true, description: 'How long? Like 1h or 7d' }], async (ctx) => {
        const ms = parseDuration(ctx.str('duration'));
        if (!ms) throw new UserError('Invalid duration', 'Use a number and a unit, like 30m, 6h or 7d.');
        const m = await ctx.member('user'); const role = ctx.role('role');
        if (!m) throw new UserError('Member not found', 'That user is not in this server.');
        assignable(ctx, role);
        await m.roles.add(role, `Temp role by ${ctx.author.tag}`);
        scheduler.add('role_remove', Date.now() + ms, { guildId: ctx.guild.id, targetId: m.id, data: { roleId: role.id } });
        await ctx.reply(ui.ok('Temporary role given', `${m} has ${role} for **${fmtDuration(ms)}** (until ${ts(Date.now() + ms, 'f')}).`));
      }),
      adm('create', null, 'Create a new role', [{ name: 'name', type: 'string', required: true, max: 100, description: 'Role name' }, { name: 'color', type: 'string', description: 'Hex like #ffb7d5, or a colour name' }], async (ctx) => {
        const color = ctx.str('color') ? parseColor(ctx.str('color')) : null;
        if (ctx.str('color') && color === null) throw new UserError('Invalid colour', 'Use a hex code like #ffb7d5, or a name like pink, blue or purple.');
        const role = await ctx.guild.roles.create({ name: ctx.str('name'), color: color ?? undefined, reason: `By ${ctx.author.tag}` });
        await ctx.reply(ui.ok('Role created', `${role} is ready to use.`));
      }),
      adm('delete', null, 'Delete a role', [ROLE('Which role to delete'), { name: 'confirm', type: 'bool', required: true, description: 'Set to true to confirm' }], async (ctx) => {
        if (!ctx.bool('confirm')) throw new UserError('Cancelled', 'Nothing was deleted.', 'Run it again with confirm set to true.');
        const role = ctx.role('role'); assignable(ctx, role);
        await role.delete(`By ${ctx.author.tag}`);
        await ctx.reply(ui.ok('Role deleted', `**${role.name}** is gone.`));
      }),
      adm('color', null, 'Change a role colour', [ROLE(), { name: 'color', type: 'string', required: true, description: 'Hex like #ffb7d5, or a colour name' }], async (ctx) => {
        const color = parseColor(ctx.str('color'));
        if (color === null) throw new UserError('Invalid colour', 'Use a hex code like #ffb7d5, or a name like pink, blue or purple.');
        assignable(ctx, ctx.role('role'));
        await ctx.role('role').setColor(color, `By ${ctx.author.tag}`);
        await ctx.reply(ui.card({ icon: '🎨', title: 'Role colour changed', desc: `${ctx.role('role')} is now #${color.toString(16).padStart(6, '0')}.`, color }));
      }),
      adm('rename', null, 'Rename a role', [ROLE(), { name: 'name', type: 'string', required: true, max: 100, description: 'New name' }], async (ctx) => {
        assignable(ctx, ctx.role('role'));
        const old = ctx.role('role').name;
        await ctx.role('role').setName(ctx.str('name'), `By ${ctx.author.tag}`);
        await ctx.reply(ui.ok('Role renamed', `**${old}** is now ${ctx.role('role')}.`));
      }),
      adm('info', null, 'Details about a role', [ROLE()], async (ctx) => {
        const r = ctx.role('role');
        await ctx.reply(ui.card({
          icon: '🎭', title: r.name, color: r.color || COLOR,
          desc: ui.kv([['Members', r.members.size], ['Colour', r.hexColor], ['Position', r.position], ['Mentionable', r.mentionable ? 'Yes' : 'No'], ['Shown separately', r.hoist ? 'Yes' : 'No'], ['Created', ts(r.createdTimestamp, 'D')], ['ID', `\`${r.id}\``]]),
        }));
      }, { perms: [] }),
      adm('members', null, 'List the members who have a role', [ROLE()], async (ctx) => {
        await ctx.guild.members.fetch().catch(() => {});
        const r = ctx.role('role');
        const list = [...r.members.values()];
        if (!list.length) return ctx.reply(ui.card({ icon: '🌷', title: `Nobody has ${r.name}`, desc: 'No members yet.', color: COLOR }));
        await paginate(ctx, chunk(list, 20).map((part) => ui.card({ icon: '🎭', title: `${r.name} (${list.length})`, desc: part.map((m) => `${m}`).join('\n'), color: r.color || COLOR })));
      }, { perms: [] }),

      adm('add', 'sticky', 'Make a role come back when a member rejoins', [ROLE()], async (ctx) => {
        assignable(ctx, ctx.role('role'));
        const list = kv.get(ctx.guild.id, 'sticky', []);
        if (!list.includes(ctx.role('role').id)) list.push(ctx.role('role').id);
        kv.set(ctx.guild.id, 'sticky', list);
        await ctx.reply(ui.ok('Sticky role added', `${ctx.role('role')} is given back if a member leaves and rejoins.`));
      }),
      adm('remove', 'sticky', 'Stop a role from being sticky', [ROLE()], async (ctx) => {
        kv.set(ctx.guild.id, 'sticky', kv.get(ctx.guild.id, 'sticky', []).filter((x) => x !== ctx.role('role').id));
        await ctx.reply(ui.ok('Sticky role removed', `${ctx.role('role')} is no longer sticky.`));
      }),
      adm('list', 'sticky', 'See sticky roles', [], async (ctx) => {
        const list = kv.get(ctx.guild.id, 'sticky', []);
        await ctx.reply(ui.card({ icon: '📌', title: 'Sticky roles', desc: list.length ? list.map((id) => `<@&${id}>`).join('\n') : 'No sticky roles yet.', hint: 'Add one with /role sticky add.', color: COLOR }));
      }),

      adm('button', 'panel', 'Post a panel with one button per role', [
        { name: 'roles', type: 'string', required: true, rest: true, description: 'Mention the roles, like @Gamer @Artist (up to 10)' },
        { name: 'title', type: 'string', max: 100, description: 'Panel title' }, { name: 'description', type: 'string', max: 500, description: 'Text under the title' },
        { name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Defaults to this channel' },
      ], async (ctx) => {
        const roles = buildPanelRoles(ctx, ctx.str('roles'));
        const ch = ctx.chan('channel') || ctx.channel;
        const rows = chunk(roles, 5).map((part) => new ActionRowBuilder().addComponents(part.map((r) => new ButtonBuilder().setCustomId(`rolebtn:${r.id}`).setLabel(truncate(r.name, 60)).setStyle(ButtonStyle.Secondary))));
        await ch.send({ embeds: [ui.card({ icon: '🎭', title: ctx.str('title') || 'Pick your roles', desc: ctx.str('description') || 'Press a button to get a role. Press it again to remove it.', color: COLOR })], components: rows });
        await ctx.reply(ui.ok('Role panel posted', `Members can now pick from ${roles.length} ${roles.length === 1 ? 'role' : 'roles'} in ${ch}.`), { ephemeral: true });
      }),
      adm('dropdown', 'panel', 'Post a panel with a dropdown menu of roles', [
        { name: 'roles', type: 'string', required: true, rest: true, description: 'Mention the roles, like @Gamer @Artist (up to 10)' },
        { name: 'title', type: 'string', max: 100, description: 'Panel title' }, { name: 'description', type: 'string', max: 500, description: 'Text under the title' },
        { name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Defaults to this channel' },
      ], async (ctx) => {
        const roles = buildPanelRoles(ctx, ctx.str('roles'));
        const ch = ctx.chan('channel') || ctx.channel;
        const menu = new StringSelectMenuBuilder().setCustomId('rolemenu:panel').setPlaceholder('Choose your roles').setMinValues(0).setMaxValues(roles.length)
          .addOptions(roles.map((r) => ({ label: truncate(r.name, 100), value: r.id })));
        await ch.send({ embeds: [ui.card({ icon: '🎭', title: ctx.str('title') || 'Pick your roles', desc: ctx.str('description') || 'Choose the roles you want. Your selection replaces your old picks from this menu.', color: COLOR })], components: [new ActionRowBuilder().addComponents(menu)] });
        await ctx.reply(ui.ok('Role dropdown posted', `Members can now pick from ${roles.length} ${roles.length === 1 ? 'role' : 'roles'} in ${ch}.`), { ephemeral: true });
      }),
      adm('reaction', 'panel', 'Give a role when someone reacts to a message', [
        { name: 'message_id', type: 'string', required: true, description: 'ID of the message' }, { name: 'emoji', type: 'string', required: true, description: 'The emoji to react with' }, ROLE(),
        { name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Channel of the message (defaults to this one)' },
      ], async (ctx) => {
        const ch = ctx.chan('channel') || ctx.channel;
        const msg = await ch.messages.fetch(ctx.str('message_id')).catch(() => null);
        if (!msg) throw new UserError('Message not found', `I could not find that message in ${ch}.`, 'Use the channel option if it is somewhere else.');
        assignable(ctx, ctx.role('role'));
        const emoji = ctx.str('emoji').trim();
        await msg.react(emoji).catch(() => { throw new UserError('I cannot use that emoji', 'Use a normal emoji, or a custom emoji from this server.'); });
        const key = (emoji.match(/<a?:\w+:(\d+)>/) || [])[1] || emoji;
        db.prepare('INSERT OR REPLACE INTO reaction_roles (guild_id, message_id, emoji, role_id) VALUES (?, ?, ?, ?)').run(ctx.guild.id, msg.id, key, ctx.role('role').id);
        await ctx.reply(ui.ok('Reaction role set', `Reacting with ${emoji} on [that message](${msg.url}) gives ${ctx.role('role')}.`));
      }),
    ],
  }],
};
