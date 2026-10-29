const { Events } = require('discord.js');
const logger = require('../core/logger');
const ui = require('../core/ui');

module.exports = {
  name: Events.GuildBanRemove,
  async run(client, ban) {
    await logger.sendLog(ban.guild, 'unban', ui.card({ icon: '🕊️', title: 'Member unbanned', color: ui.colors.matcha, thumb: ban.user.displayAvatarURL(), desc: `<@${ban.user.id}> (${ban.user.username})` }));
  },
};
