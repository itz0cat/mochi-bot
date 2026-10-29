const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { REST, Routes } = require('discord.js');
const registry = require('./src/core/registry');
const { validatePayload } = require('./scripts/validate');

const { TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!TOKEN || !CLIENT_ID) {
  console.error('Set TOKEN and CLIENT_ID in .env');
  process.exit(1);
}

registry.loadAll();
const body = registry.slashPayload();
const problems = validatePayload(body);
if (problems.length) {
  console.error('Refusing to deploy. Fix these first:\n - ' + problems.join('\n - '));
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);
const asGlobal = process.argv.includes('--global');

(async () => {
  try {
    if (process.argv.includes('--clear')) {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
      if (GUILD_ID) await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });
      console.log('Cleared all slash commands.');
      return;
    }
    if (asGlobal || !GUILD_ID) {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body });
      if (GUILD_ID) await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] }); // avoid duplicates
      console.log(`Registered ${body.length} slash commands globally. They can take a few minutes to appear.`);
    } else {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body });
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] }); // avoid duplicates
      console.log(`Registered ${body.length} slash commands in server ${GUILD_ID}. They show up instantly.`);
    }
    console.log('If you do not see them yet, restart Discord. The bot must be invited with the applications.commands scope (use /invite).');
  } catch (err) {
    console.error(err?.rawError ? JSON.stringify(err.rawError, null, 2) : err);
    process.exit(1);
  }
})();
