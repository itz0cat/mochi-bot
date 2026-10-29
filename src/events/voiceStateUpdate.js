const { Events } = require('discord.js');
const logger = require('../core/logger');
const ui = require('../core/ui');

module.exports = {
  name: Events.VoiceStateUpdate,
  async run(client, before, after) {
    if (before.channelId === after.channelId || !after.member || after.member.user.bot) return;
    const who = `<@${after.id}>`;
    const desc = !before.channelId ? `${who} joined <#${after.channelId}>` : !after.channelId ? `${who} left <#${before.channelId}>` : `${who} moved from <#${before.channelId}> to <#${after.channelId}>`;
    await logger.sendLog(after.guild, 'voice', ui.card({ icon: '🎙️', title: 'Voice activity', color: ui.colors.sky, desc }), { sourceChannelId: after.channelId || before.channelId });
  },
};
