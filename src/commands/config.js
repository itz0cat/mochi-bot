const { UserError } = require('../core/context');
const { kv } = require('../core/db');
const { fillTemplate, truncate } = require('../core/util');
const { commands, categories } = require('../core/registry');
const { defaultPrefix } = require('../config');
const ui = require('../core/ui');

const COLOR = ui.colors.strawberry;
const adm = (name, description, options, run, extra = {}) => ({ name, description, options, run, ...extra });

const DEFAULT_WELCOME = 'Welcome {user} to **{server}**! You are member **#{count}**.';
const DEFAULT_GOODBYE = '**{username}** has left {server}.';
const DEFAULT_DM = 'Welcome to **{server}**! Have a look around and say hi.';

const welcomeCfg = (gid) => kv.obj(gid, 'welcome', { on: false, channel: null, message: DEFAULT_WELCOME, goodbyeOn: false, goodbyeChannel: null, goodbye: DEFAULT_GOODBYE, dmOn: false, dm: DEFAULT_DM, autorole: null });

function allLabels() {
  const out = new Set();
  for (const c of categories.values()) for (const e of c.entries) out.add(e.usage.slice(1));
  return out;
}

async function preview(ctx, text, member) {
  return fillTemplate(text, { user: member.user, guild: ctx.guild });
}

