const { Events } = require('discord.js');
const logger = require('../core/logger');
const ui = require('../core/ui');

module.exports = {
  name: Events.GuildMemberUpdate,
  async run(client, before, after) {
    if (before.partial) return;
    const fields = [];
    if (before.nickname !== after.nickname) fields.push({ name: 'Nickname', value: `${before.nickname || 'none'} to ${after.nickname || 'none'}`, inline: false });
    const added = after.roles.cache.filter((r) => !before.roles.cache.has(r.id));
    const removed = before.roles.cache.filter((r) => !after.roles.cache.has(r.id));
    if (added.size) fields.push({ name: 'Roles added', value: added.map((r) => `<@&${r.id}>`).join(' '), inline: false });
    if (removed.size) fields.push({ name: 'Roles removed', value: removed.map((r) => `<@&${r.id}>`).join(' '), inline: false });
    if (!fields.length) return;
    await logger.sendLog(after.guild, 'memberUpdate', ui.card({ icon: '🪪', title: 'Member updated', color: ui.colors.sky, desc: `<@${after.id}>`, author: { name: after.user.username, iconURL: after.user.displayAvatarURL() }, fields }));
  },
};
