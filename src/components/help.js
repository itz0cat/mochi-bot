const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { categories } = require('../core/registry');
const { respond } = require('../core/context');
const { truncate } = require('../core/util');
const { brand, colors } = require('../config');
const ui = require('../core/ui');

function menu(userId, selected) {
  const options = [
    { label: 'Overview', value: 'overview', emoji: '🏠', description: 'Every category at a glance', default: selected === 'overview' },
    ...[...categories.values()].map((c) => ({
      label: c.label, value: c.key, emoji: c.emoji, description: truncate(c.desc, 100), default: selected === c.key,
    })),
  ];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`help:menu:${userId}`).setPlaceholder('Pick a category').addOptions(options)
  );
}

function overview(client, userId, prefix = '/') {
  const cats = [...categories.values()];
  const total = cats.reduce((n, c) => n + c.entries.length, 0);
  const embed = ui.card({
    icon: brand.emoji,
    title: `Hi, I'm ${client.user.username}`,
    desc: [
      `I handle moderation, tickets, giveaways, invites and more. Pick a category in the menu to see its commands.`,
      `Type \`/\` and choose a command, or use the prefix: \`${prefix}ticket new\`.`,
    ].join('\n'),
    color: colors.strawberry,
    fields: cats.map((c) => ({ name: `${c.emoji} ${c.label}`, value: `${c.desc}\n-# ${c.entries.length} commands`, inline: true })),
    footer: `${total} commands`,
  });
  return { embeds: [embed], components: [menu(userId, 'overview')] };
}

function category(client, key, userId) {
  const cat = categories.get(key);
  if (!cat) return overview(client, userId);
  const lines = cat.entries.map((e) => `**${e.usage}**${e.args ? ` \`${e.args}\`` : ''}\n-# ${truncate(e.description, 80)}`);
  const embed = ui.card({
    icon: cat.emoji,
    title: cat.label,
    desc: `${cat.desc}\n\n${lines.join('\n')}`.slice(0, 4000),
    color: cat.color || colors.strawberry,
    footer: '<required>  [optional]',
  });
  return { embeds: [embed], components: [menu(userId, key)] };
}

function search(client, query, userId) {
  const q = query.toLowerCase().replace(/^[/.!]/, '').trim();
  const direct = [...categories.values()].find((c) => c.key === q || c.label.toLowerCase() === q);
  if (direct) return category(client, direct.key, userId);
  const hits = [...categories.values()].flatMap((c) => c.entries).filter((e) => e.usage.includes(q) || e.description.toLowerCase().includes(q));
  if (!hits.length) {
    return { embeds: [ui.err('No match', `Nothing matches "${truncate(query, 40)}".`, 'Try a shorter word, or browse with the menu.')], components: [menu(userId, 'overview')] };
  }
  const lines = hits.slice(0, 12).map((e) => `**${e.usage}**${e.args ? ` \`${e.args}\`` : ''}\n-# ${truncate(e.description, 80)}`);
  return { embeds: [ui.card({ icon: '🔎', title: `Results for "${truncate(query, 30)}"`, desc: lines.join('\n'), color: colors.sky })], components: [menu(userId, 'overview')] };
}

module.exports = {
  id: 'help',
  overview, category, search,
  async run(client, interaction) {
    const owner = interaction.customId.split(':')[2];
    if (owner && interaction.user.id !== owner) {
      return respond(interaction, ui.warn('That menu is not yours', 'Run /help to get your own.'));
    }
    const key = interaction.values?.[0] || 'overview';
    return interaction.update(key === 'overview' ? overview(client, interaction.user.id) : category(client, key, interaction.user.id));
  },
};
