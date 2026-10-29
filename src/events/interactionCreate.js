const { Events } = require('discord.js');
const registry = require('../core/registry');
const { Ctx, respond } = require('../core/context');
const { runCommand } = require('../core/dispatch');
const ui = require('../core/ui');

module.exports = {
  name: Events.InteractionCreate,
  async run(client, i) {
    if (i.isChatInputCommand()) {
      const found = registry.resolveSlash(i);
      if (!found) return respond(i, ui.err('Unknown command', 'That command no longer exists.', 'Run /help to see what is available. The owner may need to redeploy commands.'));
      const ctx = new Ctx(client, { interaction: i });
      return runCommand(ctx, found.def, found.sub);
    }
    if (i.isButton() || i.isAnySelectMenu() || i.isModalSubmit()) {
      const comp = client.components.get(i.customId.split(':')[0]);
      if (!comp) return respond(i, ui.warn('That button is out of date', 'Run the command again to get a fresh one.')).catch(() => {});
      try { await comp.run(client, i); } catch (err) {
        console.error(`[component:${i.customId}]`, err);
        respond(i, ui.err('Something went wrong', 'That did not work.', 'Try again in a moment.')).catch(() => {});
      }
    }
  },
};
