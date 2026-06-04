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
      pingReactions: [],
      targetUserIds: [],
      reactionRoles: [],
    };
    saveSettings(all);
  }
  if (!all[guildId].reactionRoles) all[guildId].reactionRoles = [];
  return all[guildId];
}
function setGuild(guildId, data) {
  const all = loadSettings();
  all[guildId] = { ...getGuild(guildId), ...data };
  saveSettings(all);
  return all[guildId];
}

function parseOneEmoji(raw) {
  const custom = raw.match(/<a?:(\w+):(\d+)>/);
  if (custom) return custom[2];
  const unicode = raw.match(/\p{Emoji_Presentation}|\p{Emoji}\uFE0F/u);
  if (unicode) return unicode[0];
  return null;
}

function parseManyEmojis(raw) {
  const results = [];
  const customRegex = /<a?:\w+:(\d+)>/g;
  let m;
  while ((m = customRegex.exec(raw)) !== null) results.push(m[1]);
  const noCustom = raw.replace(/<a?:\w+:\d+>/g, '');
  const unicodeMatches = noCustom.match(/\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu);
  if (unicodeMatches) results.push(...unicodeMatches);
  return [...new Set(results)];
}

function emojiDisplay(e) {
  return isNaN(e) ? e : `<:_:${e}>`;
}

function emojiKey(emoji) {
  return emoji.id || emoji.name;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember],
});

const commands = [
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Open the bot control panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('settings')
    .setDescription('View current bot settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all commands'),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency'),

  // ── Ping reactions ──────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('setreactions')
    .setDescription('Replace all ping reaction emojis at once')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('emojis').setDescription('Paste emojis separated by spaces').setRequired(true)),

  new SlashCommandBuilder()
    .setName('addreaction')
    .setDescription('Add one emoji to the ping reaction list')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('emoji').setDescription('Paste the emoji to add').setRequired(true)),

  new SlashCommandBuilder()
    .setName('removereaction')
    .setDescription('Remove one emoji from the ping reaction list')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('emoji').setDescription('Paste the emoji to remove').setRequired(true)),

  new SlashCommandBuilder()
    .setName('listreactions')
    .setDescription('List current ping reaction emojis')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('clearreactions')
    .setDescription('Remove all ping reaction emojis')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('togglereactions')
    .setDescription('Enable or disable auto-reactions on pings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // ── Targeting ────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('addtarget')
    .setDescription('Only react when this user is pinged')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('user').setDescription('User to target').setRequired(true)),

  new SlashCommandBuilder()
    .setName('removetarget')
    .setDescription('Remove a user from the target list')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('user').setDescription('User to remove').setRequired(true)),

  new SlashCommandBuilder()
    .setName('targets')
    .setDescription('View the current target user list')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('cleartargets')
    .setDescription('Clear target list and react to all pings again')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // ── Reaction Roles ───────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('addreactionrole')
    .setDescription('Assign a role when a user reacts to a message')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('message_id').setDescription('ID of the message to watch').setRequired(true))
    .addStringOption(o =>
      o.setName('emoji').setDescription('Emoji users react with').setRequired(true))
    .addRoleOption(o =>
      o.setName('role').setDescription('Role to give').setRequired(true))
    .addChannelOption(o =>
      o.setName('channel').setDescription('Channel the message is in (defaults to this channel)')),

  new SlashCommandBuilder()
    .setName('listreactionroles')
    .setDescription('List all reaction role setups')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('removereactionrole')
    .setDescription('Remove a reaction role by its number from /listreactionroles')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(o =>
      o.setName('number').setDescription('Number shown in /listreactionroles').setRequired(true)
        .setMinValue(1)),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('Slash commands registered');
  } catch (err) {
    console.error('Failed to register commands:', err.message);
  }
}

client.once('ready', async () => {
  console.log(`CEAS REACTION online as ${client.user.tag}`);
  client.user.setActivity('Watching for pings', { type: 3 });
  await registerCommands();
});

