const { respond, UserError } = require('../core/context');
const { truncate } = require('../core/util');
const { db } = require('../core/db');
const G = require('../core/giveaways');
const ui = require('../core/ui');

module.exports = {
  id: 'giveaway',
  async run(client, i) {
    try {
      const action = i.customId.split(':')[1];
      const g = G.getByMessage(i.message.id);
      if (!g) throw new UserError('Giveaway not found', 'This giveaway is no longer in my records.');

      if (action === 'entrants') {
        const list = G.entries(g.id);
        return respond(i, ui.card({ icon: '👥', title: `${list.length} ${list.length === 1 ? 'entrant' : 'entrants'}`, desc: list.slice(0, 20).map((e) => `<@${e.user_id}>${e.tickets > 1 ? ` (${e.tickets} tickets)` : ''}`).join('\n') || 'Nobody yet.', hint: list.length > 20 ? `and ${list.length - 20} more` : undefined, color: G.COLOR }));
      }
      if (g.status === 'ended') throw new UserError('Giveaway ended', 'This giveaway has already finished.');
      if (g.status === 'paused') throw new UserError('Giveaway paused', 'A manager paused this giveaway. Try again once it resumes.');

      if (action === 'claim') {
        const claimed = db.prepare("UPDATE giveaways SET status = 'ended', winner_ids = ? WHERE id = ? AND status = 'running'").run(JSON.stringify([i.user.id]), g.id);
        if (!claimed.changes) throw new UserError('Too slow', 'Someone else claimed this drop first.');
        await i.update({ embeds: [ui.card({ icon: '🏆', title: `Drop claimed: ${truncate(g.prize, 200)}`, desc: `<@${i.user.id}> was the fastest.`, hint: `Giveaway ${g.id}`, color: ui.colors.matcha })], components: [] });
        return i.followUp({ content: `🎉 ${i.user} claimed **${g.prize}**!`, allowedMentions: { users: [i.user.id] } });
      }

      if (action === 'enter') {
        const existing = db.prepare('SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').get(g.id, i.user.id);
        if (existing) {
          db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').run(g.id, i.user.id);
          await respond(i, ui.warn('You left the giveaway', 'Press Enter again if you change your mind.'));
        } else {
          const tickets = await G.eligibility(client, i.guild, i.member, g);
          db.prepare('INSERT INTO giveaway_entries (giveaway_id, user_id, tickets) VALUES (?, ?, ?)').run(g.id, i.user.id, tickets);
          await respond(i, ui.ok("You're in!", tickets > 1 ? `You entered with **${tickets}** tickets. Good luck!` : 'Good luck!', 'Press Enter again to leave.'));
        }
        await G.refreshMessage(client, G.get(g.id));
      }
    } catch (err) {
      if (err instanceof UserError) return respond(i, ui.err(err.title, err.desc, err.hint));
      console.error('[giveaway component]', err);
      return respond(i, ui.err('Something went wrong', 'That button did not work.', 'Try again in a moment.'));
    }
  },
};
