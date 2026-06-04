require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  REST, Routes, SlashCommandBuilder, PermissionFlagsBits,
  ActionRowBuilder, StringSelectMenuBuilder, ChannelType,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

function loadSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; }
}

function saveSettings(data) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

function getGuild(guildId) {
  const all = loadSettings();
  if (!all[guildId]) {
    all[guildId] = {
      prefix: process.env.PREFIX || '!',
      pingReactions: ['👀', '✅', '🔔'],
      reactionsEnabled: true,
      welcomeChannelId: null,
      welcomeMessage: 'Welcome to **{server}**, {user}! You are member **#{count}**.',
      logChannelId: null,
    };
    saveSettings(all);
  }
  return all[guildId];
}

function setGuild(guildId, data) {
  const all = loadSettings();
  all[guildId] = { ...getGuild(guildId), ...data };
  saveSettings(all);
  return all[guildId];
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const commands = [
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('🎛️ Open the bot control panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('setreactions')
    .setDescription('🔔 Set emojis to react with on pings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('emojis').setDescription('Emojis separated by commas e.g. 👀,✅,🔔').setRequired(true)),

  new SlashCommandBuilder()
    .setName('togglereactions')
    .setDescription('🔁 Enable or disable auto-reactions on pings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('setwelcome')
    .setDescription('👋 Set the welcome channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o =>
      o.setName('channel').setDescription('Channel to send welcome messages in').setRequired(true)
        .addChannelTypes(ChannelType.GuildText)),

  new SlashCommandBuilder()
    .setName('setwelcomemsg')
    .setDescription('✏️ Set custom welcome message')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('message')
        .setDescription('Use {user} = mention, {server} = server name, {count} = member count')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('disablewelcome')
    .setDescription('🚫 Disable welcome messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('setlog')
    .setDescription('📋 Set a channel to log bot actions')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o =>
      o.setName('channel').setDescription('Log channel').setRequired(true)
        .addChannelTypes(ChannelType.GuildText)),

  new SlashCommandBuilder()
    .setName('setprefix')
    .setDescription('⚙️ Change the bot command prefix')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('prefix').setDescription('New prefix (e.g. !, ?, .)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('settings')
    .setDescription('📄 View current bot settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('🏓 Check bot latency'),

  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('👤 Get info about a user')
    .addUserOption(o => o.setName('user').setDescription('User to look up')),

  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('🏠 Get server information'),

  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('🖼️ Get a user\'s avatar')
    .addUserOption(o => o.setName('user').setDescription('User to fetch avatar for')),

  new SlashCommandBuilder()
    .setName('say')
    .setDescription('💬 Make the bot say something')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName('message').setDescription('Message to send').setRequired(true)),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('🗑️ Delete messages from this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o =>
      o.setName('amount').setDescription('Number of messages to delete (1–100)').setRequired(true)
        .setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('📖 Show all commands'),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('✅ Slash commands registered globally');
  } catch (err) {
    console.error('Failed to register commands:', err.message);
  }
}

client.once('ready', async () => {
  console.log(`✅ CEAS REACTION is online as ${client.user.tag}`);
  client.user.setActivity('Use /panel to configure me!', { type: 3 });
  await registerCommands();
});

async function sendLog(guild, cfg, embed) {
  if (!cfg.logChannelId) return;
  const ch = guild.channels.cache.get(cfg.logChannelId);
  if (ch) await ch.send({ embeds: [embed] }).catch(() => {});
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guild, member } = interaction;
  const cfg = guild ? getGuild(guild.id) : {};

  if (commandName === 'panel') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎛️ CEAS REACTION — Control Panel')
      .setDescription('Use these slash commands to manage the bot. **No coding needed!**')
      .addFields(
        { name: '🔔 Reactions', value: '`/setreactions` `/togglereactions`', inline: true },
        { name: '👋 Welcome', value: '`/setwelcome` `/setwelcomemsg` `/disablewelcome`', inline: true },
        { name: '📋 Logging', value: '`/setlog`', inline: true },
        { name: '⚙️ General', value: '`/setprefix` `/settings`', inline: true },
        { name: '🛠️ Tools', value: '`/clear` `/say` `/ping`', inline: true },
        { name: '📖 Info', value: '`/userinfo` `/serverinfo` `/avatar`', inline: true },
      )
      .setFooter({ text: 'Only admins (Manage Server) can use config commands.' })
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'settings') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📄 Current Bot Settings')
      .addFields(
        { name: 'Prefix', value: `\`${cfg.prefix}\``, inline: true },
        { name: 'Auto-reactions', value: cfg.reactionsEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
        { name: 'Reaction Emojis', value: cfg.pingReactions.join(' '), inline: true },
        { name: 'Welcome Channel', value: cfg.welcomeChannelId ? `<#${cfg.welcomeChannelId}>` : 'Not set', inline: true },
        { name: 'Log Channel', value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : 'Not set', inline: true },
        { name: 'Welcome Message', value: `\`${cfg.welcomeMessage}\``, inline: false },
      )
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'setreactions') {
    const raw = interaction.options.getString('emojis');
    const emojis = raw.split(',').map(e => e.trim()).filter(Boolean);
    setGuild(guild.id, { pingReactions: emojis });
    const embed = new EmbedBuilder().setColor(0x57F287)
      .setDescription(`✅ Reaction emojis updated to: ${emojis.join(' ')}`);
    await sendLog(guild, cfg, new EmbedBuilder().setColor(0x57F287)
      .setTitle('🔔 Reactions Updated').setDescription(`New emojis: ${emojis.join(' ')}`).setTimestamp());
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'togglereactions') {
    const updated = setGuild(guild.id, { reactionsEnabled: !cfg.reactionsEnabled });
    const embed = new EmbedBuilder().setColor(updated.reactionsEnabled ? 0x57F287 : 0xED4245)
      .setDescription(`${updated.reactionsEnabled ? '✅ Auto-reactions **enabled**' : '❌ Auto-reactions **disabled**'}`);
    await sendLog(guild, cfg, new EmbedBuilder().setColor(0xFEE75C)
      .setTitle('🔁 Reactions Toggled').setDescription(`Now: ${updated.reactionsEnabled ? 'Enabled' : 'Disabled'}`).setTimestamp());
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'setwelcome') {
    const channel = interaction.options.getChannel('channel');
    setGuild(guild.id, { welcomeChannelId: channel.id });
    const embed = new EmbedBuilder().setColor(0x57F287)
      .setDescription(`✅ Welcome channel set to ${channel}`);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'setwelcomemsg') {
    const msg = interaction.options.getString('message');
    setGuild(guild.id, { welcomeMessage: msg });
    const embed = new EmbedBuilder().setColor(0x57F287)
      .setDescription(`✅ Welcome message updated!\nPreview: ${msg.replace('{user}', '@member').replace('{server}', guild.name).replace('{count}', guild.memberCount)}`);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'disablewelcome') {
    setGuild(guild.id, { welcomeChannelId: null });
    const embed = new EmbedBuilder().setColor(0xED4245).setDescription('🚫 Welcome messages disabled.');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'setlog') {
    const channel = interaction.options.getChannel('channel');
    setGuild(guild.id, { logChannelId: channel.id });
    const embed = new EmbedBuilder().setColor(0x57F287)
      .setDescription(`✅ Log channel set to ${channel}`);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'setprefix') {
    const prefix = interaction.options.getString('prefix');
    setGuild(guild.id, { prefix });
    const embed = new EmbedBuilder().setColor(0x57F287)
      .setDescription(`✅ Prefix changed to \`${prefix}\``);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'ping') {
    const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });
    await interaction.editReply(`🏓 Pong! Latency: **${sent.createdTimestamp - interaction.createdTimestamp}ms** | API: **${Math.round(client.ws.ping)}ms**`);
  }

  if (commandName === 'userinfo') {
    const target = interaction.options.getMember('user') || member;
    const user = target.user;
    const embed = new EmbedBuilder()
      .setColor(0x5865F2).setTitle(`👤 User Info — ${user.tag}`)
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: 'ID', value: user.id, inline: true },
        { name: 'Nickname', value: target.nickname || 'None', inline: true },
        { name: 'Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Joined Server', value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`, inline: true },
        { name: 'Bot?', value: user.bot ? 'Yes' : 'No', inline: true },
        { name: 'Top Role', value: `${target.roles.highest}`, inline: true },
      ).setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'serverinfo') {
    await guild.fetch();
    const embed = new EmbedBuilder()
      .setColor(0x5865F2).setTitle(`🏠 Server Info — ${guild.name}`)
      .setThumbnail(guild.iconURL({ dynamic: true }))
      .addFields(
        { name: 'ID', value: guild.id, inline: true },
        { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
        { name: 'Members', value: `${guild.memberCount}`, inline: true },
        { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
        { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
        { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Boost Level', value: `Level ${guild.premiumTier}`, inline: true },
        { name: 'Boosts', value: `${guild.premiumSubscriptionCount}`, inline: true },
      ).setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'avatar') {
    const target = interaction.options.getUser('user') || interaction.user;
    const embed = new EmbedBuilder()
      .setColor(0x5865F2).setTitle(`🖼️ Avatar — ${target.tag}`)
      .setImage(target.displayAvatarURL({ dynamic: true, size: 512 })).setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'say') {
    const text = interaction.options.getString('message');
    await interaction.channel.send(text);
    return interaction.reply({ content: '✅ Sent!', ephemeral: true });
  }

  if (commandName === 'clear') {
    const amount = interaction.options.getInteger('amount');
    await interaction.channel.bulkDelete(amount, true).catch(() => {});
    const reply = await interaction.reply({ content: `🗑️ Deleted **${amount}** messages.`, fetchReply: true });
    setTimeout(() => reply.delete().catch(() => {}), 3000);
    await sendLog(guild, cfg, new EmbedBuilder().setColor(0xED4245)
      .setTitle('🗑️ Messages Cleared')
      .setDescription(`**${amount}** messages cleared in <#${interaction.channelId}> by ${interaction.user.tag}`)
      .setTimestamp());
  }

  if (commandName === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2).setTitle('📖 CEAS REACTION — Help')
      .setDescription('All commands are **slash commands** — type `/` to see them!\nAdmins: use `/panel` for the full control panel.')
      .addFields(
        { name: '🔧 Admin Commands', value: '`/panel` `/settings` `/setreactions` `/togglereactions`\n`/setwelcome` `/setwelcomemsg` `/disablewelcome`\n`/setlog` `/setprefix` `/say` `/clear`', inline: false },
        { name: '👥 Everyone', value: '`/ping` `/userinfo` `/serverinfo` `/avatar` `/help`', inline: false },
        { name: '🔔 Auto Feature', value: 'Bot reacts automatically when anyone is @mentioned!', inline: false },
      ).setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const cfg = getGuild(message.guild.id);

  if (cfg.reactionsEnabled && (message.mentions.users.size > 0 || message.mentions.roles.size > 0 || message.mentions.everyone)) {
    for (const emoji of cfg.pingReactions) {
      await message.react(emoji).catch(() => {});
    }
  }

  if (!message.content.startsWith(cfg.prefix)) return;
  const args = message.content.slice(cfg.prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'ping') {
    const sent = await message.reply('🏓 Pinging...');
    await sent.edit(`🏓 Pong! Latency: **${sent.createdTimestamp - message.createdTimestamp}ms** | API: **${Math.round(client.ws.ping)}ms**`);
  }
});

client.on('guildMemberAdd', async (member) => {
  const cfg = getGuild(member.guild.id);
  if (!cfg.welcomeChannelId) return;
  const channel = member.guild.channels.cache.get(cfg.welcomeChannelId);
  if (!channel) return;
  const text = cfg.welcomeMessage
    .replace('{user}', `${member}`)
    .replace('{server}', member.guild.name)
    .replace('{count}', member.guild.memberCount);
  const embed = new EmbedBuilder()
    .setColor(0x57F287).setTitle('👋 Welcome!')
    .setDescription(text)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();
  await channel.send({ embeds: [embed] }).catch(() => {});
});

client.login(process.env.DISCORD_TOKEN);