// ── Slash command handler ─────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, guild } = interaction;
  const cfg = guild ? getGuild(guild.id) : {};

  // ── Panel ──
  if (commandName === 'panel') {
    const embed = new EmbedBuilder().setColor(0x5865F2)
      .setTitle('CEAS REACTION — Control Panel')
      .addFields(
        { name: 'Ping Reactions', value: '`/setreactions` `/addreaction` `/removereaction`\n`/listreactions` `/clearreactions` `/togglereactions`', inline: false },
        { name: 'Targeting', value: '`/addtarget` `/removetarget` `/targets` `/cleartargets`', inline: false },
        { name: 'Reaction Roles', value: '`/addreactionrole` `/listreactionroles` `/removereactionrole`', inline: false },
        { name: 'Info', value: '`/settings` `/ping` `/help`', inline: false },
      )
      .setFooter({ text: 'Config commands require Manage Server permission.' })
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ── Settings ──
  if (commandName === 'settings') {
    const targets = cfg.targetUserIds.length > 0
      ? cfg.targetUserIds.map(id => `<@${id}>`).join(', ')
      : 'Everyone';
    const reactions = cfg.pingReactions.length > 0
      ? cfg.pingReactions.map(emojiDisplay).join(' ')
      : 'None set';
    const rrCount = cfg.reactionRoles.length;
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Current Settings')
      .addFields(
        { name: 'Auto-reactions', value: cfg.reactionsEnabled ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Reaction Emojis', value: reactions, inline: true },
        { name: 'React When Pinged', value: targets, inline: false },
        { name: 'Reaction Roles', value: `${rrCount} set up`, inline: true },
      ).setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ── Help ──
  if (commandName === 'help') {
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('CEAS REACTION — Commands')
      .addFields(
        { name: 'Admin — Ping Reactions', value: '`/setreactions` `/addreaction` `/removereaction`\n`/listreactions` `/clearreactions` `/togglereactions`', inline: false },
        { name: 'Admin — Targeting', value: '`/addtarget` `/removetarget` `/targets` `/cleartargets`', inline: false },
        { name: 'Admin — Reaction Roles', value: '`/addreactionrole` `/listreactionroles` `/removereactionrole`', inline: false },
        { name: 'Everyone', value: '`/ping` `/help`', inline: false },
      ).setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // ── Ping ──
  if (commandName === 'ping') {
    const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
    return interaction.editReply(`Pong! Latency: **${sent.createdTimestamp - interaction.createdTimestamp}ms** | API: **${Math.round(client.ws.ping)}ms**`);
  }

  // ── Set all reactions ──
  if (commandName === 'setreactions') {
    const emojis = parseManyEmojis(interaction.options.getString('emojis'));
    if (!emojis.length) return interaction.reply({ content: 'No valid emojis found. Paste standard emojis or custom ones like `<:name:ID>`.', ephemeral: true });
    setGuild(guild.id, { pingReactions: emojis });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Reactions set: ${emojis.map(emojiDisplay).join(' ')}`)], ephemeral: true });
  }

  // ── Add one reaction ──
  if (commandName === 'addreaction') {
    const emoji = parseOneEmoji(interaction.options.getString('emoji'));
    if (!emoji) return interaction.reply({ content: 'No valid emoji found.', ephemeral: true });
    const list = new Set(cfg.pingReactions);
    list.add(emoji);
    setGuild(guild.id, { pingReactions: [...list] });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Added ${emojiDisplay(emoji)}. Current list: ${[...list].map(emojiDisplay).join(' ')}`)], ephemeral: true });
  }

  // ── Remove one reaction ──
  if (commandName === 'removereaction') {
    const emoji = parseOneEmoji(interaction.options.getString('emoji'));
    if (!emoji) return interaction.reply({ content: 'No valid emoji found.', ephemeral: true });
    const list = cfg.pingReactions.filter(e => e !== emoji);
    setGuild(guild.id, { pingReactions: list });
    const remaining = list.length > 0 ? list.map(emojiDisplay).join(' ') : 'None';
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setDescription(`Removed ${emojiDisplay(emoji)}. Remaining: ${remaining}`)], ephemeral: true });
  }

  // ── List reactions ──
  if (commandName === 'listreactions') {
    const list = cfg.pingReactions.length > 0
      ? cfg.pingReactions.map((e, i) => `${i + 1}. ${emojiDisplay(e)}`).join('\n')
      : 'No emojis set. Use `/addreaction` to add one.';
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Ping Reaction Emojis').setDescription(list)], ephemeral: true });
  }

  // ── Clear reactions ──
  if (commandName === 'clearreactions') {
    setGuild(guild.id, { pingReactions: [] });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription('All ping reaction emojis cleared.')], ephemeral: true });
  }

  // ── Toggle reactions ──
  if (commandName === 'togglereactions') {
    const updated = setGuild(guild.id, { reactionsEnabled: !cfg.reactionsEnabled });
    const color = updated.reactionsEnabled ? 0x57F287 : 0xED4245;
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(color).setDescription(updated.reactionsEnabled ? 'Auto-reactions enabled.' : 'Auto-reactions disabled.')], ephemeral: true });
  }

  // ── Add target ──
  if (commandName === 'addtarget') {
    const user = interaction.options.getUser('user');
    const ids = new Set(cfg.targetUserIds);
    ids.add(user.id);
    setGuild(guild.id, { targetUserIds: [...ids] });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Added ${user} to targets. Bot will only react when targeted users are pinged.`)], ephemeral: true });
  }

  // ── Remove target ──
  if (commandName === 'removetarget') {
    const user = interaction.options.getUser('user');
    const ids = cfg.targetUserIds.filter(id => id !== user.id);
    setGuild(guild.id, { targetUserIds: ids });
    const note = ids.length === 0 ? '\nNo targets left — bot will react to all pings.' : '';
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setDescription(`Removed ${user} from targets.${note}`)], ephemeral: true });
  }

  // ── View targets ──
  if (commandName === 'targets') {
    const desc = cfg.targetUserIds.length > 0
      ? cfg.targetUserIds.map((id, i) => `${i + 1}. <@${id}>`).join('\n')
      : 'No targets set — reacting to all pings.';
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Target List').setDescription(desc)], ephemeral: true });
  }

  // ── Clear targets ──
  if (commandName === 'cleartargets') {
    setGuild(guild.id, { targetUserIds: [] });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription('Target list cleared. Bot will react to all pings.')], ephemeral: true });
  }

  // ── Add reaction role ──
  if (commandName === 'addreactionrole') {
    const messageId = interaction.options.getString('message_id');
    const rawEmoji = interaction.options.getString('emoji');
    const role = interaction.options.getRole('role');
    const channel = interaction.options.getChannel('channel') || interaction.channel;

    const emoji = parseOneEmoji(rawEmoji);
    if (!emoji) return interaction.reply({ content: 'No valid emoji found.', ephemeral: true });

    let targetMessage;
    try {
      targetMessage = await channel.messages.fetch(messageId);
    } catch {
      return interaction.reply({ content: `Could not find that message in ${channel}. Make sure the message ID is correct and the channel is right.`, ephemeral: true });
    }

    const existing = cfg.reactionRoles.find(r => r.messageId === messageId && r.emoji === emoji && r.roleId === role.id);
    if (existing) return interaction.reply({ content: 'That reaction role already exists.', ephemeral: true });

    cfg.reactionRoles.push({ messageId, channelId: channel.id, emoji, roleId: role.id });
    setGuild(guild.id, { reactionRoles: cfg.reactionRoles });

    await targetMessage.react(emoji).catch(() => {});

    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287)
      .setTitle('Reaction Role Added')
      .setDescription(`Message: [Jump to message](https://discord.com/channels/${guild.id}/${channel.id}/${messageId})\nEmoji: ${emojiDisplay(emoji)}\nRole: ${role}`)
      .setFooter({ text: 'Bot has reacted to the message. Users can now react to get the role.' })
    ], ephemeral: true });
  }

  // ── List reaction roles ──
  if (commandName === 'listreactionroles') {
    if (!cfg.reactionRoles.length) {
      return interaction.reply({ content: 'No reaction roles set up. Use `/addreactionrole` to create one.', ephemeral: true });
    }
    const lines = cfg.reactionRoles.map((r, i) =>
      `**${i + 1}.** ${emojiDisplay(r.emoji)} → <@&${r.roleId}> — [message](https://discord.com/channels/${guild.id}/${r.channelId}/${r.messageId})`
    ).join('\n');
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Reaction Roles').setDescription(lines)], ephemeral: true });
  }

  // ── Remove reaction role ──
  if (commandName === 'removereactionrole') {
    const num = interaction.options.getInteger('number');
    if (num > cfg.reactionRoles.length) return interaction.reply({ content: `No reaction role #${num}. Use \`/listreactionroles\` to see the list.`, ephemeral: true });
    const removed = cfg.reactionRoles.splice(num - 1, 1)[0];
    setGuild(guild.id, { reactionRoles: cfg.reactionRoles });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription(`Removed reaction role #${num} (${emojiDisplay(removed.emoji)} → <@&${removed.roleId}>).`)], ephemeral: true });
  }
});

