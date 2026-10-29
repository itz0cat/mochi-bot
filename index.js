const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const registry = require('./src/core/registry');
const pager = require('./src/core/pager');

if (!process.env.TOKEN) {
  console.error('Missing TOKEN. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

// Privileged intents (Server Members + Message Content) must be switched on in the Developer Portal > Bot.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildInvites, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
});

registry.loadAll();
console.log(`[mochi] ${registry.commands.size} slash commands loaded`);

// Buttons, menus and modals: files in src/components export { id, run(client, interaction) } (or an array of them)
client.components = new Map([[pager.id, pager]]);
const compDir = path.join(__dirname, 'src', 'components');
for (const f of fs.readdirSync(compDir).filter((x) => x.endsWith('.js'))) {
  const mod = require(path.join(compDir, f));
  for (const c of [].concat(mod)) if (c.id && c.run) client.components.set(c.id, c);
}

const evDir = path.join(__dirname, 'src', 'events');
for (const f of fs.readdirSync(evDir).filter((x) => x.endsWith('.js'))) {
  for (const ev of [].concat(require(path.join(evDir, f)))) {
    const handler = async (...args) => { try { await ev.run(client, ...args); } catch (err) { console.error(`[event:${ev.name}]`, err); } };
    ev.once ? client.once(ev.name, handler) : client.on(ev.name, handler);
  }
}

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

client.login(process.env.TOKEN);
