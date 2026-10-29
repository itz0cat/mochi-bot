const { Events } = require('discord.js');
const logger = require('../core/logger');
const snipes = require('../core/snipes');
const automod = require('../core/automod');
const { truncate } = require('../core/util');
const ui = require('../core/ui');

module.exports = {
  name: Events.MessageUpdate,
  async run(client, before, after) {
    if (!after.guild || before.partial || after.partial || after.author?.bot || before.content === after.content) return;
    snipes.edited.set(after.channelId, { before: before.content, after: after.content, author: after.author.username, avatar: after.author.displayAvatarURL(), at: Date.now() });
    if (await automod.handleMessage(after)) return; // edited messages are checked too
    await logger.sendLog(after.guild, 'messageEdit', ui.card({
      icon: '✏️', title: 'Message edited', color: ui.colors.butter,
      author: { name: after.author.username, iconURL: after.author.displayAvatarURL() },
      fields: [{ name: 'Before', value: truncate(before.content || '(empty)', 1000), inline: false }, { name: 'After', value: truncate(after.content || '(empty)', 1000), inline: false }, { name: 'Channel', value: `<#${after.channelId}> [Jump](${after.url})` }],
    }), { sourceChannelId: after.channelId });
  },
};
