/** Checks the slash command payload against Discord's limits. Run: npm run validate */
const NAME_RE = /^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

function size(node) {
  let n = (node.name?.length || 0) + (node.description?.length || 0);
  for (const c of node.choices || []) n += String(c.name).length + String(c.value).length;
  for (const o of node.options || []) n += size(o);
  return n;
}

function walk(node, where, out) {
  const here = `${where}/${node.name}`;
  if (!NAME_RE.test(node.name) || node.name !== node.name.toLowerCase()) out.push(`${here}: invalid name`);
  if (!node.description || node.description.length > 100) out.push(`${here}: description must be 1-100 characters (${node.description?.length})`);
  const opts = node.options || [];
  if (opts.length > 25) out.push(`${here}: ${opts.length} options (max 25)`);
  const seen = new Set();
  let optional = false;
  for (const o of opts) {
    if (seen.has(o.name)) out.push(`${here}: duplicate name "${o.name}"`);
    seen.add(o.name);
    if (o.type === 1 || o.type === 2) { walk(o, here, out); continue; }
    if (o.required && optional) out.push(`${here}: required option "${o.name}" comes after an optional one`);
    if (!o.required) optional = true;
    if (!NAME_RE.test(o.name) || o.name !== o.name.toLowerCase()) out.push(`${here}: invalid option name "${o.name}"`);
    if (!o.description || o.description.length > 100) out.push(`${here}/${o.name}: option description must be 1-100 characters (${o.description?.length})`);
    if (o.choices && o.choices.length > 25) out.push(`${here}/${o.name}: too many choices`);
  }
}

function validatePayload(body) {
  const out = [];
  if (body.length > 100) out.push(`${body.length} top-level commands (max 100)`);
  const names = new Set();
  for (const cmd of body) {
    if (names.has(cmd.name)) out.push(`duplicate command "${cmd.name}"`);
    names.add(cmd.name);
    walk(cmd, '', out);
    const total = size(cmd);
    if (total > 8000) out.push(`/${cmd.name}: ${total} characters of names and descriptions (Discord max 8000)`);
  }
  return out;
}

module.exports = { validatePayload, size };

if (require.main === module) {
  const registry = require('../src/core/registry');
  registry.loadAll();
  const body = registry.slashPayload();
  const problems = validatePayload(body);
  const subs = [...registry.commands.values()].reduce((n, d) => n + (d.subs ? d.subs.length : 1), 0);
  console.log(`Top-level slash commands: ${body.length} / 100   (${subs} commands in total)`);
  for (const cmd of body) if (cmd.options?.some((o) => o.type === 1 || o.type === 2)) console.log(`  /${cmd.name}: ${size(cmd)} / 8000`);
  if (problems.length) { console.error('PROBLEMS:\n - ' + problems.join('\n - ')); process.exit(1); }
  console.log('OK: everything is within Discord limits.');
}
