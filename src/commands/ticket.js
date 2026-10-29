const { ChannelType, PermissionFlagsBits: P, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { UserError } = require('../core/context');
const T = require('../core/tickets');
const { truncate } = require('../core/util');
const ui = require('../core/ui');

const COLOR = ui.colors.sky;

function inTicket(ctx) {
  const t = T.byChannel(ctx.channel.id);
  if (!t || t.status === 'deleted') throw new UserError('This is not a ticket', 'Use this command inside a ticket channel.', 'Open one with /ticket new.');
  return t;
}
function staffOnly(ctx) {
  if (!T.isStaff(ctx.me, T.cfg(ctx.guild.id))) throw new UserError('Staff only', 'Only support staff can do this.', 'Ask a server admin to set the support role with /ticket role.');
}

module.exports = {
  category: { key: 'ticket', label: 'Tickets', emoji: '🎫', desc: 'Private support channels with transcripts', color: COLOR },
  commands: [{
    name: 'ticket', description: 'Support ticket system',
    groups: {},
    subs: [
      {
        name: 'setup', description: 'One click: creates the role, category, logs and the Create ticket panel', perms: ['Administrator'], botPerms: ['ManageChannels', 'ManageRoles'], cooldown: 15,
        options: [
          { name: 'staff_role', type: 'role', description: 'Existing support role (leave empty to create one)' },
          { name: 'category', type: 'channel', channelTypes: ['category'], description: 'Existing category for tickets (leave empty to create one)' },
          { name: 'log_channel', type: 'channel', channelTypes: ['text'], description: 'Existing log channel (leave empty to create one)' },
          { name: 'panel_channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Where the button goes (leave empty to create one)' },
        ],
        async run(ctx) {
          await ctx.defer();
          const g = ctx.guild;
          const reason = `Ticket setup by ${ctx.author.tag}`;
          try {
            const role = ctx.role('staff_role') || (await g.roles.create({ name: 'Ticket support', color: 0xaed9f7, mentionable: true, reason }));
            const category = ctx.chan('category') || (await g.channels.create({
              name: 'Tickets', type: ChannelType.GuildCategory, reason,
              permissionOverwrites: [
                { id: g.roles.everyone, deny: [P.ViewChannel] },
                { id: role.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles] },
                { id: ctx.client.user.id, allow: [P.ViewChannel, P.SendMessages, P.ManageChannels, P.ManageMessages, P.EmbedLinks, P.AttachFiles] },
              ],
            }));
            const log = ctx.chan('log_channel') || (await g.channels.create({ name: 'ticket-logs', type: ChannelType.GuildText, parent: category.id, reason }));
            const panel = ctx.chan('panel_channel') || (await g.channels.create({
              name: 'create-a-ticket', type: ChannelType.GuildText, reason,
              permissionOverwrites: [
                { id: g.roles.everyone, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages] },
                { id: ctx.client.user.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks] },
              ],
            }));
            const msg = await panel.send(T.panelMessage());
            T.saveCfg(g.id, { staffRole: role.id, category: category.id, logChannel: log.id, panelChannel: panel.id });
            await ctx.reply({
              embeds: [ui.card({
                icon: '🎫', title: 'Tickets are ready', color: COLOR,
                desc: 'Members can press **Create ticket** to get help. Try it yourself to see how it looks.',
                fields: [{ name: 'Support role', value: `${role}` }, { name: 'Category', value: category.name }, { name: 'Logs', value: `${log}` }, { name: 'Panel', value: `${panel}` }],
              })],
              components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Go to panel').setStyle(ButtonStyle.Link).setURL(msg.url))],
            });
          } catch (err) {
            if (err instanceof UserError) throw err;
            console.error('[ticket setup]', err);
            throw new UserError('Setup did not finish', err.message, 'Give me Manage Channels and Manage Roles, and keep my role above the roles I make.');
          }
        },
      },
      {
        name: 'panel', description: 'Post the Create ticket button in a channel', perms: ['ManageGuild'], botPerms: ['SendMessages', 'EmbedLinks'],
        options: [
          { name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Defaults to this channel' },
          { name: 'title', type: 'string', max: 100, description: 'Panel title' },
          { name: 'description', type: 'string', max: 800, description: 'Text under the title' },
        ],
        async run(ctx) {
          const ch = ctx.chan('channel') || ctx.channel;
          const msg = await ch.send(T.panelMessage(ctx.str('title'), ctx.str('description')));
          T.saveCfg(ctx.guild.id, { panelChannel: ch.id });
          await ctx.reply(ui.ok('Panel posted', `The Create ticket button is live in ${ch}.`, { hint: `Jump to it: ${msg.url}` }), { ephemeral: true });
        },
      },
      {
        name: 'new', description: 'Open a ticket', options: [{ name: 'reason', type: 'string', rest: true, max: 400, description: 'What do you need help with?' }],
        async run(ctx) {
          await ctx.defer({ ephemeral: true });
          const { channel } = await T.openTicket(ctx.client, ctx.guild, ctx.author, ctx.str('reason'));
          await ctx.reply(ui.card({ icon: '🎫', title: 'Your ticket is ready', desc: `Head over to ${channel} and tell us what you need.`, color: COLOR }), { ephemeral: true });
        },
      },
      {
        name: 'close', description: 'Close this ticket', options: [{ name: 'reason', type: 'string', rest: true, max: 300, description: 'Why is it being closed?' }],
        async run(ctx) {
          const t = inTicket(ctx);
          if (t.status !== 'open') throw new UserError('Already closed', 'This ticket is already closed.');
          if (ctx.author.id !== t.opener_id) staffOnly(ctx);
          await ctx.reply(await T.closeTicket(ctx.guild, t, ctx.author, ctx.str('reason')));
        },
      },
      {
        name: 'reopen', description: 'Reopen a closed ticket',
        async run(ctx) {
          const t = inTicket(ctx);
          staffOnly(ctx);
          if (t.status === 'open') throw new UserError('Already open', 'This ticket is still open.');
          await ctx.reply(await T.reopenTicket(ctx.guild, t, ctx.author));
        },
      },
      {
        name: 'delete', description: 'Delete this ticket and save a transcript',
        async run(ctx) {
          const t = inTicket(ctx);
          staffOnly(ctx);
          await ctx.reply(ui.card({ icon: '🗑️', title: 'Deleting this ticket in 5 seconds', desc: 'Saving a transcript first.', color: ui.colors.cherry }));
          await T.deleteTicket(ctx.client, ctx.guild, t, ctx.author);
        },
      },
      {
        name: 'add', description: 'Add a member to this ticket', options: [{ name: 'user', type: 'user', required: true, description: 'Who to add' }],
        async run(ctx) {
          const t = inTicket(ctx); staffOnly(ctx);
          const u = ctx.user('user');
          await ctx.channel.permissionOverwrites.edit(u.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
          await ctx.reply(ui.ok(`Added ${u.username}`, `${u} can now see ticket ${t.num}.`));
        },
      },
      {
        name: 'remove', description: 'Remove a member from this ticket', options: [{ name: 'user', type: 'user', required: true, description: 'Who to remove' }],
        async run(ctx) {
          const t = inTicket(ctx); staffOnly(ctx);
          const u = ctx.user('user');
          if (u.id === t.opener_id) throw new UserError("Can't remove the opener", 'Close the ticket instead.');
          await ctx.channel.permissionOverwrites.delete(u.id);
          await ctx.reply(ui.ok(`Removed ${u.username}`, `They can no longer see ticket ${t.num}.`));
        },
      },
      {
        name: 'rename', description: 'Rename this ticket channel', options: [{ name: 'name', type: 'string', required: true, max: 90, description: 'New channel name' }],
        async run(ctx) {
          inTicket(ctx); staffOnly(ctx);
          const name = ctx.str('name').toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
          if (!name) throw new UserError('Invalid name', 'Use letters, numbers and dashes.');
          await ctx.channel.setName(name);
          await ctx.reply(ui.ok('Ticket renamed', `New name: **${name}**`));
        },
      },
      {
        name: 'claim', description: 'Take this ticket so others know you are on it',
        async run(ctx) {
          const t = inTicket(ctx); staffOnly(ctx);
          if (t.claimed_by) throw new UserError('Already claimed', `<@${t.claimed_by}> is handling this ticket.`, 'Use /ticket transfer to hand it over.');
          T.setClaim(t.id, ctx.author.id);
          await ctx.reply(ui.card({ icon: '🙋', title: 'Ticket claimed', desc: `<@${ctx.author.id}> is on it.`, color: COLOR }));
        },
      },
      {
        name: 'unclaim', description: 'Release a ticket you claimed',
        async run(ctx) {
          const t = inTicket(ctx); staffOnly(ctx);
          if (!t.claimed_by) throw new UserError('Not claimed', 'Nobody has claimed this ticket.');
          if (t.claimed_by !== ctx.author.id && !ctx.me.permissions.has(P.ManageGuild)) throw new UserError('Not yours', 'Only the person who claimed it (or a manager) can release it.');
          T.setClaim(t.id, null);
          await ctx.reply(ui.ok('Ticket released', 'Anyone on staff can claim it now.'));
        },
      },
      {
        name: 'transfer', description: 'Hand this ticket to another staff member', options: [{ name: 'user', type: 'user', required: true, description: 'New owner' }],
        async run(ctx) {
          const t = inTicket(ctx); staffOnly(ctx);
          const m = await ctx.member('user');
          if (!m || !T.isStaff(m, T.cfg(ctx.guild.id))) throw new UserError('Not staff', 'You can only transfer to support staff.');
          T.setClaim(t.id, m.id);
          await ctx.reply(ui.card({ icon: '🤝', title: 'Ticket transferred', desc: `${m} is now handling ticket ${t.num}.`, color: COLOR }));
        },
      },
      {
        name: 'transcript', description: 'Save a transcript of this ticket',
        async run(ctx) {
          const t = inTicket(ctx); staffOnly(ctx);
          await ctx.defer();
          const { file, count } = await T.buildTranscript(ctx.channel);
          await T.logTo(ctx.guild, { embeds: [ui.card({ icon: '📄', title: `Transcript of ticket ${t.num}`, desc: `${count} messages, saved by <@${ctx.author.id}>.`, color: COLOR })], files: [file] });
          await ctx.reply({ embeds: [ui.ok('Transcript saved', `${count} messages are in the file below.`)], files: [(await T.buildTranscript(ctx.channel)).file] });
        },
      },
      {
        name: 'list', description: 'List open tickets', perms: ['ManageChannels'],
        async run(ctx) {
          const list = T.openAll(ctx.guild.id);
          if (!list.length) return ctx.reply(ui.card({ icon: '🌷', title: 'No open tickets', desc: 'Everything is quiet.', color: ui.colors.mint }));
          await ctx.reply(ui.card({ icon: '🎫', title: `${list.length} open ${list.length === 1 ? 'ticket' : 'tickets'}`, color: COLOR,
            desc: list.slice(0, 20).map((t) => `<#${t.channel_id}> by <@${t.opener_id}>${t.claimed_by ? ` (claimed by <@${t.claimed_by}>)` : ''}${t.status === 'closed' ? ' closed' : ''}`).join('\n') }));
        },
      },
      {
        name: 'category', description: 'Choose the category new tickets are created in', perms: ['Administrator'],
        options: [{ name: 'category', type: 'channel', required: true, channelTypes: ['category'], description: 'The category' }],
        async run(ctx) { T.saveCfg(ctx.guild.id, { category: ctx.chan('category').id }); await ctx.reply(ui.ok('Ticket category set', `New tickets will appear under **${ctx.chan('category').name}**.`)); },
      },
      {
        name: 'role', description: 'Choose which role can see and manage tickets', perms: ['Administrator'],
        options: [{ name: 'role', type: 'role', required: true, description: 'The support role' }],
        async run(ctx) { T.saveCfg(ctx.guild.id, { staffRole: ctx.role('role').id }); await ctx.reply(ui.ok('Support role set', `${ctx.role('role')} can now see and manage new tickets.`)); },
      },
      {
        name: 'log', description: 'Choose where ticket logs and transcripts go', perms: ['Administrator'],
        options: [{ name: 'channel', type: 'channel', channelTypes: ['text'], description: 'Leave empty to turn logs off' }],
        async run(ctx) {
          const ch = ctx.chan('channel');
          T.saveCfg(ctx.guild.id, { logChannel: ch ? ch.id : null });
          await ctx.reply(ch ? ui.ok('Ticket log set', `Logs and transcripts will go to ${ch}.`) : ui.ok('Ticket logs turned off'));
        },
      },
      {
        name: 'blacklist', description: 'Stop a member from opening tickets', perms: ['ManageGuild'],
        options: [{ name: 'user', type: 'user', required: true, description: 'Who to block' }],
        async run(ctx) {
          const c = T.cfg(ctx.guild.id); const u = ctx.user('user');
          if (!c.blacklist.includes(u.id)) c.blacklist.push(u.id);
          T.saveCfg(ctx.guild.id, { blacklist: c.blacklist });
          await ctx.reply(ui.ok(`Blocked ${u.username}`, 'They can no longer open tickets.'));
        },
      },
      {
        name: 'unblacklist', description: 'Let a blocked member open tickets again', perms: ['ManageGuild'],
        options: [{ name: 'user', type: 'user', required: true, description: 'Who to unblock' }],
        async run(ctx) {
          const c = T.cfg(ctx.guild.id); const u = ctx.user('user');
          if (!c.blacklist.includes(u.id)) throw new UserError('Not blocked', `${u.username} is not on the block list.`);
          T.saveCfg(ctx.guild.id, { blacklist: c.blacklist.filter((x) => x !== u.id) });
          await ctx.reply(ui.ok(`Unblocked ${u.username}`, 'They can open tickets again.'));
        },
      },
    ],
  }],
};
