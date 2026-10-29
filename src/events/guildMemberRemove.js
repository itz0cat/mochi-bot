const { Events, AuditLogEvent } = require('discord.js');
const { db, kv } = require('../core/db');
const automod = require('../core/automod');
const invites = require('../core/invites');
const logger = require('../core/logger');
const { welcomeCfg } = require('../commands/config');
const { fillTemplate, ts } = require('../core/util');
const ui = require('../core/ui');

module.exports = {
  name: Events.GuildMemberRemove,
  async run(client, member) {
    const guild = member.guild;
    invites.onLeave(member).catch((e) => console.error('[invites]', e));
    automod.nukeCheck(guild, AuditLogEvent.MemberKick).catch(() => {});

    const sticky = kv.get(guild.id, 'sticky', []);
    if (sticky.length && member.roles) {
      for (const id of member.roles.cache.keys()) if (sticky.includes(id)) db.prepare('INSERT OR IGNORE INTO sticky_roles (guild_id, user_id, role_id) VALUES (?, ?, ?)').run(guild.id, member.id, id);
    }

    const w = welcomeCfg(guild.id);
    if (w.goodbyeOn && w.goodbyeChannel && !member.user.bot) {
      const ch = guild.channels.cache.get(w.goodbyeChannel);
      if (ch?.isTextBased()) await ch.send({ embeds: [ui.card({ icon: '🌙', desc: fillTemplate(w.goodbye, { user: member.user, guild }), color: ui.colors.butter })], allowedMentions: { parse: [] } }).catch(() => {});
    }

    await logger.sendLog(guild, 'memberLeave', ui.card({
      icon: '📤', title: 'Member left', color: ui.colors.butter, thumb: member.user.displayAvatarURL(),
      desc: ui.kv([['Member', `<@${member.id}> (${member.user.username})`], ['Joined', member.joinedTimestamp ? ts(member.joinedTimestamp) : 'Unknown'], ['Members now', guild.memberCount]]),
    }));
  },
};
