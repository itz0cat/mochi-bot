const { Events } = require('discord.js');
// Deliberately keep the code in the cache: a one-use invite disappears right as someone joins,
// and the join handler uses the leftover entry to work out who invited them.
module.exports = { name: Events.InviteDelete, async run() {} };