// ── Auto-react on ping ────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const cfg = getGuild(message.guild.id);
  if (!cfg.reactionsEnabled || !cfg.pingReactions.length) return;

  const hasPing = message.mentions.users.size > 0 || message.mentions.roles.size > 0 || message.mentions.everyone;
  if (!hasPing) return;

  let shouldReact = cfg.targetUserIds.length === 0
    ? true
    : [...message.mentions.users.keys()].some(id => cfg.targetUserIds.includes(id));

  if (!shouldReact) return;
  for (const emoji of cfg.pingReactions) {
    await message.react(emoji).catch(() => {});
  }
});

// ── Reaction role — add role ──────────────────────────────────────────────────
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }

  const guild = reaction.message.guild;
  if (!guild) return;
  const cfg = getGuild(guild.id);
  if (!cfg.reactionRoles.length) return;

  const key = emojiKey(reaction.emoji);
  const match = cfg.reactionRoles.find(r => r.messageId === reaction.message.id && r.emoji === key);
  if (!match) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;
  await member.roles.add(match.roleId).catch(() => {});
});

// ── Reaction role — remove role ───────────────────────────────────────────────
client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }

  const guild = reaction.message.guild;
  if (!guild) return;
  const cfg = getGuild(guild.id);
  if (!cfg.reactionRoles.length) return;

  const key = emojiKey(reaction.emoji);
  const match = cfg.reactionRoles.find(r => r.messageId === reaction.message.id && r.emoji === key);
  if (!match) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;
  await member.roles.remove(match.roleId).catch(() => {});
});

client.login(process.env.DISCORD_TOKEN);
