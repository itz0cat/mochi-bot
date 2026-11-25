const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { respond, UserError } = require('../core/context');
const subverify = require('../core/subverify');
const ui = require('../core/ui');

module.exports = {
  id: 'subverify',
  async run(client, i) {
    try {
      if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        throw new UserError('Permission Denied', 'You need the Manage Server permission to adjust verification settings.');
      }

      const action = i.customId.split(':')[1];
      const guild = i.guild;

      if (action === 'channel') {
        const selectedId = i.values[0];
        const next = subverify.setCfg(guild.id, { channelId: selectedId });
        return i.update(subverify.buildSetupPayload(guild, next));
      }

      if (action === 'role') {
        const selectedId = i.values[0];
        const next = subverify.setCfg(guild.id, { roleId: selectedId });
        return i.update(subverify.buildSetupPayload(guild, next));
      }

      if (action === 'sticky') {
        const cur = subverify.cfg(guild.id);
        const next = subverify.setCfg(guild.id, { sticky: !cur.sticky });
        return i.update(subverify.buildSetupPayload(guild, next));
      }

      if (action === 'toggle') {
        const cur = subverify.cfg(guild.id);
        const next = subverify.setCfg(guild.id, { enabled: !cur.enabled });
        return i.update(subverify.buildSetupPayload(guild, next));
      }

      if (action === 'yt') {
        const cur = subverify.cfg(guild.id);
        const modal = new ModalBuilder()
          .setCustomId('subverify:yt_modal')
          .setTitle('Target YouTube Channel')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('yt_name')
                .setLabel('YouTube Channel Name / Handle')
                .setPlaceholder('e.g. Itz0Cat')
                .setValue(cur.ytChannel || 'Itz0Cat')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(80)
            )
          );
        return i.showModal(modal);
      }

      if (action === 'yt_modal') {
        const name = i.fields.getTextInputValue('yt_name').trim();
        const next = subverify.setCfg(guild.id, { ytChannel: name });
        if (i.message) {
          await i.message.edit(subverify.buildSetupPayload(guild, next)).catch(() => {});
        }
        return i.reply({
          content: `✅ Updated target YouTube channel to **${name}**!`,
          ephemeral: true,
        });
      }

      if (action === 'post') {
        const cur = subverify.cfg(guild.id);
        if (!cur.channelId) {
          throw new UserError('No channel configured', 'Select a verification channel first.');
        }
        const ch = await guild.channels.fetch(cur.channelId).catch(() => null);
        if (!ch || !ch.isTextBased()) {
          throw new UserError('Channel invalid', 'Could not access the configured verification channel.');
        }
        await ch.send({ embeds: [subverify.stickyEmbed(cur)] });
        return i.reply({
          content: `📢 Verification guide successfully sent to ${ch}!`,
          ephemeral: true,
        });
      }
    } catch (err) {
      if (err instanceof UserError) return respond(i, ui.err(err.title, err.desc, err.hint));
      console.error('[subverify component error]', err);
      return respond(i, ui.err('Something went wrong', 'Failed to update verification setting.', 'Try again in a moment.'));
    }
  },
};
