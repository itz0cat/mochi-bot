const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mineflayer = require('mineflayer');
const readline = require('readline');

const config = {
  host: process.env.MC_HOST || 'kat.mcsh.gg',
  port: parseInt(process.env.MC_PORT || '25565', 10),
  username: process.env.MC_USERNAME || 'CatAfk',
  version: process.env.MC_VERSION || '1.21.11',
  password: process.env.BOT_PASSWORD || 'CatAfk999!'
};

let rl = null;
if (process.stdin && process.stdin.isTTY && process.stdout && process.stdout.isTTY) {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> '
  });
}

function log(text) {
  if (rl && process.stdout && process.stdout.isTTY) {
    try {
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
      console.log(text);
      rl.prompt(true);
      return;
    } catch {}
  }
  console.log(text);
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

  log(`\x1b[36m[CatAfk] Connecting to ${config.host}:${config.port} as ${config.username} (v${config.version})...\x1b[0m`);
  
  try {
    bot = mineflayer.createBot({
      host: config.host,
      port: config.port,
      username: config.username,
      version: config.version
    });
  } catch (err) {
    log(`\x1b[31m[CatAfk] CreateBot error: ${err.message}\x1b[0m`);
    scheduleReconnect();
    return;
  }

  authHandled = false;

  bot.on('login', () => {
    log('\x1b[32m[CatAfk] Logged in to server.\x1b[0m');
    authHandled = false;
  });

  bot.on('spawn', () => {
    log('\x1b[32m[CatAfk] Spawned in server.\x1b[0m');
  });

  bot.on('message', (msg) => {
    // Print in exact game colors via ANSI
    if (typeof msg.toAnsi === 'function') {
      log(msg.toAnsi());
    } else {
      log(String(msg));
    }

    // Auto-detect login / register prompt from plain text
    const plainText = typeof msg.toString === 'function' ? msg.toString() : '';
    if (!authHandled && plainText) {
      const lower = plainText.toLowerCase();
      if (lower.includes('/register') || lower.includes('please register') || lower.includes('register using')) {
        authHandled = true;
        log('\x1b[33m[CatAfk] Register prompt detected! Sending /register...\x1b[0m');
        setTimeout(() => {
          if (bot && bot.chat) bot.chat(`/register ${config.password} ${config.password}`);
        }, 500);
      } else if (lower.includes('/login') || lower.includes('please login') || lower.includes('login using')) {
        authHandled = true;
        log('\x1b[33m[CatAfk] Login prompt detected! Sending /login...\x1b[0m');
        setTimeout(() => {
          if (bot && bot.chat) bot.chat(`/login ${config.password}`);
        }, 500);
      }
    }
  });

  bot.on('kicked', (reason) => {
    log('\x1b[31m[CatAfk Kicked] ' + JSON.stringify(reason) + '\x1b[0m');
  });

  bot.on('error', (err) => {
    log('\x1b[31m[CatAfk Error] ' + err.message + '\x1b[0m');
  });

  bot.on('end', (reason) => {
    log('\x1b[33m[CatAfk] Disconnected (' + reason + '). Reconnecting in 5s...\x1b[0m');
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

  if (rl) {
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed && bot && bot.chat) {
        bot.chat(trimmed);
      }
      rl.prompt();
    });
    rl.prompt();
  }

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
