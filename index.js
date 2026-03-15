const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const http = require('http');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const CHANNEL_ID = '1482822474449162370';

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith('!basefind')) {
    const args = message.content.split(' ').slice(1);
    if (args.length < 3) {
      return message.reply('❌ Usage: `!basefind <rate> <owner> <unlock_time> <server_link>`\n📌 Example: `!basefind 4700000 Heisenberg27 34s https://roblox.com/games/...`');
    }

    const rate = args[0];
    const owner = args[1];
    const unlock = args[2];
    const serverLink = args[3];

    const embed = new EmbedBuilder()
      .setTitle('🌟 Base Found!')
      .setColor(0x00ff00)
      .setDescription(serverLink ? `[🔗 Click here to join the server](${serverLink})` : null)
      .addFields(
        { name: '💰 Rate', value: `$${rate}/s`, inline: true },
        { name: '👤 Owner', value: owner, inline: true },
        { name: '⏱️ Unlocks', value: unlock, inline: true },
        ...(serverLink ? [{ name: '🔗 Join Server', value: serverLink, inline: false }] : [])
      )
      .setFooter({ text: `Reported by ${message.author.username}` })
      .setTimestamp();

    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send({ embeds: [embed] });
    message.reply('✅ Base reported!');
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
