const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const http = require('http');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const CHANNEL_IDS = ['1482822474449162370', '1472417066442293331'];

// In-memory cache: messageId -> giveaway object
// Source of truth is the Discord thread state message (survives Railway redeploys)
const giveaways = new Map();
const endedGiveaways = new Map();

// JSON file as secondary local cache (survives crash-restarts, not redeploys)
const GIVEAWAYS_FILE = './discord-bot/giveaways.json';

function saveGiveaways() {
  try {
    const data = {};
    for (const [id, gw] of giveaways.entries()) {
      data[id] = {
        entries: [...gw.entries.entries()],
        bonusRoles: [...gw.bonusRoles.entries()],
        winners: gw.winners,
        prize: gw.prize,
        endTime: gw.endTime,
        channelId: gw.channelId,
        threadId: gw.threadId || null,
        stateMsgId: gw.stateMsgId || null
      };
    }
    fs.writeFileSync(GIVEAWAYS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save giveaways to file:', e);
  }
}

function loadGiveaways() {
  if (!fs.existsSync(GIVEAWAYS_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(GIVEAWAYS_FILE, 'utf8'));
    for (const [id, gw] of Object.entries(data)) {
      const remaining = gw.endTime - Date.now();
      if (remaining <= 0) continue;
      const entries = new Map(gw.entries);
      const bonusRoles = new Map(gw.bonusRoles);
      const timer = setTimeout(() => endGiveaway(id, gw.channelId), remaining);
      giveaways.set(id, {
        entries, bonusRoles,
        winners: gw.winners, prize: gw.prize, endTime: gw.endTime,
        channelId: gw.channelId, threadId: gw.threadId || null,
        stateMsgId: gw.stateMsgId || null, timer
      });
      console.log(`Restored giveaway from file: ${gw.prize} (${id}), ends in ${Math.ceil(remaining / 1000)}s`);
    }
  } catch (e) {
    console.error('Failed to load giveaways from file:', e);
  }
}

// Write the current giveaway state to its Discord thread (primary persistent store)
async function pushStateToThread(gw) {
  if (!gw.threadId || !gw.stateMsgId) return;
  try {
    const thread = await client.channels.fetch(gw.threadId);
    if (thread.archived) await thread.setArchived(false);
    const stateMsg = await thread.messages.fetch(gw.stateMsgId);
    await stateMsg.edit(JSON.stringify({
      prize: gw.prize, winners: gw.winners,
      endTime: gw.endTime, channelId: gw.channelId,
      bonusRoles: [...gw.bonusRoles.entries()],
      entries: [...gw.entries.entries()],
      ended: false
    }));
  } catch (e) {
    console.error('Failed to push state to Discord thread:', e);
  }
}

// Restore giveaway from its Discord thread after a restart/redeploy
async function restoreFromThread(messageId, channel) {
  const gwMsg = await channel.messages.fetch(messageId).catch(() => null);
  if (!gwMsg) return null;

  const thread = gwMsg.thread;
  if (!thread) return null;

  try {
    if (thread.archived) await thread.setArchived(false);
    const messages = await thread.messages.fetch({ limit: 10 });
    const stateMsg = messages
      .filter(m => m.author.id === client.user.id)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .first();
    if (!stateMsg) return null;

    const state = JSON.parse(stateMsg.content);
    if (state.ended) return 'ended';
    if (Date.now() > state.endTime) return 'ended';

    const remaining = state.endTime - Date.now();
    const gw = {
      entries: new Map(state.entries),
      bonusRoles: new Map(state.bonusRoles),
      winners: state.winners,
      prize: state.prize,
      endTime: state.endTime,
      channelId: state.channelId,
      threadId: thread.id,
      stateMsgId: stateMsg.id,
      timer: setTimeout(() => endGiveaway(messageId, state.channelId), remaining)
    };
    giveaways.set(messageId, gw);
    saveGiveaways();
    console.log(`Restored giveaway from Discord thread: ${gw.prize} (${messageId})`);
    return gw;
  } catch (e) {
    console.error('Failed to parse giveaway state from thread:', e);
    return null;
  }
}

// --- Helpers ---

const modEmbed = (title, description, color) =>
  new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();

function buildGiveawayEmbed(prize, winnersCount, endTime, entryCount = 0, bonusRoles = new Map()) {
  let desc = `Click 🎉 to enter!\n\n**Winners:** ${winnersCount}\n**Ends:** <t:${Math.floor(endTime / 1000)}:R>`;
  if (bonusRoles.size > 0) {
    const bonusLines = [...bonusRoles.entries()].map(([roleId, count]) => `<@&${roleId}> — **${count}x entries**`).join('\n');
    desc += `\n\n🌟 **Bonus Entries:**\n${bonusLines}`;
  }
  return new EmbedBuilder()
    .setTitle(`🎉 ${prize}`)
    .setDescription(desc)
    .setColor(0xff6600)
    .setFooter({ text: `${entryCount} participant(s)` })
    .setTimestamp(new Date(endTime));
}

function buildGiveawayRow(messageId, entryCount = 0) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`genter_${messageId}`)
      .setLabel('🎉')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`gcount_${messageId}`)
      .setLabel(`👥 ${entryCount} participants`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );
}

