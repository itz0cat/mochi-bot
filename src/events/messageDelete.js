const { Events } = require('discord.js');
const automod = require('../core/automod');
const logger = require('../core/logger');
const snipes = require('../core/snipes');
const { truncate } = require('../core/util');
const ui = require('../core/ui');

module.exports = {
  name: Events.MessageDelete,
  async run(client, message) {
    if (!message.guild || message.partial || message.author?.bot) return;
    snipes.deleted.set(message.channelId, { content: message.content, author: message.author.username, avatar: message.author.displayAvatarURL(), at: Date.now() });

    const c = automod.cfg(message.guild.id);
    const pinged = message.mentions.users.filter((u) => u.id !== message.author.id && !u.bot);
    if (c.filters.ghostping.on && (pinged.size || message.mentions.roles.size || message.mentions.everyone) && Date.now() - message.createdTimestamp < 120_000) {
      await message.channel.send({
        embeds: [ui.card({ icon: '👻', title: 'Ghost ping', desc: `<@${message.author.id}> mentioned ${[...pinged.values()].map((u) => `<@${u.id}>`).concat([...message.mentions.roles.values()].map((r) => `<@&${r.id}>`)).join(' ') || '@everyone'} and then deleted the message.`, color: ui.colors.butter })],
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }

    await logger.sendLog(message.guild, 'messageDelete', ui.card({
      icon: '🗑️', title: 'Message deleted', color: ui.colors.cherry,
      author: { name: message.author.username, iconURL: message.author.displayAvatarURL() },
      desc: `${truncate(message.content || '(no text)', 1500)}${message.attachments.size ? `\n-# ${message.attachments.size} attachment(s)` : ''}`,
      fields: [{ name: 'Channel', value: `<#${message.channelId}>` }, { name: 'Author', value: `<@${message.author.id}>` }],
    }), { sourceChannelId: message.channelId });
  },
};
