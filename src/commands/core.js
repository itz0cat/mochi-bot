const { OAuth2Scopes, PermissionFlagsBits: P, ActionRowBuilder, ButtonBuilder, ButtonStyle, version } = require('discord.js');
const { fmtDuration, ts, truncate } = require('../core/util');
const { UserError } = require('../core/context');
const { colors, links, owners, brand } = require('../config');
const { commands } = require('../core/registry');
const ui = require('../core/ui');
const help = require('../components/help');
const { kv } = require('../core/db');
const { defaultPrefix } = require('../config');

const linkRow = (label, url) => new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url));

module.exports = {
  category: { key: 'core', label: 'Core', emoji: '🤖', desc: 'Help, ping, invite and bot info', color: colors.strawberry },
  commands: [
    {
      name: 'help', description: 'Browse every command with a menu', dm: true,
      options: [{ name: 'search', type: 'string', description: 'A category or word, like ticket, ban or giveaway' }],
      async run(ctx) {
        const prefix = ctx.guild ? kv.get(ctx.guild.id, 'prefix', defaultPrefix) : defaultPrefix;
        const q = ctx.str('search');
        await ctx.reply(q ? help.search(ctx.client, q, ctx.author.id) : help.overview(ctx.client, ctx.author.id, prefix));
      },
    },
    {
      name: 'ping', description: "Check how fast I'm responding", dm: true,
      async run(ctx) {
        const started = ctx.interaction?.createdTimestamp ?? ctx.message?.createdTimestamp ?? Date.now();
        const trip = Math.max(0, Date.now() - started);
        await ctx.reply(ui.card({ icon: '🏓', title: 'Pong!', desc: ui.kv([['Reply time', `${trip}ms`], ['Gateway', `${Math.round(ctx.client.ws.ping)}ms`]]), color: colors.mint }));
      },
    },
    {
      name: 'uptime', description: 'See how long I have been awake', dm: true,
      async run(ctx) {
        const ms = process.uptime() * 1000;
        await ctx.reply(ui.card({ icon: '⏰', title: 'Awake and ready', desc: `Online for **${fmtDuration(ms)}**.\n-# Since ${ts(Date.now() - ms, 'f')}`, color: colors.mint }));
      },
    },
    {
      name: 'invite', description: 'Get the link to add me to your server', dm: true,
      async run(ctx) {
        const url = ctx.client.generateInvite({
          scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
          permissions: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory, P.AddReactions, P.UseExternalEmojis,
            P.ManageMessages, P.ManageChannels, P.ManageRoles, P.ManageGuild, P.ManageNicknames, P.ViewAuditLog, P.KickMembers, P.BanMembers,
            P.ModerateMembers, P.MoveMembers, P.CreateInstantInvite],
        });
        await ctx.reply({ embeds: [ui.card({ icon: brand.emoji, title: 'Add me to your server', desc: 'This link already includes slash commands and every permission I use.', color: colors.strawberry })], components: [linkRow('Invite Mochi', url)] });
      },
    },
    {
      name: 'support', description: 'Get help from the support server', dm: true,
      async run(ctx) {
        if (!links.support) throw new UserError('No support server yet', 'The bot owner has not set a support link.', 'Owner: add SUPPORT_URL to the .env file.');
        await ctx.reply({ embeds: [ui.card({ icon: '💬', title: 'Need a hand?', desc: 'Our support server is happy to help.', color: colors.sky })], components: [linkRow('Join support server', links.support)] });
      },
    },
    {
      name: 'vote', description: 'Vote for me and help me grow', dm: true,
      async run(ctx) {
        if (!links.vote) throw new UserError('No vote link yet', 'The bot owner has not set a vote link.', 'Owner: add VOTE_URL to the .env file.');
        await ctx.reply({ embeds: [ui.card({ icon: '💖', title: 'Thank you for voting', desc: 'Every vote helps more servers find me.', color: colors.strawberry })], components: [linkRow('Vote now', links.vote)] });
      },
    },
    {
      name: 'botinfo', description: 'Show stats about me', dm: true,
      async run(ctx) {
        const c = ctx.client;
        const members = c.guilds.cache.reduce((n, g) => n + g.memberCount, 0);
        await ctx.reply(ui.card({
          icon: brand.emoji, title: c.user.username, color: colors.strawberry, thumb: c.user.displayAvatarURL(),
          fields: [
            { name: 'Servers', value: String(c.guilds.cache.size) },
            { name: 'Members', value: members.toLocaleString() },
            { name: 'Commands', value: String(commands.size) },
            { name: 'Uptime', value: fmtDuration(process.uptime() * 1000) },
            { name: 'Memory', value: `${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} MB` },
            { name: 'Built with', value: `Node ${process.version}, discord.js ${version}` },
          ],
        }));
      },
    },
    {
      name: 'report', description: 'Tell the bot owner about a bug or problem', dm: true,
      options: [{ name: 'message', type: 'string', required: true, description: 'What went wrong?', max: 1500 }],
      async run(ctx) {
        const text = ctx.str('message');
        const embed = ui.card({
          icon: '📮', title: 'New report', desc: truncate(text, 1800), color: colors.butter,
          fields: [{ name: 'From', value: `${ctx.author.tag} (${ctx.author.id})` }, { name: 'Server', value: ctx.guild ? `${ctx.guild.name} (${ctx.guild.id})` : 'Direct message' }],
        });
        let delivered = false;
        if (links.reportChannel) {
          const ch = await ctx.client.channels.fetch(links.reportChannel).catch(() => null);
          if (ch?.isTextBased()) delivered = Boolean(await ch.send({ embeds: [embed] }).catch(() => null));
        }
        if (!delivered && owners[0]) {
          const owner = await ctx.client.users.fetch(owners[0]).catch(() => null);
          delivered = Boolean(owner && (await owner.send({ embeds: [embed] }).catch(() => null)));
        }
        if (!delivered) throw new UserError('Could not send the report', 'No place to deliver reports is set up.', 'Owner: set REPORT_CHANNEL_ID or OWNER_IDS in the .env file.');
        await ctx.reply(ui.ok('Report sent', 'Thank you! The owner will take a look.'), { ephemeral: true });
      },
    },
  ],
};
