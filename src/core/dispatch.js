const { UserError } = require('./context');
const { can, botMissing, pretty } = require('./perms');
const { kv } = require('./db');
const ui = require('./ui');

const cooldowns = new Map();

/** Runs one command with all the shared checks: server-only, disabled, permissions, bot permissions, cooldown. */
async function runCommand(ctx, def, sub) {
  const cmd = sub || def;
  const label = sub ? sub.usage.slice(1) : def.name;
  ctx.cmdLabel = label;
  try {
    if (!def.dm && !ctx.guild) throw new UserError('Server only', 'This command only works inside a server.');

    if (ctx.guild && def.name !== 'config' && def.name !== 'help') {
      const off = kv.get(ctx.guild.id, 'disabled', []);
      if (off.includes(label) || off.includes(def.name)) {
        throw new UserError('Command turned off', `\`${label}\` is disabled in this server.`, 'An admin can turn it back on with /config enable.');
      }
    }

    const need = cmd.perms ?? def.perms;
    if (ctx.guild && need) {
      const allowed = (cmd.check && (await cmd.check(ctx))) || can(ctx.me, need);
      if (!allowed) {
        const names = (Array.isArray(need) ? need : [need]).map(pretty).join(', ');
        throw new UserError('You need more permissions', `This needs **${names}**.`, 'Ask a server admin if you think you should have access.');
      }
    }

    const botNeed = cmd.botPerms ?? def.botPerms;
    if (ctx.guild && botNeed) {
      const missing = botMissing(ctx.guild, botNeed);
      if (missing.length) {
        throw new UserError('I need more permissions', `Please give me **${missing.map(pretty).join(', ')}**.`, 'Server Settings > Roles > my role > Permissions.');
      }
    }

    const key = `${ctx.author.id}:${label}`;
    const cd = (cmd.cooldown ?? 1.5) * 1000;
    const last = cooldowns.get(key) || 0;
    if (Date.now() - last < cd) {
      throw new UserError('Easy there', `Try \`${label}\` again in ${((cd - (Date.now() - last)) / 1000).toFixed(1)}s.`);
    }
    cooldowns.set(key, Date.now());

    await cmd.run(ctx);
  } catch (err) {
    if (err instanceof UserError) {
      return ctx.reply(ui.err(err.title, err.desc, err.hint), { ephemeral: true }).catch(() => {});
    }
    console.error(`[command] ${label} failed:`, err);
    return ctx
      .reply(ui.err('Something went wrong', 'That command hit a snag and did not finish.', 'Try again in a moment. If it keeps happening, tell the bot owner.'), { ephemeral: true })
      .catch(() => {});
  }
}

module.exports = { runCommand, cooldowns };
