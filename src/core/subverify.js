const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
} = require('discord.js');
const { kv } = require('./db');
const ui = require('./ui');

const DEFAULT_CONFIG = {
  enabled: true,
  channelId: null,
  roleId: null,
  ytChannel: 'Itz0Cat',
  sticky: true,
  stickyMsgId: null,
};

const stickyTimers = new Map();
const cache = new Map(); // guildId -> cfg

function cfg(guildId) {
  if (cache.has(guildId)) return cache.get(guildId);
  const data = kv.obj(guildId, 'subverify', DEFAULT_CONFIG);
  cache.set(guildId, data);
  return data;
}

function setCfg(guildId, patch) {
  const cur = cfg(guildId);
  const next = { ...cur, ...patch };
  kv.set(guildId, 'subverify', next);
  cache.set(guildId, next);
  return next;
}

function buildSetupPayload(guild, c) {
  const isReady = Boolean(c.channelId && c.roleId && c.ytChannel && c.enabled);
  const channelDisplay = c.channelId ? `<#${c.channelId}>` : '*Not set*';
  const roleDisplay = c.roleId ? `<@&${c.roleId}>` : '*Not set*';
  const ytDisplay = c.ytChannel ? `**${c.ytChannel}**` : '*Not set*';
  const stickyDisplay = c.sticky ? '`Enabled` 📌' : '`Disabled`';
  const statusDisplay = isReady ? '🟢 `Active`' : (c.enabled ? '🟡 `Incomplete setup`' : '🔴 `Paused`');

  const embed = ui.card({
    icon: '📺',
    title: 'YouTube Subscription Verification Setup',
    desc: 'Automate granting roles to users who prove they are subscribed to your YouTube channel.\n' +
          'Configure the channel to watch, role to give, and YouTube channel name below.',
    color: ui.colors.strawberry,
    fields: [
      { name: '📺 YouTube Channel', value: ytDisplay, inline: true },
      { name: '💬 Verification Channel', value: channelDisplay, inline: true },
      { name: '🎖️ Role to Grant', value: roleDisplay, inline: true },
      { name: '📌 Sticky Guide', value: stickyDisplay, inline: true },
      { name: '⚡ Status', value: statusDisplay, inline: true },
      { name: '⚡ Optimization', value: '`Media Only (Images)` 🚀', inline: true },
    ],
    hint: 'Drop-down menus and buttons below update settings instantly in real time.',
  });

  const channelRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('subverify:channel')
      .setPlaceholder('Select Channel to check screenshots in')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  );

  const roleRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('subverify:role')
      .setPlaceholder('Select Role to grant on verified subscription')
  );

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('subverify:yt')
      .setLabel('Set Channel Name')
      .setEmoji('📺')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('subverify:sticky')
      .setLabel(c.sticky ? 'Sticky: ON' : 'Sticky: OFF')
      .setEmoji('📌')
      .setStyle(c.sticky ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('subverify:toggle')
      .setLabel(c.enabled ? 'Pause System' : 'Enable System')
      .setEmoji(c.enabled ? '⏸️' : '▶️')
      .setStyle(c.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('subverify:post')
      .setLabel('Send Guide Now')
      .setEmoji('📢')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [channelRow, roleRow, buttonRow] };
}

function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;
    client.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return downloadImage(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        return reject(new Error(`Download failed with status code ${response.statusCode}`));
      }
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function verifyScreenshot(shotPath, user, ytChannel) {
  return new Promise((resolve) => {
    const pyScript = path.join(__dirname, '..', 'sub', 'verify.py');
    const dbPath = path.join(__dirname, '..', '..', 'data', 'subverify_seen.json');
    const args = [pyScript, shotPath, user, '--channel', ytChannel, '--json'];

    const env = { ...process.env, SUBVERIFY_DB: dbPath };
    const proc = spawn('python3', args, { env });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      try {
        const lines = stdout.trim().split('\n');
        const jsonLine = lines[lines.length - 1];
        const parsed = JSON.parse(jsonLine);
        resolve(parsed);
      } catch (err) {
        resolve({
          ok: false,
          message: stdout.trim() || stderr.trim() || `Process exited with code ${code}`,
        });
      }
    });

    proc.on('error', (err) => {
      resolve({
        ok: false,
        message: `Failed to spawn verification worker: ${err.message}`,
      });
    });
  });
}

function stickyEmbed(c) {
  return ui.card({
    icon: '📺',
    title: 'YouTube Subscription Verification',
    desc: `To get verified and receive the **<@&${c.roleId || 'role'}>** role:\n\n` +
          `1️⃣ Subscribe to **[${c.ytChannel}](https://youtube.com/@${encodeURIComponent(c.ytChannel)})** on YouTube.\n` +
          `2️⃣ Take a clear, uncropped screenshot showing the **Subscribed** button.\n` +
          `3️⃣ Drop your screenshot right here in this channel!\n\n` +
          `- Our automated system will check your proof and assign your role instantly.`,
    color: ui.colors.strawberry,
    hint: 'Reused or fake screenshots will be detected and rejected.',
  });
}

