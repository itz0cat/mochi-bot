const subverify = require('../core/subverify');

module.exports = {
  category: {
    key: 'utility',
    label: 'Utility',
    emoji: '🔧',
    desc: 'AFK, polls, reminders, embeds, snipe, custom commands',
  },
  commands: [
    {
      name: 'subverify',
      aliases: ['subv', 'ytverify', 'youtubeverify', 'verifysub', 'subsetup'],
      description: 'Setup YouTube subscription screenshot verification',
      perms: ['ManageGuild'],
      options: [
        {
          name: 'channel',
          type: 'channel',
          description: 'Channel to check screenshots in',
          channelTypes: ['text', 'news'],
        },
        {
          name: 'role',
          type: 'role',
          description: 'Role to give verified subscribers',
        },
        {
          name: 'youtube',
          type: 'string',
          description: 'Target YouTube channel name or handle',
        },
        {
          name: 'sticky',
          type: 'bool',
          description: 'Enable or disable sticky guide message',
        },
      ],
      async run(ctx) {
        if (!ctx.guild) return;

        const patch = {};
        const ch = ctx.chan('channel');
        if (ch) patch.channelId = ch.id;

        const r = ctx.role('role');
        if (r) patch.roleId = r.id;

        const yt = ctx.str('youtube');
        if (yt) patch.ytChannel = yt.trim();

        const st = ctx.bool('sticky');
        if (st !== null && st !== undefined) patch.sticky = st;

        let cfg = subverify.cfg(ctx.guild.id);
        if (Object.keys(patch).length > 0) {
          cfg = subverify.setCfg(ctx.guild.id, patch);
        }

        const payload = subverify.buildSetupPayload(ctx.guild, cfg);
        return ctx.reply(payload);
      },
    },
  ],
};
