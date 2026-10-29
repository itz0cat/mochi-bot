const { MessageFlags, EmbedBuilder } = require('discord.js');

/** Throw this from a command to show a friendly error: throw new UserError('Title', 'What went wrong and how to fix it') */
class UserError extends Error {
  constructor(title, desc, hint) {
    super(title);
    this.title = title;
    this.desc = desc;
    this.hint = hint;
  }
}

function norm(p) {
  if (p instanceof EmbedBuilder) return { embeds: [p] };
  if (Array.isArray(p)) return { embeds: p };
  if (typeof p === 'string') return { content: p };
  return { ...p };
}

/**
 * One interface for slash commands AND prefix commands, so each command is written once.
 *   ctx.author / ctx.me / ctx.guild / ctx.channel / ctx.client
 *   ctx.str('x') ctx.int('x') ctx.num('x') ctx.bool('x') ctx.user('x') ctx.role('x') ctx.chan('x') await ctx.member('x')
 *   await ctx.reply(embedOrPayload, { ephemeral })   await ctx.defer()   await ctx.edit(payload)   await ctx.send(payload)
 */
class Ctx {
  constructor(client, { interaction = null, message = null, args = {}, path = '' }) {
    this.client = client;
    this.interaction = interaction;
    this.message = message;
    this.args = args;
    this.path = path;
    this.lastSent = null;
  }

  get isSlash() { return Boolean(this.interaction); }
  get author() { return this.interaction ? this.interaction.user : this.message.author; }
  get me() { return this.interaction ? this.interaction.member : this.message.member; }
  get guild() { return this.interaction ? this.interaction.guild : this.message.guild; }
  get channel() { return this.interaction ? this.interaction.channel : this.message.channel; }
  get prefix() { return this.prefixUsed || '/'; }

  // ---- options ----
  str(n, d = null) { return (this.interaction ? this.interaction.options.getString(n) : this.args[n]) ?? d; }
  int(n, d = null) { return (this.interaction ? this.interaction.options.getInteger(n) : this.args[n]) ?? d; }
  num(n, d = null) { return (this.interaction ? this.interaction.options.getNumber(n) : this.args[n]) ?? d; }
  bool(n, d = null) { return (this.interaction ? this.interaction.options.getBoolean(n) : this.args[n]) ?? d; }
  user(n) { return (this.interaction ? this.interaction.options.getUser(n) : this.args[n]) ?? null; }
  role(n) { return (this.interaction ? this.interaction.options.getRole(n) : this.args[n]) ?? null; }
  chan(n) { return (this.interaction ? this.interaction.options.getChannel(n) : this.args[n]) ?? null; }
  async member(n) {
    const u = this.user(n);
    if (!u || !this.guild) return null;
    return this.guild.members.cache.get(u.id) || this.guild.members.fetch(u.id).catch(() => null);
  }

  // ---- replying ----
  async reply(payload, { ephemeral, fetch = false } = {}) {
    const p = norm(payload);
    const eph = ephemeral ?? p.ephemeral;
    delete p.ephemeral;
    if (p.allowedMentions === undefined) p.allowedMentions = { parse: [] };

    if (this.interaction) {
      const i = this.interaction;
      if (!i.deferred && !i.replied) {
        if (eph) p.flags = MessageFlags.Ephemeral;
        await i.reply(p);
      } else if (i.deferred && !i.replied) {
        await i.editReply(p);
      } else {
        if (eph) p.flags = MessageFlags.Ephemeral;
        await i.followUp(p);
      }
      return fetch ? i.fetchReply().catch(() => null) : null;
    }
    const sent = await this.message.reply({ ...p, failIfNotExists: false }).catch(() => this.channel.send(p).catch(() => null));
    this.lastSent = sent;
    return sent;
  }

  async defer({ ephemeral = false } = {}) {
    if (this.interaction) {
      if (!this.interaction.deferred && !this.interaction.replied) {
        await this.interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
      }
    } else {
      await this.channel.sendTyping().catch(() => {});
    }
  }

  async edit(payload) {
    const p = norm(payload);
    if (p.allowedMentions === undefined) p.allowedMentions = { parse: [] };
    if (this.interaction) return this.interaction.editReply(p);
    return this.lastSent ? this.lastSent.edit(p) : this.reply(p);
  }

  /** Send a normal message in the channel (not a reply). */
  async send(payload) {
    const p = norm(payload);
    if (p.allowedMentions === undefined) p.allowedMentions = { parse: [] };
    return this.channel.send(p);
  }
}

/** Respond to a button/select/modal interaction no matter its current state. */
async function respond(interaction, payload, { ephemeral = true } = {}) {
  const p = norm(payload);
  if (p.allowedMentions === undefined) p.allowedMentions = { parse: [] };
  if (ephemeral) p.flags = MessageFlags.Ephemeral;
  if (interaction.deferred && !interaction.replied) { delete p.flags; return interaction.editReply(p); }
  if (interaction.replied) return interaction.followUp(p);
  return interaction.reply(p);
}

module.exports = { Ctx, UserError, respond, norm };
