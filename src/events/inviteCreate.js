const { Events } = require('discord.js');
const invites = require('../core/invites');

module.exports = {
  name: Events.InviteCreate,
  async run(client, invite) {
    if (!invite.guild) return;
    const map = invites.cache.get(invite.guild.id) || new Map();
    map.set(invite.code, invite.uses ?? 0);
    invites.cache.set(invite.guild.id, map);
  },
};