async function endGiveaway(messageId, channelId) {
  const gw = giveaways.get(messageId);
  if (!gw) return;

  clearTimeout(gw.timer);
  giveaways.delete(messageId);
  saveGiveaways();

  // Mark state thread as ended
  if (gw.threadId && gw.stateMsgId) {
    try {
      const thread = await client.channels.fetch(gw.threadId);
      if (thread.archived) await thread.setArchived(false);
      const stateMsg = await thread.messages.fetch(gw.stateMsgId);
      await stateMsg.edit(JSON.stringify({
        prize: gw.prize, winners: gw.winners, endTime: gw.endTime,
        channelId: gw.channelId, bonusRoles: [...gw.bonusRoles.entries()],
        entries: [...gw.entries.entries()], ended: true
      }));
      await thread.setArchived(true);
    } catch (e) {
      console.error('Failed to archive giveaway thread:', e);
    }
  }

  // Expand pool: each user appears entryCount times
  const pool = [...gw.entries.entries()].flatMap(([id, count]) => Array(count).fill(id));
  endedGiveaways.set(messageId, { pool, prize: gw.prize, winners: gw.winners });

  const channel = await client.channels.fetch(channelId);
  const msg = await channel.messages.fetch(messageId);
  const participantCount = gw.entries.size;

  if (pool.length === 0) {
    const noWinnerEmbed = new EmbedBuilder()
      .setTitle(`🎉 ${gw.prize}`)
      .setDescription('Giveaway ended!\n\nNo participants entered.')
      .setColor(0x888888)
      .setTimestamp();
    await msg.edit({ embeds: [noWinnerEmbed], components: [] });
    await channel.send({ embeds: [modEmbed('🎉 Giveaway Ended', `**${gw.prize}** — No winners (no one entered).`, 0x888888)] });
    return;
  }

  const drawPool = [...pool];
  const winners = [];
  for (let i = 0; i < Math.min(gw.winners, gw.entries.size); i++) {
    const idx = Math.floor(Math.random() * drawPool.length);
    const winner = drawPool.splice(idx, 1)[0];
    winners.push(winner);
    drawPool.splice(0, drawPool.length, ...drawPool.filter(id => id !== winner));
  }

  const winnerMentions = winners.map(id => `<@${id}>`).join(', ');

  const endedEmbed = new EmbedBuilder()
    .setTitle(`🎉 ${gw.prize}`)
    .setDescription(`Giveaway ended!\n\n**Winner(s):** ${winnerMentions}`)
    .setColor(0x888888)
    .setFooter({ text: `${participantCount} participant(s)` })
    .setTimestamp();

  await msg.edit({ embeds: [endedEmbed], components: [] });
  await channel.send({
    embeds: [modEmbed('🎉 Giveaway Ended', `Congratulations ${winnerMentions}! You won **${gw.prize}**!`, 0x00cc44)]
  });
}

// --- Ready ---

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  loadGiveaways();
});

