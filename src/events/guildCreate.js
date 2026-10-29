const { Events, PermissionFlagsBits: P } = require('discord.js');
const invites = require('../core/invites');
const ui = require('../core/ui');
const { brand, colors } = require('../config');

module.exports = {
  name: Events.GuildCreate,
  async run(client, guild) {
    invites.snapshot(guild).catch(() => {});
    const ch = guild.systemChannel?.permissionsFor(guild.members.me)?.has(P.SendMessages)
      ? guild.systemChannel
      : guild.channels.cache.find((c) => c.isTextBased() && c.permissionsFor(guild.members.me)?.has(P.SendMessages));
    if (!ch) return;
    await ch.send({
      embeds: [ui.card({
        icon: brand.emoji, title: `Thanks for adding ${client.user.username}!`, color: colors.strawberry,
        desc: 'I handle moderation, tickets, giveaways, invites and more.\n\n**Quick start**\n/ticket setup creates a full ticket system\n/log setup turns on server logs\n/automod setup turns on protection\n/help shows everything',
        hint: 'Admins only for the setup commands.',
      })],
    }).catch(() => {});
  },
};
