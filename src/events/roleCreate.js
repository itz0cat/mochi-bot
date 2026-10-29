const { Events } = require('discord.js');
const logger = require('../core/logger');
const automod = require('../core/automod');
const ui = require('../core/ui');

module.exports = {
  name: Events.GuildRoleCreate,
  async run(client, thing) {
    const guild = thing.guild;
    if (!guild) return;
    const label = thing.name ? '**' + thing.name + '**' : 'Unnamed';
    await logger.sendLog(guild, 'roleCreate', ui.card({ icon: '🎭', title: 'Role created', color: ui.colors.matcha, desc: label + '\nID: ' + thing.id }));
  },
};
