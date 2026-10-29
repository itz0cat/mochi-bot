const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { kv } = require('./db');

const lockable = (ch) => [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(ch.type);

async function lockChannel(channel, reason) {
  const everyone = channel.guild.roles.everyone;
  await channel.permissionOverwrites.edit(everyone, { SendMessages: false, AddReactions: false, SendMessagesInThreads: false }, { reason });
}
async function unlockChannel(channel, reason) {
  const everyone = channel.guild.roles.everyone;
  await channel.permissionOverwrites.edit(everyone, { SendMessages: null, AddReactions: null, SendMessagesInThreads: null }, { reason });
}

/** Lock (or unlock) every text channel that @everyone can currently talk in. Remembers what it locked. */
async function setLockdown(guild, on, reason = 'Server lockdown') {
  const everyone = guild.roles.everyone;
  if (on) {
    const done = [];
    for (const ch of guild.channels.cache.values()) {
      if (!lockable(ch)) continue;
      const canTalk = ch.permissionsFor(everyone)?.has(PermissionFlagsBits.SendMessages);
      if (!canTalk) continue;
      try { await lockChannel(ch, reason); done.push(ch.id); } catch { /* skip channels I can't edit */ }
    }
    kv.set(guild.id, 'lockdown', done);
    return { changed: done.length, total: guild.channels.cache.filter(lockable).size };
  }
  const ids = kv.get(guild.id, 'lockdown', []);
  let changed = 0;
  for (const id of ids) {
    const ch = guild.channels.cache.get(id);
    if (!ch) continue;
    try { await unlockChannel(ch, reason); changed++; } catch { /* skip */ }
  }
  kv.del(guild.id, 'lockdown');
  return { changed, total: ids.length };
}

module.exports = { lockChannel, unlockChannel, setLockdown, lockable };
