const { kv } = require('./db');

const EVENTS = {
  messageDelete: 'Deleted messages', messageEdit: 'Edited messages', memberJoin: 'Members joining', memberLeave: 'Members leaving',
  memberUpdate: 'Nickname and role changes', channelCreate: 'Channels created', channelDelete: 'Channels deleted',
  roleCreate: 'Roles created', roleDelete: 'Roles deleted', voice: 'Voice channel activity', ban: 'Bans', unban: 'Unbans',
};

const defaults = () => ({ channel: null, events: Object.fromEntries(Object.keys(EVENTS).map((k) => [k, true])), ignore: [] });
const config = (guildId) => kv.obj(guildId, 'logs', defaults());

/** Post an embed to the server log channel if that event is switched on and the source channel isn't ignored. */
async function sendLog(guild, event, embed, { sourceChannelId } = {}) {
  try {
    const cfg = config(guild.id);
    if (!cfg.channel || cfg.events[event] === false) return false;
    if (sourceChannelId && cfg.ignore.includes(sourceChannelId)) return false;
    const ch = guild.channels.cache.get(cfg.channel) || (await guild.channels.fetch(cfg.channel).catch(() => null));
    if (!ch?.isTextBased()) return false;
    await ch.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return true;
  } catch {
    return false;
  }
}

module.exports = { EVENTS, config, defaults, sendLog };