async function refreshSticky(channel, c) {
  if (!c.sticky || !c.channelId || channel.id !== c.channelId) return;
  clearTimeout(stickyTimers.get(channel.id));
  stickyTimers.set(channel.id, setTimeout(async () => {
    const fresh = cfg(channel.guild.id);
    if (!fresh.sticky || fresh.channelId !== channel.id) return;

    if (fresh.stickyMsgId) {
      await channel.messages.delete(fresh.stickyMsgId).catch(() => {});
    }

    const msg = await channel.send({ embeds: [stickyEmbed(fresh)] }).catch(() => null);
    if (msg) {
      setCfg(channel.guild.id, { stickyMsgId: msg.id });
    }
  }, 3500));
}

/**
 * Message handler optimized strictly for media only.
 * Discards all text-only messages in <0.01ms to save CPU and RAM.
 */
async function handleMessage(client, message) {
  if (!message.guild || message.author.bot) return;

  const c = cfg(message.guild.id);
  // Zero computation if verification is disabled or not set for this channel
  if (!c.enabled || !c.channelId || message.channelId !== c.channelId) return;

  // Sticky prompt refresh for any message in this channel
  if (c.sticky) {
    refreshSticky(message.channel, c);
  }

  // OPTIMIZATION: Discard immediately if no attachments
  if (!message.attachments || message.attachments.size === 0) return;

  // OPTIMIZATION: Filter strictly for image media attachments only
  const imgAttachment = message.attachments.find((att) =>
    (att.contentType && att.contentType.startsWith('image/')) ||
    /\.(png|jpe?g|webp)$/i.test(att.name || att.url)
  );

  if (!imgAttachment) return; // Non-image media/documents ignored

  if (!c.roleId || !c.ytChannel) {
    await message.reply({
      embeds: [ui.warn('Verification setup incomplete', 'The server admin has not configured the verified role or target YouTube channel yet.')],
      allowedMentions: { repliedUser: false },
    }).catch(() => {});
    return;
  }

  const role = message.guild.roles.cache.get(c.roleId);
  if (!role) {
    await message.reply({
      embeds: [ui.err('Role not found', 'The configured verified role no longer exists.', 'An admin should reconfigure .subverify.')],
      allowedMentions: { repliedUser: false },
    }).catch(() => {});
    return;
  }

  if (message.member?.roles.cache.has(role.id)) {
    await message.react('✨').catch(() => {});
    await message.reply({
      embeds: [ui.ok('Already verified', `You already have the ${role} role!`)],
      allowedMentions: { repliedUser: false },
    }).catch(() => {});
    return;
  }

  // React to acknowledge processing
  await message.react('🔍').catch(() => {});

  const tmpFile = path.join(os.tmpdir(), `subverify_${message.id}_${Date.now()}.jpg`);
  try {
    await downloadImage(imgAttachment.url, tmpFile);
    const result = await verifyScreenshot(tmpFile, message.author.id, c.ytChannel);

    // Remove processing reaction
    await message.reactions.cache.get('🔍')?.users.remove(client.user.id).catch(() => {});

    if (result.ok) {
      await message.member.roles.add(role, 'YouTube subscriber verification passed').catch((err) => {
        console.error('[subverify role error]', err);
      });
      await message.react('✅').catch(() => {});
      await message.reply({
        embeds: [
          ui.card({
            icon: '✨',
            title: 'Verification Successful!',
            desc: `Thank you for subscribing to **${c.ytChannel}**!\n` +
                  `You have been granted ${role}.`,
            color: ui.colors.matcha,
          }),
        ],
        allowedMentions: { repliedUser: true },
      }).catch(() => {});
    } else {
      await message.react('❌').catch(() => {});
      await message.reply({
        embeds: [
          ui.card({
            icon: '🥀',
            title: 'Verification Failed',
            desc: result.message || 'Could not verify YouTube subscription from the provided screenshot.',
            hint: `Make sure the screenshot clearly shows your subscription to ${c.ytChannel} and try again.`,
            color: ui.colors.cherry,
          }),
        ],
        allowedMentions: { repliedUser: true },
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[subverify verification error]', err);
    await message.reactions.cache.get('🔍')?.users.remove(client.user.id).catch(() => {});
    await message.react('⚠️').catch(() => {});
  } finally {
    fs.unlink(tmpFile, () => {});
    if (c.sticky) refreshSticky(message.channel, c);
  }
}

module.exports = {
  cfg,
  setCfg,
  buildSetupPayload,
  verifyScreenshot,
  refreshSticky,
  stickyEmbed,
  handleMessage,
};
