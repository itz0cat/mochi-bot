const { Events } = require('discord.js');
const logger = require('../core/logger');
const automod = require('../core/automod');
const ui = require('../core/ui');

module.exports = {
  name: Events.GuildRoleDelete,
  async run(client, thing) {
    const guild = thing.guild;
    if (!guild) return;
    automod.nukeCheck(guild, automod.NUKE_EVENTS.roleDelete).catch(() => {});
    const label = thing.name ? '**' + thing.name + '**' : 'Unnamed';
    await logger.sendLog(guild, 'roleDelete', ui.card({ icon: '🗑️', title: 'Role deleted', color: ui.colors.cherry, desc: label + '\nID: ' + thing.id }));
  },
};
