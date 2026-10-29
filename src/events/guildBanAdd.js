const { Events } = require('discord.js');
const logger = require('../core/logger');
const automod = require('../core/automod');
const ui = require('../core/ui');

module.exports = {
  name: Events.GuildBanAdd,
  async run(client, ban) {
    automod.nukeCheck(ban.guild, automod.NUKE_EVENTS.ban).catch(() => {});
    await logger.sendLog(ban.guild, 'ban', ui.card({ icon: '🔨', title: 'Member banned', color: ui.colors.cherry, thumb: ban.user.displayAvatarURL(), desc: ui.kv([['Member', `<@${ban.user.id}> (${ban.user.username})`], ['Reason', ban.reason || 'No reason given']]) }));
  },
};
