const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { respond, UserError } = require('../core/context');
const T = require('../core/tickets');
const ui = require('../core/ui');

const ticketOf = (i) => {
  const t = T.byChannel(i.channelId);
  if (!t || t.status === 'deleted') throw new UserError('This is not a ticket', 'That ticket no longer exists.');
  return t;
};
const staffOnly = (i) => {
  if (!T.isStaff(i.member, T.cfg(i.guild.id))) throw new UserError('Staff only', 'Only support staff can use this button.');
};

module.exports = {
  id: 'ticket',
  async run(client, i) {
    try {
      const action = i.customId.split(':')[1];
      const guild = i.guild;

      if (action === 'open') {
        const modal = new ModalBuilder().setCustomId('ticket:modal').setTitle('Open a ticket').addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('reason').setLabel('What do you need help with?').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(400)
          )
        );
        return i.showModal(modal);
      }

      if (action === 'modal') {
        await i.deferReply({ flags: 64 });
        const { channel } = await T.openTicket(client, guild, i.user, i.fields.getTextInputValue('reason'));
        return i.editReply({ embeds: [ui.card({ icon: '🎫', title: 'Your ticket is ready', desc: `Head over to ${channel} and tell us what you need.`, color: ui.colors.sky })] });
      }

      const t = ticketOf(i);

      if (action === 'close') {
        if (t.status !== 'open') throw new UserError('Already closed', 'This ticket is already closed.');
        if (i.user.id !== t.opener_id) staffOnly(i);
        return i.reply(await T.closeTicket(guild, t, i.user));
      }
      if (action === 'claim') {
        staffOnly(i);
        if (t.claimed_by) throw new UserError('Already claimed', `<@${t.claimed_by}> is handling this ticket.`);
        T.setClaim(t.id, i.user.id);
        await i.message.edit({ components: [T.controlRow(T.byChannel(t.channel_id))] }).catch(() => {});
        return i.reply({ embeds: [ui.card({ icon: '🙋', title: 'Ticket claimed', desc: `<@${i.user.id}> is on it.`, color: ui.colors.sky })], allowedMentions: { parse: [] } });
      }
      if (action === 'reopen') {
        staffOnly(i);
        return i.reply(await T.reopenTicket(guild, t, i.user));
      }
      if (action === 'transcript') {
        staffOnly(i);
        await i.deferReply();
        const { file, count } = await T.buildTranscript(i.channel);
        await T.logTo(guild, { embeds: [ui.card({ icon: '📄', title: `Transcript of ticket ${t.num}`, desc: `${count} messages, saved by <@${i.user.id}>.`, color: ui.colors.sky })], files: [(await T.buildTranscript(i.channel)).file] });
        return i.editReply({ embeds: [ui.ok('Transcript saved', `${count} messages are in the file below.`)], files: [file] });
      }
      if (action === 'delete') {
        staffOnly(i);
        await i.reply({ embeds: [ui.card({ icon: '🗑️', title: 'Deleting this ticket in 5 seconds', desc: 'Saving a transcript first.', color: ui.colors.cherry })] });
        return T.deleteTicket(client, guild, t, i.user);
      }
    } catch (err) {
      if (err instanceof UserError) return respond(i, ui.err(err.title, err.desc, err.hint));
      console.error('[ticket component]', err);
      return respond(i, ui.err('Something went wrong', 'That button did not work.', 'Try again in a moment.'));
    }
  },
};
