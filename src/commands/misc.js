const { ChannelType } = require('discord.js');
const { UserError } = require('../core/context');
const { getJson } = require('../core/http');
const { ts, truncate, parseColor, ID_RE, chunk } = require('../core/util');
const { paginate } = require('../core/pager');
const ui = require('../core/ui');

const COLOR = ui.colors.strawberry;
const ICON = (u) => u.displayAvatarURL({ size: 1024 });

module.exports = {
  category: { key: 'misc', label: 'Misc', emoji: '🧰', desc: 'Avatars, server and user info, weather, translate, QR codes', color: COLOR },
  commands: [
    {
      name: 'avatar', description: "Show someone's avatar", dm: true,
      options: [{ name: 'user', type: 'user', description: 'Defaults to you' }],
      async run(ctx) {
        const u = ctx.user('user') || ctx.author;
        await ctx.reply(ui.card({ icon: '🖼️', title: `${u.username}'s avatar`, desc: `[PNG](${u.displayAvatarURL({ size: 1024, extension: 'png' })}) / [WebP](${u.displayAvatarURL({ size: 1024, extension: 'webp' })})`, image: ICON(u), color: COLOR }));
      },
    },
    {
      name: 'banner', description: "Show someone's profile banner", dm: true,
      options: [{ name: 'user', type: 'user', description: 'Defaults to you' }],
      async run(ctx) {
        const u = await (ctx.user('user') || ctx.author).fetch(true);
        const url = u.bannerURL({ size: 1024 });
        if (!url) throw new UserError('No banner', `${u.username} does not have a profile banner.`);
        await ctx.reply(ui.card({ icon: '🏞️', title: `${u.username}'s banner`, image: url, color: u.accentColor || COLOR }));
      },
    },
    {
      name: 'userinfo', description: 'Details about a member', dm: false,
      options: [{ name: 'user', type: 'user', description: 'Defaults to you' }],
      async run(ctx) {
        const u = ctx.user('user') || ctx.author;
        const m = await ctx.member('user') || (u.id === ctx.author.id ? ctx.me : null);
        const roles = m ? [...m.roles.cache.values()].filter((r) => r.id !== ctx.guild.id).sort((a, b) => b.position - a.position) : [];
        await ctx.reply(ui.card({
          icon: '👤', title: u.username, color: m?.displayColor || COLOR, thumb: ICON(u),
          desc: ui.kv([['Mention', `<@${u.id}>`], ['ID', `\`${u.id}\``], ['Account created', ts(u.createdTimestamp, 'D')], ['Joined server', m ? ts(m.joinedTimestamp, 'D') : 'Not in this server'], ['Bot', u.bot ? 'Yes' : null], ['Boosting since', m?.premiumSince ? ts(m.premiumSinceTimestamp, 'D') : null]]),
          fields: roles.length ? [{ name: `Roles (${roles.length})`, value: truncate(roles.slice(0, 20).map((r) => `<@&${r.id}>`).join(' '), 1000), inline: false }] : [],
        }));
      },
    },
    {
      name: 'serverinfo', description: 'Details about this server',
      async run(ctx) {
        const g = ctx.guild;
        await g.members.fetch().catch(() => {});
        const owner = await g.fetchOwner().catch(() => null);
        const ch = g.channels.cache;
        await ctx.reply(ui.card({
          icon: '🏠', title: g.name, color: COLOR, thumb: g.iconURL({ size: 512 }), image: g.bannerURL({ size: 1024 }),
          desc: g.description || undefined,
          fields: [
            { name: 'Owner', value: owner ? `<@${owner.id}>` : 'Unknown' }, { name: 'Created', value: ts(g.createdTimestamp, 'D') },
            { name: 'Members', value: `${g.memberCount} (${g.members.cache.filter((m) => !m.user.bot).size} people)` },
            { name: 'Channels', value: `${ch.filter((c) => c.type === ChannelType.GuildText).size} text, ${ch.filter((c) => c.type === ChannelType.GuildVoice).size} voice` },
            { name: 'Roles', value: String(g.roles.cache.size - 1) }, { name: 'Boosts', value: `${g.premiumSubscriptionCount || 0} (level ${g.premiumTier})` },
          ],
          hint: `ID ${g.id}`,
        }));
      },
    },
    {
      name: 'channelinfo', description: 'Details about a channel',
      options: [{ name: 'channel', type: 'channel', description: 'Defaults to this channel' }],
      async run(ctx) {
        const c = ctx.chan('channel') || ctx.channel;
        await ctx.reply(ui.card({
          icon: '#️⃣', title: c.name, color: COLOR,
          desc: ui.kv([['Mention', `<#${c.id}>`], ['ID', `\`${c.id}\``], ['Type', ChannelType[c.type]], ['Category', c.parent?.name], ['Created', ts(c.createdTimestamp, 'D')], ['Topic', c.topic ? truncate(c.topic, 200) : null], ['Slowmode', c.rateLimitPerUser ? `${c.rateLimitPerUser}s` : null], ['Age restricted', c.nsfw ? 'Yes' : null]]),
        }));
      },
    },
    {
      name: 'membercount', description: 'How many members this server has',
      async run(ctx) {
        const g = ctx.guild;
        await g.members.fetch().catch(() => {});
        const bots = g.members.cache.filter((m) => m.user.bot).size;
        await ctx.reply(ui.card({ icon: '👥', title: `${g.memberCount} members`, desc: ui.kv([['People', g.memberCount - bots], ['Bots', bots]]), color: COLOR }));
      },
    },
    {
      name: 'emojis', description: "List this server's custom emojis",
      async run(ctx) {
        const list = [...ctx.guild.emojis.cache.values()];
        if (!list.length) throw new UserError('No custom emojis', 'This server has no custom emojis yet.');
        await paginate(ctx, chunk(list, 30).map((part) => ui.card({ icon: '😊', title: `Emojis (${list.length})`, desc: part.map((e) => `${e}`).join(' '), color: COLOR })));
      },
    },
    {
      name: 'lookup', description: 'Look up any Discord user by ID', dm: true,
      options: [{ name: 'id', type: 'string', required: true, description: 'The user ID' }],
      async run(ctx) {
        if (!ID_RE.test(ctx.str('id'))) throw new UserError('Invalid ID', 'User IDs are long numbers.', 'Enable Developer Mode, right-click a user, Copy User ID.');
        const u = await ctx.client.users.fetch(ctx.str('id'), { force: true }).catch(() => null);
        if (!u) throw new UserError('User not found', 'No Discord account has that ID.');
        await ctx.reply(ui.card({ icon: '🔎', title: u.username, thumb: ICON(u), color: COLOR, desc: ui.kv([['Mention', `<@${u.id}>`], ['Created', ts(u.createdTimestamp, 'D')], ['Bot', u.bot ? 'Yes' : 'No']]), image: u.bannerURL({ size: 512 }) }));
      },
    },
    {
      name: 'define', description: 'Look up an English word', dm: true,
      options: [{ name: 'word', type: 'string', required: true, max: 40, description: 'The word' }],
      async run(ctx) {
        await ctx.defer();
        const data = await getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(ctx.str('word').trim())}`);
        const entry = Array.isArray(data) && data[0];
        if (!entry) throw new UserError('No definition found', `I could not find "${truncate(ctx.str('word'), 30)}".`, 'Check the spelling.');
        const meanings = entry.meanings.slice(0, 3).map((m) => `**${m.partOfSpeech}**\n${m.definitions.slice(0, 2).map((d, i) => `${i + 1}. ${truncate(d.definition, 200)}`).join('\n')}`);
        await ctx.reply(ui.card({ icon: '📖', title: entry.word, desc: `${entry.phonetic ? `*${entry.phonetic}*\n\n` : ''}${meanings.join('\n\n')}`, color: COLOR }));
      },
    },
    {
      name: 'github', description: 'Look up a GitHub user or repository', dm: true,
      options: [{ name: 'name', type: 'string', required: true, description: 'A username, or owner/repo' }],
      async run(ctx) {
        await ctx.defer();
        const name = ctx.str('name').trim().replace(/^https?:\/\/github\.com\//, '');
        if (!/^[\w.-]+(\/[\w.-]+)?$/.test(name)) throw new UserError('That is not a valid name', 'Use a username like octocat, or owner/repo like discordjs/discord.js.');
        const d = await getJson(`https://api.github.com/${name.includes('/') ? 'repos' : 'users'}/${name}`);
        if (!d) throw new UserError('Not found', `GitHub has no "${truncate(name, 40)}".`);
        if (name.includes('/')) await ctx.reply(ui.card({ icon: '🐙', title: d.full_name, url: d.html_url, desc: d.description || undefined, color: COLOR, thumb: d.owner?.avatar_url, fields: [{ name: 'Stars', value: String(d.stargazers_count) }, { name: 'Forks', value: String(d.forks_count) }, { name: 'Language', value: d.language || 'Unknown' }, { name: 'Open issues', value: String(d.open_issues_count) }] }));
        else await ctx.reply(ui.card({ icon: '🐙', title: d.name || d.login, url: d.html_url, desc: d.bio || undefined, color: COLOR, thumb: d.avatar_url, fields: [{ name: 'Repos', value: String(d.public_repos) }, { name: 'Followers', value: String(d.followers) }, { name: 'Following', value: String(d.following) }] }));
      },
    },
    {
      name: 'weather', description: 'Current weather for a city', dm: true,
      options: [{ name: 'city', type: 'string', required: true, max: 60, description: 'City name' }],
      async run(ctx) {
        await ctx.defer();
        const d = await getJson(`https://wttr.in/${encodeURIComponent(ctx.str('city'))}?format=j1`);
        const cur = d?.current_condition?.[0];
        if (!cur) throw new UserError('City not found', `I could not find the weather for "${truncate(ctx.str('city'), 40)}".`, 'Try the city name only, like Paris.');
        const where = d.nearest_area?.[0]?.areaName?.[0]?.value || ctx.str('city');
        await ctx.reply(ui.card({
          icon: '🌤️', title: `Weather in ${where}`, desc: `**${cur.weatherDesc?.[0]?.value || ''}**`, color: ui.colors.sky,
          fields: [{ name: 'Temperature', value: `${cur.temp_C}°C / ${cur.temp_F}°F` }, { name: 'Feels like', value: `${cur.FeelsLikeC}°C` }, { name: 'Humidity', value: `${cur.humidity}%` }, { name: 'Wind', value: `${cur.windspeedKmph} km/h` }],
        }));
      },
    },
    {
      name: 'translate', description: 'Translate text into another language', dm: true,
      options: [{ name: 'to', type: 'string', required: true, min: 2, max: 5, description: 'Language code, like es, fr, de, ja' }, { name: 'text', type: 'string', required: true, max: 400, rest: true, description: 'The text to translate' }],
      async run(ctx) {
        await ctx.defer();
        const to = ctx.str('to').toLowerCase();
        const d = await getJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(ctx.str('text'))}&langpair=autodetect|${encodeURIComponent(to)}`);
        const out = d?.responseData?.translatedText;
        if (!out || d.responseStatus >= 400) throw new UserError('I could not translate that', 'The language code may be wrong.', 'Use a two letter code like es, fr, de, ja or pt.');
        await ctx.reply(ui.card({ icon: '🌍', title: `Translated to ${to}`, desc: truncate(out, 1800), hint: truncate(ctx.str('text'), 150), color: COLOR }));
      },
    },
    {
      name: 'qr', description: 'Make a QR code', dm: true,
      options: [{ name: 'text', type: 'string', required: true, max: 500, rest: true, description: 'Text or a link' }],
      async run(ctx) {
        const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=12&data=${encodeURIComponent(ctx.str('text'))}`;
        await ctx.reply(ui.card({ icon: '🔳', title: 'Your QR code', image: url, hint: truncate(ctx.str('text'), 120), color: COLOR }));
      },
    },
    {
      name: 'color', description: 'Preview a colour', dm: true,
      options: [{ name: 'color', type: 'string', required: true, description: 'Hex like #ffb7d5, or a name like pink' }],
      async run(ctx) {
        const c = parseColor(ctx.str('color'));
        if (c === null) throw new UserError('Invalid colour', 'Use a hex code like #ffb7d5, or a name like pink, blue or purple.');
        const hex = c.toString(16).padStart(6, '0');
        await ctx.reply(ui.card({ icon: '🎨', title: `#${hex}`, desc: ui.kv([['RGB', `${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}`], ['Decimal', c]]), color: c, thumb: `https://singlecolorimage.com/get/${hex}/120x120` }));
      },
    },
  ],
};
