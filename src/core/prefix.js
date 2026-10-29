const { UserError } = require('./context');
const { ID_RE } = require('./util');
const { hint } = require('./registry');

/** Split into words, keeping "quoted phrases" together and remembering where each word started. */
function lex(str) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(str))) out.push({ text: m[1] !== undefined ? m[1] : m[2], start: m.index, quoted: m[1] !== undefined });
  return out;
}

const YES = new Set(['yes', 'true', 'on', 'enable', 'enabled', '1', 'y']);
const NO = new Set(['no', 'false', 'off', 'disable', 'disabled', '0', 'n']);
const TYPE_LABEL = { int: 'a whole number', num: 'a number', bool: 'yes or no', user: 'a member (mention or ID)', role: 'a role (mention, ID or name)', channel: 'a channel (mention, ID or name)', mention: 'a member or role' };

async function parseValue(client, guild, o, tok) {
  const t = tok.text;
  switch (o.type) {
    case 'string': return t;
    case 'int': { if (!/^-?\d+$/.test(t)) return undefined; const n = Number(t); return (o.min != null && n < o.min) || (o.max != null && n > o.max) ? undefined : n; }
    case 'num': { const n = Number(t); return Number.isFinite(n) ? n : undefined; }
    case 'bool': return YES.has(t.toLowerCase()) ? true : NO.has(t.toLowerCase()) ? false : undefined;
    case 'user': {
      const id = (t.match(/^<@!?(\d{15,22})>$/) || [])[1] || (ID_RE.test(t) ? t : null);
      if (id) return client.users.fetch(id).catch(() => undefined);
      const clean = t.replace(/^@/, '').toLowerCase();
      let found = guild?.members.cache.find((m) => m.user.username.toLowerCase() === clean || m.displayName.toLowerCase() === clean);
      if (!found && guild) {
        const fetched = await guild.members.fetch({ query: clean, limit: 1 }).catch(() => null);
        found = fetched?.first();
      }
      return found?.user;
    }
    case 'role': {
      const id = (t.match(/^<@&(\d{15,22})>$/) || [])[1] || (ID_RE.test(t) ? t : null);
      return id ? guild.roles.cache.get(id) : guild.roles.cache.find((r) => r.name.toLowerCase() === t.toLowerCase().replace(/^@/, ''));
    }
    case 'channel': {
      const id = (t.match(/^<#(\d{15,22})>$/) || [])[1] || (ID_RE.test(t) ? t : null);
      const ch = id ? guild.channels.cache.get(id) : guild.channels.cache.find((c) => c.name === t.toLowerCase().replace(/^#/, ''));
      if (ch && o.channelTypes) {
        const map = { text: 0, voice: 2, category: 4, news: 5, stage: 13, forum: 15 };
        if (!o.channelTypes.some((x) => map[x] === ch.type)) return undefined;
      }
      return ch;
    }
    case 'mention': {
      const u = await parseValue(client, guild, { ...o, type: 'user' }, tok);
      return u || parseValue(client, guild, { ...o, type: 'role' }, tok);
    }
    default: return undefined;
  }
}

/** Turn the words after the command name into the same option values a slash command would give. */
async function parseArgs({ client, guild, raw, opts, tokens, label }) {
  const args = {};
  const usage = `${label} ${hint(opts)}`.trim();
  let i = 0;
  for (let k = 0; k < opts.length; k++) {
    const o = opts[k];
    if (o.type === 'file') continue;
    if (i >= tokens.length) {
      if (o.required) throw new UserError('Missing details', `Try: \`${usage}\``, `Missing: ${o.name}. ${o.description}`);
      continue;
    }
    const tok = tokens[i];
    const isRest = o.type === 'string' && !o.choices && (o.rest || k === opts.length - 1 || opts.slice(k + 1).every((x) => x.type === 'file'));
    let value;
    if (isRest) {
      let rest = raw.slice(tok.start).trim();
      if (/^"[^"]*"$/.test(rest)) rest = rest.slice(1, -1);
      value = rest;
      i = tokens.length;
    } else if (o.choices) {
      const hit = o.choices.map((c) => (Array.isArray(c) ? { name: c[0], value: c[1] } : { name: String(c), value: c }))
        .find((c) => String(c.value).toLowerCase() === tok.text.toLowerCase() || c.name.toLowerCase() === tok.text.toLowerCase());
      value = hit?.value;
      i++;
    } else {
      value = await parseValue(client, guild, o, tok);
      i++;
    }
    if (value === undefined || value === null || value === '') {
      if (o.required) {
        const what = o.choices ? `one of: ${o.choices.map((c) => (Array.isArray(c) ? c[1] : c)).join(', ')}` : TYPE_LABEL[o.type] || 'text';
        throw new UserError('That did not look right', `I expected **${o.name}** to be ${what}.`, `Try: ${usage}`);
      }
      continue;
    }
    args[o.name] = value;
  }
  return args;
}

module.exports = { lex, parseArgs };
