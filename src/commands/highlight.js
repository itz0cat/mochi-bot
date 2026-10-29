const { UserError } = require('../core/context');
const { db, kv } = require('../core/db');
const ui = require('../core/ui');

const COLOR = ui.colors.peach;
const pub = (name, description, options, run) => ({ name, description, perms: [], options, run });
const MAX = 15;

module.exports = {
  category: { key: 'highlight', label: 'Highlights', emoji: '✨', desc: 'Get a DM when someone says your keywords', color: COLOR },
  commands: [{
    name: 'highlight', description: 'Get notified when your words are mentioned',
    subs: [
      pub('add', 'Add a word or phrase to watch for', [{ name: 'word', type: 'string', required: true, min: 2, max: 40, description: 'The word or phrase' }], async (ctx) => {
        const w = ctx.str('word').toLowerCase().trim();
        const mine = db.prepare('SELECT word FROM highlights WHERE guild_id = ? AND user_id = ?').all(ctx.guild.id, ctx.author.id);
        if (mine.length >= MAX && !mine.some((r) => r.word === w)) throw new UserError('Too many highlights', `You can watch up to ${MAX} words.`, 'Remove one with /highlight remove.');
        db.prepare('INSERT OR IGNORE INTO highlights (guild_id, user_id, word) VALUES (?, ?, ?)').run(ctx.guild.id, ctx.author.id, w);
        await ctx.reply(ui.ok('Highlight added', `I will DM you when someone says "${w}" in a channel you can see.`, 'Make sure your DMs from this server are open.'), { ephemeral: true });
      }),
      pub('remove', 'Stop watching a word', [{ name: 'word', type: 'string', required: true, description: 'The word or phrase' }], async (ctx) => {
        const r = db.prepare('DELETE FROM highlights WHERE guild_id = ? AND user_id = ? AND word = ?').run(ctx.guild.id, ctx.author.id, ctx.str('word').toLowerCase().trim());
        if (!r.changes) throw new UserError('Not on your list', 'You are not watching that word.', 'See /highlight list.');
        await ctx.reply(ui.ok('Highlight removed', 'I will stop notifying you for it.'), { ephemeral: true });
      }),
      pub('list', 'See your highlight words', [], async (ctx) => {
        const rows = db.prepare('SELECT word FROM highlights WHERE guild_id = ? AND user_id = ? ORDER BY word').all(ctx.guild.id, ctx.author.id);
        await ctx.reply(ui.card({ icon: '✨', title: 'Your highlights', desc: rows.length ? rows.map((r) => `\`${r.word}\``).join('  ') : 'You are not watching any words yet.', hint: rows.length ? undefined : 'Add one with /highlight add.', color: COLOR }), { ephemeral: true });
      }),
      pub('clear', 'Remove all your highlight words', [], async (ctx) => {
        const r = db.prepare('DELETE FROM highlights WHERE guild_id = ? AND user_id = ?').run(ctx.guild.id, ctx.author.id);
        await ctx.reply(ui.ok('Highlights cleared', `Removed ${r.changes} ${r.changes === 1 ? 'word' : 'words'}.`), { ephemeral: true });
      }),
      pub('block', 'Stop highlight DMs from a channel (run again to undo)', [{ name: 'channel', type: 'channel', required: true, channelTypes: ['text', 'news', 'voice'], description: 'The channel' }], async (ctx) => {
        const blocks = kv.get(ctx.guild.id, 'hlblocks', {});
        const mine = new Set(blocks[ctx.author.id] || []);
        const id = ctx.chan('channel').id;
        const was = mine.delete(id);
        if (!was) mine.add(id);
        blocks[ctx.author.id] = [...mine];
        kv.set(ctx.guild.id, 'hlblocks', blocks);
        await ctx.reply(ui.ok(was ? 'Channel unblocked' : 'Channel blocked', was ? `${ctx.chan('channel')} can notify you again.` : `No more highlight DMs from ${ctx.chan('channel')}.`), { ephemeral: true });
      }),
    ],
  }],
};
