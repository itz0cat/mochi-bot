const { UserError } = require('../core/context');
const { parseDuration, fmtDuration, parseColor, truncate, ts, chunk } = require('../core/util');
const { evaluate } = require('../core/calc');
const { db, kv } = require('../core/db');
const scheduler = require('../core/scheduler');
const snipes = require('../core/snipes');
const ui = require('../core/ui');

const COLOR = ui.colors.sky;
const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
const sub = (name, description, options, run, extra = {}) => ({ name, description, options, run, ...extra });

scheduler.on('reminder', async (client, row) => {
  const { text, channelId } = row.data;
  const user = await client.users.fetch(row.target_id).catch(() => null);
  if (!user) return;
  const embed = ui.card({ icon: '⏰', title: 'Reminder', desc: text, color: ui.colors.butter });
  const sent = await user.send({ embeds: [embed] }).then(() => true).catch(() => false);
  if (!sent && channelId) {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (ch?.isTextBased()) await ch.send({ content: `<@${user.id}>`, embeds: [embed], allowedMentions: { users: [user.id] } }).catch(() => {});
  }
});

// "in 2h" / "2h" -> a time from now; "2026-12-25 18:00" -> that moment (UTC)
function parseWhen(input) {
  const s = String(input).trim().toLowerCase().replace(/^in\s+/, '');
  const d = parseDuration(s);
  if (d) return Date.now() + d;
  const t = Date.parse(/z$|[+-]\d\d:?\d\d$/i.test(input) ? input : `${input.trim().replace(' ', 'T')}Z`);
  return Number.isNaN(t) ? null : t;
}

