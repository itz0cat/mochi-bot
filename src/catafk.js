const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mineflayer = require('mineflayer');

const config = {
  host: process.env.MC_HOST || 'kat.mcsh.gg',
  port: parseInt(process.env.MC_PORT || '25565', 10),
  username: process.env.MC_USERNAME || 'CatAfk',
  version: process.env.MC_VERSION || '1.21.11',
  password: process.env.BOT_PASSWORD || 'CatAfk999!',
  // Set to true to completely mute all console/terminal logging from the Minecraft bot
  silent: true
};

function log(...args) {
  if (!config.silent) {
    console.log(...args);
  }
}

let bot = null;
let authHandled = false;
let reconnectTimer = null;
let isStarted = false;

function createBot() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  log(`[CatAfk] Connecting to ${config.host}:${config.port} as ${config.username}...`);

  try {
    bot = mineflayer.createBot({
      host: config.host,
      port: config.port,
      username: config.username,
      version: config.version,
      // Suppress internal protocol debug prints
      hideErrors: true
    });
  } catch (err) {
    log(`[CatAfk] Error initializing: ${err.message}`);
    scheduleReconnect();
    return;
  }

  authHandled = false;

  bot.on('login', () => {
    log('[CatAfk] Logged in to server.');
    authHandled = false;
  });

  bot.on('spawn', () => {
    log('[CatAfk] Spawned in server.');
  });

  bot.on('message', (msg) => {
    // Only print game chat if not silenced
    log(typeof msg.toAnsi === 'function' ? msg.toAnsi() : String(msg));

    // Auto-detect login / register prompt silently
    const plainText = typeof msg.toString === 'function' ? msg.toString() : '';
    if (!authHandled && plainText) {
      const lower = plainText.toLowerCase();
      if (lower.includes('/register') || lower.includes('please register') || lower.includes('register using')) {
        authHandled = true;
        setTimeout(() => {
          if (bot && bot.chat) bot.chat(`/register ${config.password} ${config.password}`);
        }, 500);
      } else if (lower.includes('/login') || lower.includes('please login') || lower.includes('login using')) {
        authHandled = true;
        setTimeout(() => {
          if (bot && bot.chat) bot.chat(`/login ${config.password}`);
        }, 500);
      }
    }
  });

  bot.on('kicked', (reason) => {
    log('[CatAfk Kicked]', reason);
  });

  bot.on('error', (err) => {
    log('[CatAfk Error]', err.message);
  });

  bot.on('end', () => {
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    createBot();
  }, 5000);
}

function start() {
  if (isStarted) return;
  isStarted = true;
  createBot();
}

function stop() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (bot) {
    try { bot.quit(); } catch {}
    bot = null;
  }
  isStarted = false;
}

if (require.main === module) {
  start();
}

module.exports = { start, stop, getBot: () => bot };
