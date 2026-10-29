const { Events } = require('discord.js');
const logger = require('../core/logger');
const automod = require('../core/automod');
const ui = require('../core/ui');

module.exports = {
  name: Events.ChannelDelete,
  async run(client, thing) {
    const guild = thing.guild;
    if (!guild) return;
    automod.nukeCheck(guild, automod.NUKE_EVENTS.channelDelete).catch(() => {});
    const label = thing.name ? '**' + thing.name + '**' : 'Unnamed';
    await logger.sendLog(guild, 'channelDelete', ui.card({ icon: '🗑️', title: 'Channel deleted', color: ui.colors.cherry, desc: label + '\nID: ' + thing.id }));
  },
};