module.exports = {
  category: { key: 'config', label: 'Config', emoji: '⚙️', desc: 'Prefix, welcome messages, staff roles and command toggles', color: COLOR },
  commands: [{
    name: 'config', description: 'Server settings', perms: ['ManageGuild'],
    subs: [
      adm('view', 'See all settings at a glance', [], async (ctx) => {
        const g = ctx.guild; const w = welcomeCfg(g.id); const staff = kv.get(g.id, 'staff', {}); const off = kv.get(g.id, 'disabled', []);
        await ctx.reply(ui.card({
          icon: '⚙️', title: `${g.name} settings`, color: COLOR,
          desc: ui.kv([
            ['Prefix', `\`${kv.get(g.id, 'prefix', defaultPrefix)}\``], ['Welcome', w.on ? `on in <#${w.channel}>` : 'off'], ['Goodbye', w.goodbyeOn ? `on in <#${w.goodbyeChannel}>` : 'off'], ['Welcome DM', w.dmOn ? 'on' : 'off'],
            ['Auto role', w.autorole ? `<@&${w.autorole}>` : 'none'], ['Mod role', staff.modRole ? `<@&${staff.modRole}>` : 'none'], ['Admin role', staff.adminRole ? `<@&${staff.adminRole}>` : 'none'], ['Disabled commands', off.length],
          ]),
          hint: 'Logs, tickets, giveaways and automod have their own /log, /ticket, /giveaway and /automod commands.',
        }));
      }),
      adm('prefix', 'Change my text-command prefix', [{ name: 'prefix', type: 'string', required: true, min: 1, max: 5, description: 'The new prefix, like ! or m!' }], async (ctx) => {
        const p = ctx.str('prefix').trim();
        if (/\s/.test(p) || !p) throw new UserError('Invalid prefix', 'The prefix cannot contain spaces.');
        kv.set(ctx.guild.id, 'prefix', p);
        await ctx.reply(ui.ok('Prefix changed', `Text commands now start with \`${p}\`, like \`${p}ping\`.`, 'Slash commands always work too.'));
      }),
      adm('welcome', 'Greet new members in a channel', [
        { name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Where to greet (leave empty to keep the current one)' },
        { name: 'message', type: 'string', rest: true, max: 1000, description: 'Message. Use {user} {username} {server} {count}' },
        { name: 'enabled', type: 'bool', description: 'Turn greetings on or off' },
      ], async (ctx) => {
        const w = welcomeCfg(ctx.guild.id);
        if (ctx.chan('channel')) w.channel = ctx.chan('channel').id;
        if (ctx.str('message')) w.message = ctx.str('message');
        w.on = ctx.bool('enabled') ?? (Boolean(w.channel) ? true : false);
        if (w.on && !w.channel) throw new UserError('Pick a channel', 'I need a channel to post greetings in.', 'Try /config welcome channel:#welcome.');
        kv.set(ctx.guild.id, 'welcome', w);
        await ctx.reply(w.on ? ui.ok('Welcome messages on', `I will greet new members in <#${w.channel}>.`, `Preview it with /config testwelcome. Message: ${truncate(w.message, 120)}`) : ui.ok('Welcome messages off'));
      }),
      adm('goodbye', 'Say goodbye when members leave', [
        { name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Where to post (leave empty to keep the current one)' },
        { name: 'message', type: 'string', rest: true, max: 1000, description: 'Message. Use {username} {server} {count}' },
        { name: 'enabled', type: 'bool', description: 'Turn goodbyes on or off' },
      ], async (ctx) => {
        const w = welcomeCfg(ctx.guild.id);
        if (ctx.chan('channel')) w.goodbyeChannel = ctx.chan('channel').id;
        if (ctx.str('message')) w.goodbye = ctx.str('message');
        w.goodbyeOn = ctx.bool('enabled') ?? Boolean(w.goodbyeChannel);
        if (w.goodbyeOn && !w.goodbyeChannel) throw new UserError('Pick a channel', 'I need a channel to post goodbyes in.', 'Try /config goodbye channel:#goodbyes.');
        kv.set(ctx.guild.id, 'welcome', w);
        await ctx.reply(w.goodbyeOn ? ui.ok('Goodbye messages on', `I will post in <#${w.goodbyeChannel}> when someone leaves.`) : ui.ok('Goodbye messages off'));
      }),
      adm('dmwelcome', 'Send new members a private welcome message', [
        { name: 'message', type: 'string', rest: true, max: 1000, description: 'Message. Use {username} {server} {count}' },
        { name: 'enabled', type: 'bool', description: 'Turn it on or off' },
      ], async (ctx) => {
        const w = welcomeCfg(ctx.guild.id);
        if (ctx.str('message')) w.dm = ctx.str('message');
        w.dmOn = ctx.bool('enabled') ?? true;
        kv.set(ctx.guild.id, 'welcome', w);
        await ctx.reply(w.dmOn ? ui.ok('Welcome DM on', truncate(w.dm, 200)) : ui.ok('Welcome DM off'));
      }),
      adm('autorole', 'Give new members a role automatically', [{ name: 'role', type: 'role', description: 'Leave empty to turn it off' }], async (ctx) => {
        const r = ctx.role('role'); const w = welcomeCfg(ctx.guild.id);
        if (r && (r.managed || r.position >= ctx.guild.members.me.roles.highest.position)) throw new UserError('I cannot give that role', 'It is above my highest role, or managed by an integration.', 'Move my role higher in Server Settings > Roles.');
        w.autorole = r ? r.id : null; kv.set(ctx.guild.id, 'welcome', w);
        await ctx.reply(r ? ui.ok('Auto role set', `New members get ${r}.`) : ui.ok('Auto role turned off'));
      }, { botPerms: ['ManageRoles'] }),
      adm('testwelcome', 'Preview the welcome, goodbye and DM messages', [], async (ctx) => {
        const w = welcomeCfg(ctx.guild.id);
        await ctx.reply({ embeds: [
          ui.card({ icon: '👋', title: 'Welcome message', desc: await preview(ctx, w.message, ctx.me), color: COLOR, hint: w.on ? undefined : 'Currently off. Turn it on with /config welcome.' }),
          ui.card({ icon: '🌙', title: 'Goodbye message', desc: await preview(ctx, w.goodbye, ctx.me), color: ui.colors.butter, hint: w.goodbyeOn ? undefined : 'Currently off. Turn it on with /config goodbye.' }),
          ui.card({ icon: '💌', title: 'Welcome DM', desc: await preview(ctx, w.dm, ctx.me), color: ui.colors.sky, hint: w.dmOn ? undefined : 'Currently off. Turn it on with /config dmwelcome.' }),
        ] });
      }),
      adm('modrole', 'Let a role use moderation commands', [{ name: 'role', type: 'role', description: 'Leave empty to remove' }], async (ctx) => {
        const s = kv.get(ctx.guild.id, 'staff', {}); s.modRole = ctx.role('role')?.id || null; kv.set(ctx.guild.id, 'staff', s);
        await ctx.reply(ctx.role('role') ? ui.ok('Mod role set', `${ctx.role('role')} can now use ban, kick, timeout, warn, purge and similar commands.`) : ui.ok('Mod role removed'));
      }, { perms: ['Administrator'] }),
      adm('adminrole', 'Let a role use every bot command', [{ name: 'role', type: 'role', description: 'Leave empty to remove' }], async (ctx) => {
        const s = kv.get(ctx.guild.id, 'staff', {}); s.adminRole = ctx.role('role')?.id || null; kv.set(ctx.guild.id, 'staff', s);
        await ctx.reply(ctx.role('role') ? ui.ok('Admin role set', `${ctx.role('role')} can now use every command of mine.`, 'Only give this to people you trust.') : ui.ok('Admin role removed'));
      }, { perms: ['Administrator'] }),
      adm('disable', 'Turn a command off in this server', [{ name: 'command', type: 'string', required: true, description: 'Like ban, or ticket new. A whole group works too, like giveaway' }], async (ctx) => {
        const label = ctx.str('command').toLowerCase().replace(/^[/.]/, '').trim();
        if (['config', 'help'].some((x) => label === x || label.startsWith(`${x} `))) throw new UserError('That one has to stay on', 'You cannot turn off /config or /help.');
        if (!allLabels().has(label) && !commands.has(label)) throw new UserError('Command not found', `I do not have a command called "${truncate(label, 40)}".`, 'Write it like it appears in /help, for example: ticket new');
        const off = kv.get(ctx.guild.id, 'disabled', []);
        if (!off.includes(label)) off.push(label);
        kv.set(ctx.guild.id, 'disabled', off);
        await ctx.reply(ui.ok('Command turned off', `\`${label}\` is disabled here.`, 'Turn it back on with /config enable.'));
      }),
      adm('enable', 'Turn a command back on', [{ name: 'command', type: 'string', required: true, description: 'The command, like ban or ticket new' }], async (ctx) => {
        const label = ctx.str('command').toLowerCase().replace(/^[/.]/, '').trim();
        const off = kv.get(ctx.guild.id, 'disabled', []);
        if (!off.includes(label)) throw new UserError('Not disabled', `\`${label}\` is already on.`, 'See /config disabled.');
        kv.set(ctx.guild.id, 'disabled', off.filter((x) => x !== label));
        await ctx.reply(ui.ok('Command turned on', `\`${label}\` works again.`));
      }),
      adm('disabled', 'See which commands are turned off', [], async (ctx) => {
        const off = kv.get(ctx.guild.id, 'disabled', []);
        await ctx.reply(ui.card({ icon: '🔕', title: 'Disabled commands', desc: off.length ? off.map((x) => `\`${x}\``).join('  ') : 'Everything is on.', color: COLOR }));
      }),
      adm('reset', 'Reset every setting for this server', [{ name: 'confirm', type: 'bool', required: true, description: 'Set to true to confirm' }], async (ctx) => {
        if (!ctx.bool('confirm')) throw new UserError('Cancelled', 'Nothing was changed.', 'Run it again with confirm set to true.');
        kv.wipe(ctx.guild.id);
        await ctx.reply(ui.ok('Settings reset', 'Prefix, welcome messages, logs, automod, tickets and giveaway settings are back to the defaults.', 'Tickets, giveaways and invite counts you already made are kept.'));
      }, { perms: ['Administrator'] }),
    ],
  }],
  welcomeCfg, DEFAULT_WELCOME,
};
