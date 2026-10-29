const fs = require('fs');
const path = require('path');

const TYPES = { string: 3, int: 4, bool: 5, user: 6, channel: 7, role: 8, mention: 9, num: 10, file: 11 };
const CHANNEL_TYPES = { text: 0, voice: 2, category: 4, news: 5, stage: 13, forum: 15 };
const ORDER = ['core', 'moderation', 'ticket', 'giveaway', 'invites', 'automod', 'log', 'role', 'config', 'highlight', 'utility', 'misc'];

const categories = new Map(); // key -> { key, label, emoji, desc, entries: [] }
const commands = new Map();   // top-level name -> def
const aliases = new Map();    // alias -> def

function optionJSON(o) {
  const j = { type: TYPES[o.type], name: o.name, description: o.description };
  if (!j.type) throw new Error(`option "${o.name}": unknown type "${o.type}"`);
  if (o.required) j.required = true;
  if (o.choices) j.choices = o.choices.map((c) => (Array.isArray(c) ? { name: c[0], value: c[1] } : { name: String(c), value: c }));
  if (o.min != null) j[o.type === 'string' ? 'min_length' : 'min_value'] = o.min;
  if (o.max != null) j[o.type === 'string' ? 'max_length' : 'max_value'] = o.max;
  if (o.channelTypes) j.channel_types = o.channelTypes.map((t) => CHANNEL_TYPES[t]);
  return j;
}

const requiredFirst = (opts = []) => [...opts.filter((o) => o.required), ...opts.filter((o) => !o.required)];
const hint = (opts = []) => opts.map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ');

function subJSON(s) {
  const j = { type: 1, name: s.name, description: s.description };
  if (s.options?.length) j.options = s.options.map(optionJSON);
  return j;
}

function toSlash(def) {
  const base = { name: def.name, description: def.description, dm_permission: Boolean(def.dm), default_member_permissions: null };
  if (!def.subs) {
    if (def.options?.length) base.options = def.options.map(optionJSON);
    return base;
  }
  const options = def.subs.filter((s) => !s.group).map(subJSON);
  for (const [gname, gdesc] of Object.entries(def.groups || {})) {
    options.push({ type: 2, name: gname, description: gdesc, options: def.subs.filter((s) => s.group === gname).map(subJSON) });
  }
  return { ...base, options };
}

function register(file, mod) {
  const cat = mod.category;
  if (!cat?.key) throw new Error(`${file}: export { category: { key, label, emoji, desc }, commands: [...] }`);
  if (!categories.has(cat.key)) categories.set(cat.key, { ...cat, entries: [] });
  const entries = categories.get(cat.key).entries;

  for (const def of mod.commands) {
    if (commands.has(def.name)) throw new Error(`${file}: duplicate command "${def.name}"`);
    def.cat = cat;
    if (def.subs) {
      for (const s of def.subs) {
        if (!s.run) throw new Error(`${file}: /${def.name} ${s.name} has no run()`);
        if (s.group && !def.groups?.[s.group]) throw new Error(`${file}: /${def.name} ${s.name} uses unknown group "${s.group}"`);
        s.options = requiredFirst(s.options);
        const usage = `/${def.name}${s.group ? ` ${s.group}` : ''} ${s.name}`;
        s.usage = usage;
        entries.push({ usage, args: hint(s.options), description: s.description });
      }
    } else {
      if (!def.run) throw new Error(`${file}: /${def.name} has no run()`);
      def.options = requiredFirst(def.options);
      def.usage = `/${def.name}`;
      entries.push({ usage: def.usage, args: hint(def.options), description: def.description });
    }
    commands.set(def.name, def);
    if (def.aliases) {
      for (const a of def.aliases) aliases.set(a, def);
    }
  }
}

function loadAll() {
  const dir = path.join(__dirname, '..', 'commands');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
    register(f, require(path.join(dir, f)));
  }
  const sorted = new Map();
  for (const k of ORDER) if (categories.has(k)) sorted.set(k, categories.get(k));
  for (const [k, v] of categories) if (!sorted.has(k)) sorted.set(k, v);
  categories.clear();
  for (const [k, v] of sorted) categories.set(k, v);
  return commands;
}

function slashPayload() {
  return [...commands.values()].map(toSlash);
}

/** Find the command + subcommand a slash interaction refers to. */
function resolveSlash(interaction) {
  const def = commands.get(interaction.commandName);
  if (!def) return null;
  if (!def.subs) return { def, sub: null };
  const group = interaction.options.getSubcommandGroup(false) || null;
  const name = interaction.options.getSubcommand(false);
  const sub = def.subs.find((s) => s.name === name && (s.group || null) === group);
  return sub ? { def, sub } : null;
}

/** Find the command for prefix input. `tokens` is the list of lowercase words typed; returns how many were used. */
function resolveTokens(tokens) {
  const def = commands.get(tokens[0]) || aliases.get(tokens[0]);
  if (!def) return null;
  if (!def.subs) return { def, sub: null, used: 1 };
  const a = tokens[1];
  const b = tokens[2];
  if (def.groups?.[a] && b) {
    const sub = def.subs.find((s) => s.group === a && s.name === b);
    if (sub) return { def, sub, used: 3 };
  }
  const sub = def.subs.find((s) => !s.group && s.name === a);
  if (sub) return { def, sub, used: 2 };
  if (def.defaultSub) {
    const dsub = def.subs.find((s) => !s.group && s.name === def.defaultSub);
    if (dsub) return { def, sub: dsub, used: 1 };
  }
  return { def, sub: null, used: 1, needSub: true };
}

module.exports = { loadAll, commands, aliases, categories, slashPayload, toSlash, resolveSlash, resolveTokens, hint, TYPES };
