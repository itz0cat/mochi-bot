const { EmbedBuilder } = require('discord.js');
const { colors } = require('../config');

/**
 * Message design rules (so every message in the bot feels like one family):
 *  - A soft pastel bar on the left. Each area has its own colour, errors are always cherry.
 *  - One heading line "### <emoji> Title" in sentence case, with a past-tense verb for results
 *    ("Ticket closed", "Giveaway ended").
 *  - One or two plain sentences. Errors say what went wrong and how to fix it.
 *  - At most one small hint line (-# ...) for the next step.
 *  - Fields only for facts, never for decoration.
 */
const KIND = {
  ok: { color: colors.matcha, icon: '✨' },
  err: { color: colors.cherry, icon: '🥀' },
  warn: { color: colors.butter, icon: '🍯' },
  info: { color: colors.strawberry, icon: '🌸' },
};

function build({ icon, title, desc, hint, color = colors.strawberry, fields, thumb, image, author, footer, ts: stamp, url }) {
  const lines = [];
  if (title) lines.push(`### ${icon ? `${icon} ` : ''}${title}`);
  if (desc) lines.push(desc);
  if (hint) lines.push(`-# ${hint}`);
  const embed = new EmbedBuilder().setColor(color);
  if (lines.length) embed.setDescription(lines.join('\n').slice(0, 4096));
  if (fields?.length) {
    embed.addFields(
      fields.filter(Boolean).slice(0, 25).map((f) => ({
        name: String(f.name).slice(0, 256) || '\u200b',
        value: String(f.value ?? '\u200b').slice(0, 1024) || '\u200b',
        inline: f.inline ?? true,
      }))
    );
  }
  if (thumb) embed.setThumbnail(thumb);
  if (image) embed.setImage(image);
  if (author) embed.setAuthor(typeof author === 'string' ? { name: author } : author);
  if (footer) embed.setFooter(typeof footer === 'string' ? { text: footer } : footer);
  if (stamp) embed.setTimestamp(stamp === true ? new Date() : stamp);
  if (url) embed.setURL(url);
  return embed;
}

// ui.ok('Ticket closed', 'Saved the transcript.', { hint: '...', fields: [...] })  (opts may also be a plain hint string)
const withOpts = (kind) => (title, desc, opts = {}) => {
  const o = typeof opts === 'string' ? { hint: opts } : opts;
  return build({ icon: kind.icon, color: kind.color, ...o, title, desc });
};

const ui = {
  ok: withOpts(KIND.ok),
  err: withOpts(KIND.err),
  warn: withOpts(KIND.warn),
  info: withOpts(KIND.info),
  /** Free-form card in any colour: ui.card({ icon, title, desc, hint, fields, color, thumb, ... }) */
  card: build,
  colors,
  /** "**Label:** value" lines; empty values are skipped. */
  kv: (pairs) => pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `**${k}:** ${v}`).join('\n'),
  bullets: (items) => items.map((i) => `- ${i}`).join('\n'),
  mention: { user: (id) => `<@${id}>`, role: (id) => `<@&${id}>`, channel: (id) => `<#${id}>` },
  /** ▰▰▰▱▱ progress bar */
  bar: (pct, size = 10) => { const f = Math.round(Math.max(0, Math.min(1, pct)) * size); return '▰'.repeat(f) + '▱'.repeat(size - f); },
};

module.exports = ui;
