const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const http = require('http');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const CHANNEL_IDS = ['1482822474449162370', '1472417066442293331'];

const modEmbed = (title, description, color) =>
  new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

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

  const hasModPerms = message.member.permissions.has('Administrator') ||
                      message.member.permissions.has('ModerateMembers');

  if (message.content.startsWith('+ban')) {
    if (!hasModPerms) {
      return message.reply({ embeds: [modEmbed('❌ No Permission', 'You need Administrator or Moderate Members permission.', 0xff0000)] });
    }
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [modEmbed('❌ Invalid Usage', '`+ban @user [reason]`', 0xff0000)] });
    const reason = message.content.split(' ').slice(2).join(' ') || 'No reason provided';
    await target.ban({ reason });
    message.reply({ embeds: [modEmbed('🔨 Member Banned', `**User:** ${target.user.tag}\n**Reason:** ${reason}\n**Moderator:** ${message.author.tag}`, 0xff4444)] });
  }

  if (message.content.startsWith('+kick')) {
    if (!hasModPerms) {
      return message.reply({ embeds: [modEmbed('❌ No Permission', 'You need Administrator or Moderate Members permission.', 0xff0000)] });
    }
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [modEmbed('❌ Invalid Usage', '`+kick @user [reason]`', 0xff0000)] });
    const reason = message.content.split(' ').slice(2).join(' ') || 'No reason provided';
    await target.kick(reason);
    message.reply({ embeds: [modEmbed('👢 Member Kicked', `**User:** ${target.user.tag}\n**Reason:** ${reason}\n**Moderator:** ${message.author.tag}`, 0xff8800)] });
  }

  if (message.content.startsWith('+mute')) {
    if (!hasModPerms) {
      return message.reply({ embeds: [modEmbed('❌ No Permission', 'You need Administrator or Moderate Members permission.', 0xff0000)] });
    }
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
    if (!hasModPerms) {
      return message.reply({ embeds: [modEmbed('❌ No Permission', 'You need Administrator or Moderate Members permission.', 0xff0000)] });
    }
    const userId = message.content.split(' ')[1];
    if (!userId) return message.reply({ embeds: [modEmbed('❌ Invalid Usage', '`+unban <user ID> [reason]`', 0xff0000)] });
    const reason = message.content.split(' ').slice(2).join(' ') || 'No reason provided';
    await message.guild.members.unban(userId, reason);
    message.reply({ embeds: [modEmbed('✅ Member Unbanned', `**User ID:** ${userId}\n**Reason:** ${reason}\n**Moderator:** ${message.author.tag}`, 0x00cc44)] });
  }

  if (message.content.startsWith('+unmute') || message.content.startsWith('+untimeout')) {
    if (!hasModPerms) {
      return message.reply({ embeds: [modEmbed('❌ No Permission', 'You need Administrator or Moderate Members permission.', 0xff0000)] });
    }
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [modEmbed('❌ Invalid Usage', '`+unmute @user` or `+untimeout @user`', 0xff0000)] });
    await target.timeout(null);
    message.reply({ embeds: [modEmbed('🔊 Member Unmuted', `**User:** ${target.user.tag}\n**Moderator:** ${message.author.tag}`, 0x00cc44)] });
  }
});

const PORT = process.env.PORT || 8765;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is alive!');
}).listen(PORT, () => {
  console.log(`HTTP server running on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
