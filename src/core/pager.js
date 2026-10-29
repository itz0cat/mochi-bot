const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { respond } = require('./context');
const ui = require('./ui');

const store = new Map(); // key -> { pages, owner, page, exp }
setInterval(() => { const now = Date.now(); for (const [k, v] of store) if (v.exp < now) store.delete(k); }, 60_000).unref();

function view(key, state) {
  const embed = EmbedBuilder.from(state.pages[state.page]).setFooter({ text: `Page ${state.page + 1} of ${state.pages.length}` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pg:${key}:prev`).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(state.page === 0),
    new ButtonBuilder().setCustomId(`pg:${key}:next`).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(state.page === state.pages.length - 1)
  );
  return { embeds: [embed], components: [row] };
}

/** Send one embed, or several with prev/next buttons. */
async function paginate(ctx, pages) {
  if (pages.length === 1) return ctx.reply(pages[0]);
  const key = Math.random().toString(36).slice(2, 10);
  const state = { pages, owner: ctx.author.id, page: 0, exp: Date.now() + 10 * 60_000 };
  store.set(key, state);
  return ctx.reply(view(key, state));
}

module.exports = {
  paginate,
  id: 'pg',
  async run(client, interaction) {
    const [, key, dir] = interaction.customId.split(':');
    const state = store.get(key);
    if (!state) return respond(interaction, ui.warn('This list expired', 'Run the command again to get a fresh one.'));
    if (interaction.user.id !== state.owner) return respond(interaction, ui.warn('Not your list', 'Run the command yourself to flip through pages.'));
    state.page = Math.max(0, Math.min(state.pages.length - 1, state.page + (dir === 'next' ? 1 : -1)));
    state.exp = Date.now() + 10 * 60_000;
    return interaction.update(view(key, state));
  },
};