// --- Button interactions ---

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith('genter_')) {
    const messageId = interaction.customId.replace('genter_', '');
    let gw = giveaways.get(messageId);

    // Not in memory — try to restore from Discord thread (handles Railway redeploys)
    if (!gw) {
      try {
        const result = await restoreFromThread(messageId, interaction.channel);
        if (result === 'ended' || result === null) {
          const ended = result === 'ended';
          return interaction.reply({ flags: 64, content: ended ? '❌ This giveaway has already ended.' : '❌ This giveaway is no longer active.' });
        }
        gw = result;
      } catch (e) {
        console.error('Error restoring giveaway:', e);
        return interaction.reply({ flags: 64, content: '❌ This giveaway is no longer active.' });
      }
    }

    if (gw.entries.has(interaction.user.id)) {
      return interaction.reply({ flags: 64, content: '❌ You have already entered this giveaway!' });
    }

    // Determine entry count: highest matching bonus role wins, default is 1
    const member = interaction.member;
    let entryCount = 1;
    for (const [roleId, count] of gw.bonusRoles.entries()) {
      if (member.roles.cache.has(roleId) && count > entryCount) {
        entryCount = count;
      }
    }
    gw.entries.set(interaction.user.id, entryCount);

    const bonusMsg = entryCount > 1 ? ` You have **${entryCount}x entries** thanks to your role bonus!` : '';
    await interaction.reply({ flags: 64, content: `✅ You entered the giveaway! Good luck!${bonusMsg}` });

    // Persist to both Discord thread and local JSON file
    await pushStateToThread(gw);
    saveGiveaways();

    const gwMsg = await interaction.channel.messages.fetch(messageId);
    await gwMsg.edit({
      embeds: [buildGiveawayEmbed(gw.prize, gw.winners, gw.endTime, gw.entries.size, gw.bonusRoles)],
      components: [buildGiveawayRow(messageId, gw.entries.size)]
    });
  }
});

