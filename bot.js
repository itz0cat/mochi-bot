/**
 * Universal Entrypoint for Mochi Bot
 * Supports:
 *   - node bot.js
 *   - ts-node --esm bot.js
 */
try {
  require('./index.js');
} catch (e) {
  if (typeof require === 'undefined' || e.code === 'ERR_REQUIRE_ESM') {
    import('./index.js');
  } else {
    throw e;
  }
}