module.exports = {
  category: { key: 'utility', label: 'Utility', emoji: '🔧', desc: 'AFK, polls, reminders, embeds, snipe, custom commands', color: COLOR },
  commands: [
    {
      name: 'afk', description: 'Let people know you are away',
      options: [{ name: 'reason', type: 'string', max: 120, description: 'Why are you away?' }],
      async run(ctx) {
        const reason = ctx.str('reason') || 'Away';
        db.prepare('INSERT OR REPLACE INTO afk (guild_id, user_id, reason, since) VALUES (?, ?, ?, ?)').run(ctx.guild.id, ctx.author.id, reason, Date.now());
        await ctx.reply(ui.card({ icon: '🌙', title: `${ctx.author.username} is now AFK`, desc: `**${truncate(reason, 120)}**\nI will let people know, and welcome you back when you talk again.`, color: COLOR }));
      },
    },
    {
      name: 'say', description: 'Make me say something', perms: ['ManageMessages'],
      options: [{ name: 'message', type: 'string', required: true, max: 1900, rest: true, description: 'What should I say?' }, { name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Defaults to this channel' }],
      async run(ctx) {
        const ch = ctx.chan('channel') || ctx.channel;
        await ch.send({ content: ctx.str('message'), allowedMentions: { parse: [] } });
        if (ctx.message?.deletable) ctx.message.delete().catch(() => {});
        else await ctx.reply(ui.ok('Sent', ch.id === ctx.channel.id ? undefined : `Posted in ${ch}.`), { ephemeral: true });
      },
    },
    {
      name: 'embed', description: 'Post a custom embed', perms: ['ManageMessages'],
      options: [
        { name: 'description', type: 'string', required: true, max: 4000, rest: true, description: 'The text' }, { name: 'title', type: 'string', max: 250, description: 'Title' },
        { name: 'color', type: 'string', description: 'Hex like #ffb7d5, or a colour name' }, { name: 'image', type: 'string', description: 'Image link' },
        { name: 'footer', type: 'string', max: 200, description: 'Small text at the bottom' }, { name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Defaults to this channel' },
      ],
      async run(ctx) {
        const color = ctx.str('color') ? parseColor(ctx.str('color')) : ui.colors.strawberry;
        if (color === null) throw new UserError('Invalid colour', 'Use a hex code like #ffb7d5, or a name like pink, blue or purple.');
        if (ctx.str('image') && !/^https?:\/\//.test(ctx.str('image'))) throw new UserError('Invalid image', 'The image must be a link starting with http.');
        const ch = ctx.chan('channel') || ctx.channel;
        await ch.send({ embeds: [ui.card({ title: ctx.str('title'), desc: ctx.str('description'), color, image: ctx.str('image'), footer: ctx.str('footer') })], allowedMentions: { parse: [] } });
        await ctx.reply(ui.ok('Embed posted', ch.id === ctx.channel.id ? undefined : `Posted in ${ch}.`), { ephemeral: true });
      },
    },
    {
      name: 'announce', description: 'Post an announcement', perms: ['ManageGuild'],
      options: [
        { name: 'message', type: 'string', required: true, max: 3500, rest: true, description: 'The announcement' }, { name: 'channel', type: 'channel', channelTypes: ['text', 'news'], description: 'Defaults to this channel' },
        { name: 'title', type: 'string', max: 200, description: 'Headline' }, { name: 'ping', type: 'string', choices: [['@everyone', 'everyone'], ['@here', 'here']], description: 'Ping everyone or online members' }, { name: 'role', type: 'role', description: 'Or ping a role' },
      ],
      async run(ctx) {
        const ch = ctx.chan('channel') || ctx.channel; const role = ctx.role('role'); const ping = ctx.str('ping');
        const content = role ? `<@&${role.id}>` : ping ? `@${ping}` : undefined;
        await ch.send({
          content, embeds: [ui.card({ icon: '📣', title: ctx.str('title') || 'Announcement', desc: ctx.str('message'), color: ui.colors.peach, footer: `From ${ctx.author.username}` })],
          allowedMentions: role ? { roles: [role.id] } : ping ? { parse: ['everyone'] } : { parse: [] },
        });
        await ctx.reply(ui.ok('Announcement posted', ch.id === ctx.channel.id ? undefined : `Posted in ${ch}.`), { ephemeral: true });
      },
    },
    {
      name: 'poll', description: 'Start a poll with reaction voting',
      options: [{ name: 'question', type: 'string', required: true, max: 250, description: 'The question' }, { name: 'choices', type: 'string', max: 800, description: 'Up to 9 choices separated by | (leave empty for yes or no)' }],
      async run(ctx) {
        const choices = ctx.str('choices') ? ctx.str('choices').split('|').map((s) => s.trim()).filter(Boolean) : [];
        if (choices.length === 1 || choices.length > 9) throw new UserError('Check your choices', 'Give between 2 and 9 choices separated by |, or leave it empty for a yes or no poll.', 'Example: Pizza | Tacos | Sushi');
        const emojis = choices.length ? NUM.slice(0, choices.length) : ['👍', '👎'];
        const desc = choices.length ? choices.map((c, i) => `${NUM[i]} ${c}`).join('\n') : 'Vote with 👍 or 👎';
        const msg = await ctx.channel.send({ embeds: [ui.card({ icon: '📊', title: ctx.str('question'), desc, footer: `Asked by ${ctx.author.username}`, color: COLOR })] });
        for (const e of emojis) await msg.react(e).catch(() => {});
        await ctx.reply(ui.ok('Poll started', 'React to vote!'), { ephemeral: true });
      },
    },
    {
      name: 'snipe', description: 'Show the last deleted message in this channel', perms: ['ManageMessages'],
      async run(ctx) {
        const s = snipes.deleted.get(ctx.channel.id);
        if (!s) throw new UserError('Nothing to snipe', 'No message was deleted here recently.', 'I only remember deletes since I last started.');
        await ctx.reply(ui.card({ icon: '🔫', title: 'Last deleted message', desc: truncate(s.content || '(no text)', 1800), author: { name: s.author, iconURL: s.avatar }, hint: `Deleted ${ts(s.at)}`, color: COLOR }));
      },
    },
    {
      name: 'editsnipe', description: 'Show the last edited message in this channel', perms: ['ManageMessages'],
      async run(ctx) {
        const s = snipes.edited.get(ctx.channel.id);
        if (!s) throw new UserError('Nothing to snipe', 'No message was edited here recently.', 'I only remember edits since I last started.');
        await ctx.reply(ui.card({ icon: '✏️', title: 'Last edited message', author: { name: s.author, iconURL: s.avatar }, color: COLOR, fields: [{ name: 'Before', value: truncate(s.before || '(empty)', 1000), inline: false }, { name: 'After', value: truncate(s.after || '(empty)', 1000), inline: false }], hint: `Edited ${ts(s.at)}` }));
      },
    },
    {
      name: 'timestamp', description: 'Make Discord timestamps you can paste', dm: true,
      options: [{ name: 'time', type: 'string', required: true, description: 'Like "in 2h" or "2026-12-25 18:00" (UTC)' }],
      async run(ctx) {
        const at = parseWhen(ctx.str('time'));
        if (!at) throw new UserError('Could not read that time', 'Try "in 2h", "3d", or a date like 2026-12-25 18:00 (UTC).');
        const s = Math.floor(at / 1000);
        const styles = [['Relative', 'R'], ['Short time', 't'], ['Long time', 'T'], ['Short date', 'd'], ['Long date', 'D'], ['Date and time', 'f'], ['Full', 'F']];
        await ctx.reply(ui.card({ icon: '🕒', title: 'Timestamps', desc: styles.map(([n, c]) => `${n}: <t:${s}:${c}>\n\`<t:${s}:${c}>\``).join('\n'), color: COLOR }));
      },
    },
    {
      name: 'calc', description: 'Do some maths', dm: true,
      options: [{ name: 'expression', type: 'string', required: true, max: 200, description: 'Like 12 * (3 + 4) or sqrt(81)' }],
      async run(ctx) {
        let result;
        try { result = evaluate(ctx.str('expression')); } catch (e) { throw new UserError('I could not solve that', `Something is off: ${e.message}.`, 'I understand + - * / % ^ ( ) and sqrt, abs, round, floor, ceil, sin, cos, tan, log, ln, pi, e.'); }
        await ctx.reply(ui.card({ icon: '🧮', title: String(Math.round(result * 1e10) / 1e10), desc: `\`${truncate(ctx.str('expression'), 150)}\``, color: COLOR }));
      },
    },
    {
      name: 'reminder', description: 'Set personal reminders', dm: true,
      groups: {},
      subs: [
        sub('add', 'Remind me about something', [{ name: 'time', type: 'string', required: true, description: 'When? Like 30m, 2h or 1d' }, { name: 'task', type: 'string', required: true, max: 500, rest: true, description: 'What should I remind you about?' }], async (ctx) => {
          const ms = parseDuration(ctx.str('time').replace(/^in\s+/i, ''));
          if (!ms || ms < 5000 || ms > 365 * 86400000) throw new UserError('Invalid time', 'Use a number and unit between 5 seconds and 1 year, like 30m, 2h or 3d.');
          const count = scheduler.listWhere('reminder', ctx.guild?.id ?? 'dm', ctx.author.id).length;
          if (count >= 20) throw new UserError('Too many reminders', 'You can have up to 20 reminders at once.', 'Remove one with /reminder delete.');
          scheduler.add('reminder', Date.now() + ms, { guildId: ctx.guild?.id ?? 'dm', targetId: ctx.author.id, data: { text: ctx.str('task'), channelId: ctx.channel?.id } });
          await ctx.reply(ui.ok('Reminder set', `I will remind you ${ts(Date.now() + ms)}: ${truncate(ctx.str('task'), 200)}`, 'I will DM you, or ping you here if your DMs are closed.'), { ephemeral: true });
        }, { perms: [] }),
        sub('list', 'See your reminders', [], async (ctx) => {
          const list = scheduler.listWhere('reminder', ctx.guild?.id ?? 'dm', ctx.author.id);
          await ctx.reply(ui.card({ icon: '⏰', title: 'Your reminders', desc: list.length ? list.map((r, i) => `**${i + 1}.** ${ts(r.run_at)}: ${truncate(r.data.text, 100)}`).join('\n') : 'No reminders yet.', hint: list.length ? 'Remove one with /reminder delete.' : 'Set one with /reminder add.', color: ui.colors.butter }), { ephemeral: true });
        }, { perms: [] }),
        sub('delete', 'Remove a reminder by its number in your list', [{ name: 'number', type: 'int', required: true, min: 1, description: 'Number from /reminder list' }], async (ctx) => {
          const list = scheduler.listWhere('reminder', ctx.guild?.id ?? 'dm', ctx.author.id);
          const r = list[ctx.int('number') - 1];
          if (!r) throw new UserError('Reminder not found', `You do not have a reminder number ${ctx.int('number')}.`, 'See /reminder list.');
          scheduler.cancel(r.id);
          await ctx.reply(ui.ok('Reminder removed', truncate(r.data.text, 150)), { ephemeral: true });
        }, { perms: [] }),
      ],
    },
    {
      name: 'autoresponder', description: 'Reply automatically to certain words', perms: ['ManageGuild'],
      subs: [
        sub('add', 'Add an automatic reply', [{ name: 'trigger', type: 'string', required: true, max: 80, description: 'The word or phrase to look for' }, { name: 'response', type: 'string', required: true, max: 1500, rest: true, description: 'What I should say' }, { name: 'mode', type: 'string', choices: [['Message contains it', 'contains'], ['Message is exactly it', 'exact']], description: 'How to match (default contains)' }], async (ctx) => {
          const list = kv.get(ctx.guild.id, 'autoresponders', []);
          const trigger = ctx.str('trigger').toLowerCase();
          if (list.length >= 50 && !list.some((x) => x.trigger === trigger)) throw new UserError('Too many auto replies', 'You can have up to 50.');
          kv.set(ctx.guild.id, 'autoresponders', list.filter((x) => x.trigger !== trigger).concat({ trigger, response: ctx.str('response'), mode: ctx.str('mode') || 'contains' }));
          await ctx.reply(ui.ok('Auto reply added', `When someone says "${truncate(trigger, 40)}" I will answer.`, 'Placeholders: {user} {server}'));
        }),
        sub('remove', 'Remove an automatic reply', [{ name: 'trigger', type: 'string', required: true, description: 'The trigger word or phrase' }], async (ctx) => {
          const list = kv.get(ctx.guild.id, 'autoresponders', []); const t = ctx.str('trigger').toLowerCase();
          if (!list.some((x) => x.trigger === t)) throw new UserError('Not found', `There is no auto reply for "${truncate(t, 40)}".`, 'See /autoresponder list.');
          kv.set(ctx.guild.id, 'autoresponders', list.filter((x) => x.trigger !== t));
          await ctx.reply(ui.ok('Auto reply removed', truncate(t, 60)));
        }),
        sub('list', 'See all automatic replies', [], async (ctx) => {
          const list = kv.get(ctx.guild.id, 'autoresponders', []);
          await ctx.reply(ui.card({ icon: '💬', title: 'Auto replies', desc: list.length ? list.map((x) => `**${truncate(x.trigger, 40)}** (${x.mode}): ${truncate(x.response, 60)}`).join('\n') : 'No auto replies yet.', hint: list.length ? undefined : 'Add one with /autoresponder add.', color: COLOR }));
        }),
      ],
    },
    {
      name: 'customcmd', description: 'Make your own text commands', perms: ['ManageGuild'],
      subs: [
        sub('add', 'Create a custom command', [{ name: 'name', type: 'string', required: true, min: 1, max: 30, description: 'Command name (no spaces)' }, { name: 'response', type: 'string', required: true, max: 1500, rest: true, description: 'What I should say' }], async (ctx) => {
          const name = ctx.str('name').toLowerCase().replace(/^[^a-z0-9]+/, '');
          if (!/^[a-z0-9_-]+$/.test(name)) throw new UserError('Invalid name', 'Use letters, numbers, dashes and underscores only.');
          const all = kv.get(ctx.guild.id, 'customcmds', {});
          if (Object.keys(all).length >= 50 && !all[name]) throw new UserError('Too many commands', 'You can have up to 50 custom commands.');
          all[name] = ctx.str('response'); kv.set(ctx.guild.id, 'customcmds', all);
          const prefix = kv.get(ctx.guild.id, 'prefix', '.');
          await ctx.reply(ui.ok('Custom command created', `Members can now type \`${prefix}${name}\`.`, 'Placeholders: {user} {server}'));
        }),
        sub('remove', 'Delete a custom command', [{ name: 'name', type: 'string', required: true, description: 'Command name' }], async (ctx) => {
          const all = kv.get(ctx.guild.id, 'customcmds', {}); const name = ctx.str('name').toLowerCase();
          if (!all[name]) throw new UserError('Command not found', `There is no custom command "${truncate(name, 30)}".`, 'See /customcmd list.');
          delete all[name]; kv.set(ctx.guild.id, 'customcmds', all);
          await ctx.reply(ui.ok('Custom command deleted', name));
        }),
        sub('list', 'See custom commands', [], async (ctx) => {
          const all = Object.keys(kv.get(ctx.guild.id, 'customcmds', {})); const prefix = kv.get(ctx.guild.id, 'prefix', '.');
          await ctx.reply(ui.card({ icon: '🧩', title: 'Custom commands', desc: all.length ? all.map((n) => `\`${prefix}${n}\``).join('  ') : 'No custom commands yet.', hint: all.length ? undefined : 'Make one with /customcmd add.', color: COLOR }));
        }),
      ],
    },
    {
      name: 'sticky', description: 'Keep a message at the bottom of a channel', perms: ['ManageMessages'], botPerms: ['ManageMessages'],
      subs: [
        sub('set', 'Pin a sticky message to the bottom of this channel', [{ name: 'message', type: 'string', required: true, max: 1800, rest: true, description: 'The message text' }], async (ctx) => {
          const all = kv.get(ctx.guild.id, 'stickies', {});
          const old = all[ctx.channel.id];
          if (old?.msgId) await ctx.channel.messages.delete(old.msgId).catch(() => {});
          const msg = await ctx.channel.send({ embeds: [ui.card({ icon: '📌', title: 'Sticky', desc: ctx.str('message'), color: ui.colors.butter })] });
          all[ctx.channel.id] = { text: ctx.str('message'), msgId: msg.id }; kv.set(ctx.guild.id, 'stickies', all);
          await ctx.reply(ui.ok('Sticky message set', 'It will move to the bottom whenever someone chats.'), { ephemeral: true });
        }),
        sub('remove', 'Remove the sticky message from this channel', [], async (ctx) => {
          const all = kv.get(ctx.guild.id, 'stickies', {}); const cur = all[ctx.channel.id];
          if (!cur) throw new UserError('No sticky here', 'This channel does not have a sticky message.');
          if (cur.msgId) await ctx.channel.messages.delete(cur.msgId).catch(() => {});
          delete all[ctx.channel.id]; kv.set(ctx.guild.id, 'stickies', all);
          await ctx.reply(ui.ok('Sticky message removed'), { ephemeral: true });
        }),
      ],
    },
  ],
};
