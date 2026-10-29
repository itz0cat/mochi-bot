const { Events } = require('discord.js');
const { db } = require('../core/db');

async function toggle(reaction, user, add) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => {});
  const guild = reaction.message.guild;
  if (!guild) return;
  const key = reaction.emoji.id || reaction.emoji.name;
  const row = db.prepare('SELECT role_id FROM reaction_roles WHERE message_id = ? AND emoji = ?').get(reaction.message.id, key);
  if (!row) return;
  const member = await guild.members.fetch(user.id).catch(() => null);
  const role = guild.roles.cache.get(row.role_id);
  if (!member || !role) return;
  await (add ? member.roles.add(role, 'Reaction role') : member.roles.remove(role, 'Reaction role')).catch(() => {});
}

// Two events in one file: registered as separate listeners by exporting an array.
module.exports = [
  { name: Events.MessageReactionAdd, run: (client, reaction, user) => toggle(reaction, user, true) },
  { name: Events.MessageReactionRemove, run: (client, reaction, user) => toggle(reaction, user, false) },
];
