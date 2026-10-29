const { UserError } = require('./context');

/** GET json with a timeout and friendly errors. */
async function getJson(url, { headers = {}, timeout = 7000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'MochiBot/1.0', ...headers }, signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err instanceof UserError) throw err;
    throw new UserError('The service did not answer', 'I could not reach the website I need for this.', 'Try again in a moment.');
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { getJson };
