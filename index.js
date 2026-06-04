require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  REST, Routes, SlashCommandBuilder, PermissionFlagsBits,
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
      reactionsEnabled: true,
      pingReactions: ['👀', '✅', '🔔'],
      targetUserIds: [],
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
    .setName('settings')
    .setDescription('📄 View current bot settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('setreactions')
    .setDescription('🔔 Set emojis to react with when someone is pinged')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('emojis')
        .setDescription('Emojis separated by spaces. Standard: 👀 Custom: paste <:name:ID> or <a:name:ID>')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('togglereactions')
    .setDescription('🔁 Enable or disable auto-reactions')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('addtarget')
    .setDescription('🎯 Only react when THIS user is pinged (leave empty = react to everyone)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('user').setDescription('User to target').setRequired(true)),

  new SlashCommandBuilder()
    .setName('removetarget')
    .setDescription('❌ Remove a user from the target list')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('user').setDescription('User to remove').setRequired(true)),

  new SlashCommandBuilder()
    .setName('targets')
    .setDescription('📋 View the current target user list')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('cleartargets')
    .setDescription('🔄 Clear target list — react to ALL pings again')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('🏓 Check bot latency'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('📖 Show all commands'),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('Failed to register commands:', err.message);
  }
}

client.once('ready', async () => {
  console.log(`✅ CEAS REACTION is online as ${client.user.tag}`);
  client.user.setActivity('Watching for pings 👀', { type: 3 });
  await registerCommands();
});

function parseEmojis(raw) {
  const results = [];
  const customRegex = /<a?:\w+:(\d+)>/g;
  let match;
  while ((match = customRegex.exec(raw)) !== null) {
    results.push(match[1]);
  }
  const noCustom = raw.replace(/<a?:\w+:\d+>/g, '');
  const unicodeRegex = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu;
  const unicodeMatches = noCustom.match(unicodeRegex);
  if (unicodeMatches) results.push(...unicodeMatches);
  return [...new Set(results)];
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, guild } = interaction;
  const cfg = guild ? getGuild(guild.id) : {};

  if (commandName === 'panel') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎛️ CEAS REACTION — Control Panel')
      .addFields(
        { name: '🔔 Reactions', value: '`/setreactions` — Set emojis\n`/togglereactions` — On/Off', inline: true },
        { name: '🎯 Targeting', value: '`/addtarget` — Pick who gets reacted\n`/removetarget` — Remove user\n`/targets` — View list\n`/cleartargets` — React to everyone', inline: true },
        { name: '📄 Info', value: '`/settings` — Current config\n`/ping` — Latency\n`/help` — All commands', inline: true },
      )
      .setFooter({ text: 'Only admins (Manage Server) can use config commands.' })
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'settings') {
    const targets = cfg.targetUserIds.length > 0
      ? cfg.targetUserIds.map(id => `<@${id}>`).join(', ')
      : '**Everyone** (no targets set)';
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📄 Current Settings')
      .addFields(
        { name: 'Auto-reactions', value: cfg.reactionsEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
        { name: 'React Emojis', value: cfg.pingReactions.map(e => isNaN(e) ? e : `<:_:${e}>`).join(' ') || 'None', inline: true },
        { name: 'React When Pinged', value: targets, inline: false },
      )
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'setreactions') {
    const raw = interaction.options.getString('emojis');
    const emojis = parseEmojis(raw);
    if (emojis.length === 0) {
      return interaction.reply({ content: '❌ No valid emojis found. Paste standard emojis or custom ones like `<:name:ID>` or `<a:name:ID>`.', ephemeral: true });
    }
    setGuild(guild.id, { pingReactions: emojis });
    const preview = emojis.map(e => isNaN(e) ? e : `<:_:${e}>`).join(' ');
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`✅ Reactions set to: ${preview}`)], ephemeral: true });
  }

  if (commandName === 'togglereactions') {
    const updated = setGuild(guild.id, { reactionsEnabled: !cfg.reactionsEnabled });
    const color = updated.reactionsEnabled ? 0x57F287 : 0xED4245;
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(color).setDescription(updated.reactionsEnabled ? '✅ Auto-reactions **enabled**' : '❌ Auto-reactions **disabled**')], ephemeral: true });
  }

  if (commandName === 'addtarget') {
    const user = interaction.options.getUser('user');
    const ids = new Set(cfg.targetUserIds);
    ids.add(user.id);
    setGuild(guild.id, { targetUserIds: [...ids] });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`🎯 Added ${user} to targets.\nBot will now only react when **targeted users** are pinged.`)], ephemeral: true });
  }

  if (commandName === 'removetarget') {
    const user = interaction.options.getUser('user');
    const ids = cfg.targetUserIds.filter(id => id !== user.id);
    setGuild(guild.id, { targetUserIds: ids });
    const note = ids.length === 0 ? '\nNo targets left — bot will react to **all pings** again.' : '';
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setDescription(`✅ Removed ${user} from targets.${note}`)], ephemeral: true });
  }

  if (commandName === 'targets') {
    const desc = cfg.targetUserIds.length > 0
      ? cfg.targetUserIds.map((id, i) => `${i + 1}. <@${id}>`).join('\n')
      : 'No targets set — bot reacts to **all pings**.';
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🎯 Target List').setDescription(desc)], ephemeral: true });
  }

  if (commandName === 'cleartargets') {
    setGuild(guild.id, { targetUserIds: [] });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription('🔄 Target list cleared. Bot will react to **all pings**.')], ephemeral: true });
  }

  if (commandName === 'ping') {
    const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });
    return interaction.editReply(`🏓 Pong! Latency: **${sent.createdTimestamp - interaction.createdTimestamp}ms** | API: **${Math.round(client.ws.ping)}ms**`);
  }

  if (commandName === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📖 CEAS REACTION — Help')
      .addFields(
        { name: '🔧 Admin Only', value: '`/panel` `/settings`\n`/setreactions` `/togglereactions`\n`/addtarget` `/removetarget` `/targets` `/cleartargets`', inline: false },
        { name: '👥 Everyone', value: '`/ping` `/help`', inline: false },
        { name: '🔔 How reactions work', value: 'Bot reacts when someone is @pinged. Use `/addtarget` to only react for specific people.', inline: false },
        { name: '🎨 Custom emojis in /setreactions', value: 'Paste the emoji directly: `<:name:ID>` (static) or `<a:name:ID>` (animated/Nitro)', inline: false },
      )
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const cfg = getGuild(message.guild.id);

  if (!cfg.reactionsEnabled) return;

  const mentionedUserIds = [...message.mentions.users.keys()];
  if (mentionedUserIds.length === 0 && !message.mentions.roles.size && !message.mentions.everyone) return;

  let shouldReact = false;

  if (cfg.targetUserIds.length === 0) {
    shouldReact = mentionedUserIds.length > 0 || message.mentions.roles.size > 0 || message.mentions.everyone;
  } else {
    shouldReact = mentionedUserIds.some(id => cfg.targetUserIds.includes(id));
  }

  if (!shouldReact) return;

  for (const emoji of cfg.pingReactions) {
    await message.react(emoji).catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);
