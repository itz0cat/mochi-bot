const { PermissionFlagsBits } = require('discord.js');
const { kv } = require('./db');
const { owners } = require('../config');

// What a "mod role" is allowed to do without real Discord permissions.
const MOD_PERMS = new Set([
  'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageMessages', 'ManageNicknames', 'MoveMembers', 'ViewAuditLog', 'DeafenMembers', 'MuteMembers',
]);

const pretty = (name) => String(name).replace(/([a-z])([A-Z])/g, '$1 $2');

/** Does this member have ALL of these permissions (counting the server's mod/admin roles)? */
function can(member, perms) {
  if (!member) return false;
  if (owners.includes(member.id)) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const list = Array.isArray(perms) ? perms : [perms];
  const staff = kv.get(member.guild.id, 'staff', {});
  const isAdminRole = staff.adminRole && member.roles.cache.has(staff.adminRole);
  const isModRole = staff.modRole && member.roles.cache.has(staff.modRole);
  return list.every((p) => member.permissions.has(PermissionFlagsBits[p]) || isAdminRole || (isModRole && MOD_PERMS.has(p)));
}

function botMissing(guild, perms) {
  const me = guild.members.me;
  return (perms || []).filter((p) => !me.permissions.has(PermissionFlagsBits[p]));
}

/** null when the moderator may act on the target, otherwise a human sentence explaining why not. */
function hierarchyProblem(ctx, target, verb) {
  const guild = ctx.guild;
  if (target.id === ctx.author.id) return `You can't ${verb} yourself.`;
  if (target.id === ctx.client.user.id) return `I can't ${verb} myself.`;
  if (target.id === guild.ownerId) return `You can't ${verb} the server owner.`;
  const mod = ctx.me;
  if (mod && mod.id !== guild.ownerId && target.roles.highest.position >= mod.roles.highest.position) {
    return `You can only ${verb} members whose top role is below yours.`;
  }
  if (target.roles.highest.position >= guild.members.me.roles.highest.position) {
    return `That member's top role is above mine, so I can't ${verb} them. Move my role higher in Server Settings > Roles.`;
  }
  return null;
}

module.exports = { can, botMissing, hierarchyProblem, pretty, MOD_PERMS };
