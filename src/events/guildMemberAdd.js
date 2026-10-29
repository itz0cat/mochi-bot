const { Events } = require('discord.js');
const { db } = require('../core/db');
const automod = require('../core/automod');
const invites = require('../core/invites');
const logger = require('../core/logger');
const { welcomeCfg } = require('../commands/config');
const { fillTemplate, ts } = require('../core/util');
const ui = require('../core/ui');

module.exports = {
  name: Events.GuildMemberAdd,
  async run(client, member) {
    const guild = member.guild;
    if (await automod.handleJoin(member)) return;

    invites.onJoin(member).catch((e) => console.error('[invites]', e));

    // sticky roles come back
    const rows = db.prepare('SELECT role_id FROM sticky_roles WHERE guild_id = ? AND user_id = ?').all(guild.id, member.id);
    if (rows.length) {
      const ids = rows.map((r) => r.role_id).filter((id) => guild.roles.cache.has(id));
      await member.roles.add(ids, 'Sticky roles').catch(() => {});
      db.prepare('DELETE FROM sticky_roles WHERE guild_id = ? AND user_id = ?').run(guild.id, member.id);
    }

    const w = welcomeCfg(guild.id);
    if (w.autorole && guild.roles.cache.has(w.autorole)) await member.roles.add(w.autorole, 'Auto role').catch(() => {});

    if (w.on && w.channel && !member.user.bot) {
      const ch = guild.channels.cache.get(w.channel);
      if (ch?.isTextBased()) {
        await ch.send({
          embeds: [ui.card({ icon: '🌸', desc: fillTemplate(w.message, { user: member.user, guild }), color: ui.colors.strawberry, thumb: member.user.displayAvatarURL() })],
          allowedMentions: { users: [member.id] },
        }).catch(() => {});
      }
    }
    if (w.dmOn && !member.user.bot) {
      await member.send({ embeds: [ui.card({ icon: '💌', desc: fillTemplate(w.dm, { user: member.user, guild }), color: ui.colors.sky })] }).catch(() => {});
    }

    await logger.sendLog(guild, 'memberJoin', ui.card({
      icon: '📥', title: 'Member joined', color: ui.colors.matcha, thumb: member.user.displayAvatarURL(),
      desc: ui.kv([['Member', `<@${member.id}>`], ['Account created', ts(member.user.createdTimestamp)], ['Members now', guild.memberCount]]),
    }));
  },
};
