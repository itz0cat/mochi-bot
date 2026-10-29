const { Events, ActivityType } = require('discord.js');
const scheduler = require('../core/scheduler');
const invites = require('../core/invites');

module.exports = {
  name: Events.ClientReady, once: true,
  async run(client) {
    console.log(`[mochi] Logged in as ${client.user.tag} in ${client.guilds.cache.size} servers`);
    client.user.setActivity('/help', { type: ActivityType.Listening });
    scheduler.start(client);
    for (const g of client.guilds.cache.values()) await invites.snapshot(g).catch(() => {});
  },
};
