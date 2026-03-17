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

  if (message.content.startsWith('+ban')) {
    if (!message.member.permissions.has('BanMembers')) {
      return message.reply('❌ You do not have permission to ban members.');
    }
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Usage: `+ban @user [reason]`');
    const reason = message.content.split(' ').slice(2).join(' ') || 'No reason provided';
    await target.ban({ reason });
    message.reply(`✅ Banned **${target.user.tag}** — Reason: ${reason}`);
  }

  if (message.content.startsWith('+kick')) {
    if (!message.member.permissions.has('KickMembers')) {
      return message.reply('❌ You do not have permission to kick members.');
    }
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Usage: `+kick @user [reason]`');
    const reason = message.content.split(' ').slice(2).join(' ') || 'No reason provided';
    await target.kick(reason);
    message.reply(`✅ Kicked **${target.user.tag}** — Reason: ${reason}`);
  }

  if (message.content.startsWith('+mute')) {
    if (!message.member.permissions.has('ModerateMembers')) {
      return message.reply('❌ You do not have permission to mute members.');
    }
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Usage: `+mute @user <duration in minutes> [reason]`');
    const args = message.content.split(' ').slice(2);
    const duration = parseInt(args[0]);
    if (isNaN(duration) || duration <= 0) return message.reply('❌ Please provide a valid duration in minutes.');
    const reason = args.slice(1).join(' ') || 'No reason provided';
    await target.timeout(duration * 60 * 1000, reason);
    message.reply(`✅ Muted **${target.user.tag}** for **${duration} minute(s)** — Reason: ${reason}`);
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