// --- Message commands ---

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isAdmin = message.member.permissions.has('Administrator');
  const hasModPerms = isAdmin || message.member.permissions.has('ModerateMembers');

  // ========================
  // !basefind
  // ========================
  if (message.content.startsWith('!basefind')) {
    const args = message.content.split(' ').slice(1);
    if (args.length < 3) {
      return message.reply('❌ Usage: `!basefind <rate> <owner> <unlocktime> <link> <brainrotname>`\n📌 Example: `!basefind 4700000 Heisenberg27 34s https://roblox.com/games/... Skibidi`');
    }

    const rate = args[0];
    const owner = args[1];
    const unlock = args[2];
    const serverLink = args[3];
    const brainrot = args[4];

    const embed = new EmbedBuilder()
      .setTitle('🌟 Base Found!')
      .setColor(0x00ff00)
      .setDescription(serverLink ? `[🔗 Click here to join the server](${serverLink})` : null)
      .addFields(
        ...(brainrot ? [{ name: '🧠 Brainrot', value: brainrot, inline: true }] : []),
        { name: '💰 Rate', value: `$${rate}/s`, inline: true },
        { name: '👤 Owner', value: owner, inline: true },
        { name: '⏱️ Unlocks', value: unlock, inline: true },
        ...(serverLink ? [{ name: '🔗 Join Server', value: serverLink, inline: false }] : [])
      )
      .setFooter({ text: `Reported by ${message.author.username}` })
      .setTimestamp();

    await Promise.all(CHANNEL_IDS.map(async (id) => {
      const channel = await client.channels.fetch(id);
      await channel.send({ embeds: [embed] });
    }));
    message.reply('✅ Base reported!');
  }

  // ========================
  // Moderation
  // ========================
  if (message.content.startsWith('+ban')) {
    if (!hasModPerms) return message.reply({ embeds: [modEmbed('❌ No Permission', 'You need Administrator or Moderate Members permission.', 0xff0000)] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [modEmbed('❌ Invalid Usage', '`+ban @user [reason]`', 0xff0000)] });
    const reason = message.content.split(' ').slice(2).join(' ') || 'No reason provided';
    await target.ban({ reason });
    message.reply({ embeds: [modEmbed('🔨 Member Banned', `**User:** ${target.user.tag}\n**Reason:** ${reason}\n**Moderator:** ${message.author.tag}`, 0xff4444)] });
  }

  if (message.content.startsWith('+kick')) {
    if (!hasModPerms) return message.reply({ embeds: [modEmbed('❌ No Permission', 'You need Administrator or Moderate Members permission.', 0xff0000)] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [modEmbed('❌ Invalid Usage', '`+kick @user [reason]`', 0xff0000)] });
    const reason = message.content.split(' ').slice(2).join(' ') || 'No reason provided';
    await target.kick(reason);
    message.reply({ embeds: [modEmbed('👢 Member Kicked', `**User:** ${target.user.tag}\n**Reason:** ${reason}\n**Moderator:** ${message.author.tag}`, 0xff8800)] });
  }

  if (message.content.startsWith('+mute')) {
    if (!hasModPerms) return message.reply({ embeds: [modEmbed('❌ No Permission', 'You need Administrator or Moderate Members permission.', 0xff0000)] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [modEmbed('❌ Invalid Usage', '`+mute @user <minutes> [reason]`', 0xff0000)] });
    const args = message.content.split(' ').slice(2);
    const duration = parseInt(args[0]);
    if (isNaN(duration) || duration <= 0) return message.reply({ embeds: [modEmbed('❌ Invalid Duration', 'Please provide a valid duration in minutes.', 0xff0000)] });
    const reason = args.slice(1).join(' ') || 'No reason provided';
    await target.timeout(duration * 60 * 1000, reason);
    message.reply({ embeds: [modEmbed('🔇 Member Muted', `**User:** ${target.user.tag}\n**Duration:** ${duration} minute(s)\n**Reason:** ${reason}\n**Moderator:** ${message.author.tag}`, 0xffaa00)] });
  }

  if (message.content.startsWith('+unban')) {
    if (!hasModPerms) return message.reply({ embeds: [modEmbed('❌ No Permission', 'You need Administrator or Moderate Members permission.', 0xff0000)] });
    const userId = message.content.split(' ')[1];
    if (!userId) return message.reply({ embeds: [modEmbed('❌ Invalid Usage', '`+unban <user ID> [reason]`', 0xff0000)] });
    const reason = message.content.split(' ').slice(2).join(' ') || 'No reason provided';
    await message.guild.members.unban(userId, reason);
    message.reply({ embeds: [modEmbed('✅ Member Unbanned', `**User ID:** ${userId}\n**Reason:** ${reason}\n**Moderator:** ${message.author.tag}`, 0x00cc44)] });
  }

  if (message.content.startsWith('+unmute') || message.content.startsWith('+untimeout')) {
    if (!hasModPerms) return message.reply({ embeds: [modEmbed('❌ No Permission', 'You need Administrator or Moderate Members permission.', 0xff0000)] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [modEmbed('❌ Invalid Usage', '`+unmute @user` or `+untimeout @user`', 0xff0000)] });
    await target.timeout(null);
    message.reply({ embeds: [modEmbed('🔊 Member Unmuted', `**User:** ${target.user.tag}\n**Moderator:** ${message.author.tag}`, 0x00cc44)] });
  }

  // ========================
  // Giveaway
  // ========================
  if (message.content.startsWith('+gstart')) {
    if (!isAdmin) return message.reply({ embeds: [modEmbed('❌ No Permission', 'Only Administrators can start giveaways.', 0xff0000)] });
    const args = message.content.split(' ').slice(1);
    if (args.length < 3) return message.reply({ embeds: [modEmbed('❌ Invalid Usage', '`+gstart <minutes> <winners> <prize> [roleID:entries ...]`', 0xff0000)] });

    const duration = parseInt(args[0]);
    const winnersCount = parseInt(args[1]);

    if (isNaN(duration) || duration <= 0) return message.reply({ embeds: [modEmbed('❌ Invalid Duration', 'Please provide a valid duration in minutes.', 0xff0000)] });
    if (isNaN(winnersCount) || winnersCount <= 0) return message.reply({ embeds: [modEmbed('❌ Invalid Winners', 'Please provide a valid number of winners.', 0xff0000)] });

    const bonusRoles = new Map();
    const prizeWords = [];
    for (const word of args.slice(2)) {
      if (/^\d+:\d+$/.test(word)) {
        const [roleId, count] = word.split(':');
        bonusRoles.set(roleId, parseInt(count));
      } else {
        prizeWords.push(word);
      }
    }
    const prize = prizeWords.join(' ');
    if (!prize) return message.reply({ embeds: [modEmbed('❌ Invalid Usage', 'Please provide a prize name.', 0xff0000)] });

    const endTime = Date.now() + duration * 60 * 1000;

    // Send the giveaway message
    const sentMsg = await message.channel.send({
      embeds: [buildGiveawayEmbed(prize, winnersCount, endTime, 0, bonusRoles)],
      components: [buildGiveawayRow('placeholder', 0)]
    });

    // Create a thread on the message to serve as the persistent state store
    let threadId = null;
    let stateMsgId = null;
    try {
      const thread = await sentMsg.startThread({
        name: 'giveaway-state',
        autoArchiveDuration: 10080
      });
      const stateMsg = await thread.send(JSON.stringify({
        prize, winners: winnersCount, endTime,
        channelId: message.channel.id,
        bonusRoles: [...bonusRoles.entries()],
        entries: [],
        ended: false
      }));
      threadId = thread.id;
      stateMsgId = stateMsg.id;
    } catch (e) {
      console.error('Failed to create giveaway state thread:', e);
    }

    // Update the button customId from placeholder to the real message ID
    await sentMsg.edit({ components: [buildGiveawayRow(sentMsg.id, 0)] });

    const timer = setTimeout(() => endGiveaway(sentMsg.id, message.channel.id), duration * 60 * 1000);
    giveaways.set(sentMsg.id, {
      entries: new Map(),
      bonusRoles,
      winners: winnersCount,
      prize,
      endTime,
      channelId: message.channel.id,
      threadId,
      stateMsgId,
      timer
    });
    saveGiveaways();

    const bonusSummary = bonusRoles.size > 0
      ? '\n' + [...bonusRoles.entries()].map(([r, c]) => `<@&${r}>: ${c}x entries`).join(', ')
      : '';
    message.reply({ embeds: [modEmbed('✅ Giveaway Started', `**${prize}** — ends in ${duration} minute(s)!\n**Message ID:** \`${sentMsg.id}\`${bonusSummary}`, 0x00cc44)] });
  }

  if (message.content.startsWith('+gend')) {
    if (!isAdmin) return message.reply({ embeds: [modEmbed('❌ No Permission', 'Only Administrators can end giveaways.', 0xff0000)] });
    const msgId = message.content.split(' ')[1];
    if (!msgId) return message.reply({ embeds: [modEmbed('❌ Invalid Usage', '`+gend <message_id>`', 0xff0000)] });
    if (!giveaways.has(msgId)) return message.reply({ embeds: [modEmbed('❌ Not Found', 'No active giveaway with that message ID.', 0xff0000)] });
    await endGiveaway(msgId, giveaways.get(msgId).channelId);
  }

  if (message.content.startsWith('+greroll')) {
    if (!isAdmin) return message.reply({ embeds: [modEmbed('❌ No Permission', 'Only Administrators can reroll giveaways.', 0xff0000)] });
    const msgId = message.content.split(' ')[1];
    if (!msgId) return message.reply({ embeds: [modEmbed('❌ Invalid Usage', '`+greroll <message_id>`', 0xff0000)] });

    const gwData = endedGiveaways.get(msgId);
    if (!gwData) return message.reply({ embeds: [modEmbed('❌ Not Found', 'No ended giveaway found with that message ID. Giveaway must have ended via this bot session.', 0xff0000)] });
    if (!gwData.pool || gwData.pool.length === 0) return message.reply({ embeds: [modEmbed('❌ No Participants', 'Cannot reroll — no one entered this giveaway.', 0xff0000)] });

    const winner = gwData.pool[Math.floor(Math.random() * gwData.pool.length)];
    message.reply({ embeds: [modEmbed('🎉 Rerolled!', `New winner: <@${winner}>! Congratulations, you won **${gwData.prize}**!`, 0xff6600)] });
  }
});

// --- HTTP keep-alive server ---

const PORT = process.env.PORT || 8765;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is alive!');
}).listen(PORT, () => {
  console.log(`HTTP server running on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
