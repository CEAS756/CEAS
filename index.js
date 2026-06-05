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
  if (!all[guildId]) all[guildId] = {};
  const g = all[guildId];
  const defaults = {
    reactionsEnabled: true,
    defaultReactions: [],
    userReactions: {},
    reactionRoles: [],
    randomMode: false,
    pingCooldownSeconds: {},
    lastPingTime: {},
    ghostPingEnabled: false,
    ghostPingChannelId: null,
    pingCounts: {},
    pingMilestoneChannelId: null,
    moodReactionsEnabled: false,
    shieldedUsers: [],
    shieldAlertChannelId: null,
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (g[k] === undefined) g[k] = v;
  }
  all[guildId] = g;
  saveSettings(all);
  return g;
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

const MOOD_RULES = [
  { keywords: ['happy birthday', 'hbd', 'birthday'], emojis: ['🎂', '🎉', '🎈'] },
  { keywords: ['gg', 'good game', 'well played', 'wp'], emojis: ['🏆', '👏', '🔥'] },
  { keywords: ['rip', 'rest in peace', 'f in chat', 'moment of silence'], emojis: ['😢', '🪦', '💔'] },
  { keywords: ['welcome', 'welcome back', 'wb'], emojis: ['👋', '🎉'] },
  { keywords: ['congrats', 'congratulations', 'grats'], emojis: ['🎊', '🥳', '🎉'] },
  { keywords: ['good morning', 'gm', 'morning'], emojis: ['☀️', '🌅'] },
  { keywords: ['good night', 'gn', 'night night', 'goodnight'], emojis: ['🌙', '😴'] },
  { keywords: ['love', 'love you', 'ily'], emojis: ['❤️', '🥰'] },
  { keywords: ['bruh', 'bro', 'what', 'why'], emojis: ['💀', '😂'] },
  { keywords: ['ban', 'kick', 'mute', 'timeout'], emojis: ['🔨', '⚠️'] },
  { keywords: ['skill issue', 'skill diff', 'cope', 'seethe'], emojis: ['😭', '💀'] },
  { keywords: ['lets go', 'lesgo', "let's go", 'letsgo'], emojis: ['🚀', '🔥', '💪'] },
];

function getMoodEmojis(content) {
  const lower = content.toLowerCase();
  for (const rule of MOOD_RULES) {
    if (rule.keywords.some(k => lower.includes(k))) return rule.emojis;
  }
  return null;
}

const MILESTONES = [10, 25, 50, 100, 250, 500, 1000];

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
  // ── Info ────────────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('panel').setDescription('Open the bot control panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('settings').setDescription('View current bot settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('help').setDescription('Show all commands'),
  new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
  new SlashCommandBuilder().setName('togglereactions').setDescription('Enable or disable all auto-reactions')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // ── Default reactions ────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('setdefault').setDescription('Set default emojis for all pings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('emojis').setDescription('Paste emojis separated by spaces').setRequired(true)),
  new SlashCommandBuilder().setName('adddefault').setDescription('Add one emoji to the default list')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('emoji').setDescription('Emoji to add').setRequired(true)),
  new SlashCommandBuilder().setName('removedefault').setDescription('Remove one emoji from the default list')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('emoji').setDescription('Emoji to remove').setRequired(true)),
  new SlashCommandBuilder().setName('listdefault').setDescription('Show default reaction emojis')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('cleardefault').setDescription('Clear all default reaction emojis')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // ── Per-user reactions ───────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('setuseremojis').setDescription('Set custom emojis for when a specific user is pinged')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('emojis').setDescription('Paste emojis separated by spaces').setRequired(true)),
  new SlashCommandBuilder().setName('adduseremoji').setDescription('Add one emoji for a specific user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('emoji').setDescription('Emoji to add').setRequired(true)),
  new SlashCommandBuilder().setName('removeuseremoji').setDescription('Remove one emoji for a specific user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('emoji').setDescription('Emoji to remove').setRequired(true)),
  new SlashCommandBuilder().setName('clearuseremojis').setDescription('Clear custom emojis for a user (uses default)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('listuseremojis').setDescription('Show all per-user emoji configs')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // ── Reaction roles ───────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('addreactionrole').setDescription('Give a role when someone reacts to a message')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('message_id').setDescription('Message ID').setRequired(true))
    .addStringOption(o => o.setName('emoji').setDescription('Emoji to react with').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Role to give').setRequired(true))
    .addChannelOption(o => o.setName('channel').setDescription('Channel (defaults to current)')),
  new SlashCommandBuilder().setName('listreactionroles').setDescription('List all reaction role setups')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('removereactionrole').setDescription('Remove a reaction role by its number')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(o => o.setName('number').setDescription('Number from /listreactionroles').setRequired(true).setMinValue(1)),

  // ── Random mode ──────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('togglerandom')
    .setDescription('Random mode: picks ONE random emoji from your list instead of all of them')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // ── Mood reactions ───────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('togglemood')
    .setDescription('Mood mode: reacts based on what the message says (birthday, gg, rip, etc.)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('moodlist')
    .setDescription('Show all mood keywords and their reactions'),

  // ── Ping cooldown ────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('setcooldown')
    .setDescription('Set a cooldown so the bot only reacts to a user\'s pings every X seconds')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('user').setDescription('User to apply cooldown to').setRequired(true))
    .addIntegerOption(o => o.setName('seconds').setDescription('Cooldown in seconds (e.g. 60 = 1 minute)').setRequired(true).setMinValue(5)),
  new SlashCommandBuilder().setName('removecooldown')
    .setDescription('Remove cooldown for a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('listcooldowns')
    .setDescription('Show all active ping cooldowns')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // ── Ghost ping detector ──────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('toggleghostping')
    .setDescription('Detect when someone deletes or edits a message to hide a ping')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('setghostchannel')
    .setDescription('Set which channel ghost ping alerts go to')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('channel').setDescription('Alert channel').setRequired(true)),

  // ── Ping leaderboard ─────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('pingled')
    .setDescription('Show the ping leaderboard for this server'),
  new SlashCommandBuilder().setName('pingcount')
    .setDescription('See how many times a user has been pinged')
    .addUserOption(o => o.setName('user').setDescription('User to check (defaults to you)')),
  new SlashCommandBuilder().setName('setmilestonechannel')
    .setDescription('Set channel for ping milestone announcements (10, 25, 50, 100 pings...)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('channel').setDescription('Milestone channel').setRequired(true)),
  new SlashCommandBuilder().setName('resetpingcount')
    .setDescription('Reset the ping count for a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('user').setDescription('User to reset').setRequired(true)),

  // ── Anti-ping shield ─────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('shield')
    .setDescription('Protect a user — bot warns anyone who pings them')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('user').setDescription('User to protect').setRequired(true)),
  new SlashCommandBuilder().setName('unshield')
    .setDescription('Remove shield from a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('listshields')
    .setDescription('Show all shielded users')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('setshieldchannel')
    .setDescription('Set where shield violation alerts are sent (default: same channel)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('channel').setDescription('Alert channel').setRequired(true)),
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

// ── Helper: get emojis to react with ─────────────────────────────────────────
function pickEmojis(cfg, userId, messageContent) {
  const userEmojis = cfg.userReactions[userId] || [];
  const pool = userEmojis.length ? userEmojis : cfg.defaultReactions;
  if (!pool.length) return [];

  if (cfg.moodReactionsEnabled) {
    const mood = getMoodEmojis(messageContent);
    if (mood) return mood;
  }

  if (cfg.randomMode) {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return [pick];
  }

  return pool;
}

// ── Helper: check cooldown ────────────────────────────────────────────────────
function checkCooldown(cfg, userId) {
  const cd = cfg.pingCooldownSeconds[userId];
  if (!cd) return true;
  const last = cfg.lastPingTime[userId] || 0;
  return (Date.now() - last) / 1000 >= cd;
}
function updateCooldown(cfg, guildId, userId) {
  cfg.lastPingTime[userId] = Date.now();
  setGuild(guildId, { lastPingTime: cfg.lastPingTime });
}

// ── Helper: increment ping count + milestone check ────────────────────────────
async function incrementPingCount(cfg, guildId, guild, userId) {
  cfg.pingCounts[userId] = (cfg.pingCounts[userId] || 0) + 1;
  const count = cfg.pingCounts[userId];
  setGuild(guildId, { pingCounts: cfg.pingCounts });

  if (cfg.pingMilestoneChannelId && MILESTONES.includes(count)) {
    const ch = guild.channels.cache.get(cfg.pingMilestoneChannelId);
    if (ch) {
      const embed = new EmbedBuilder().setColor(0xFFD700)
        .setTitle('Ping Milestone!')
        .setDescription(`<@${userId}> has been pinged **${count} times** in this server! 🎉`)
        .setTimestamp();
      await ch.send({ embeds: [embed] }).catch(() => {});
    }
  }
}

// ── Slash command handler ─────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, guild } = interaction;
  const cfg = guild ? getGuild(guild.id) : {};

  if (commandName === 'panel') {
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('CEAS REACTION — Control Panel')
      .addFields(
        { name: 'Default Reactions', value: '`/setdefault` `/adddefault` `/removedefault`\n`/listdefault` `/cleardefault`', inline: true },
        { name: 'Per-User Emojis', value: '`/setuseremojis` `/adduseremoji`\n`/removeuseremoji` `/clearuseremojis`\n`/listuseremojis`', inline: true },
        { name: 'Reaction Roles', value: '`/addreactionrole` `/listreactionroles`\n`/removereactionrole`', inline: true },
        { name: 'Unique Features', value: '`/togglerandom` — Random emoji mode\n`/togglemood` — Mood-based reactions\n`/moodlist` — See mood keywords\n`/setcooldown` `/removecooldown` `/listcooldowns`\n`/toggleghostping` `/setghostchannel`\n`/pingled` `/pingcount` `/resetpingcount`\n`/setmilestonechannel`\n`/shield` `/unshield` `/listshields` `/setshieldchannel`', inline: false },
        { name: 'General', value: '`/togglereactions` `/settings` `/ping` `/help`', inline: false },
      ).setFooter({ text: 'Config commands require Manage Server permission.' }).setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'settings') {
    const g = cfg;
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Current Settings')
      .addFields(
        { name: 'Auto-reactions', value: g.reactionsEnabled ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Random Mode', value: g.randomMode ? 'On' : 'Off', inline: true },
        { name: 'Mood Reactions', value: g.moodReactionsEnabled ? 'On' : 'Off', inline: true },
        { name: 'Default Emojis', value: g.defaultReactions.length ? g.defaultReactions.map(emojiDisplay).join(' ') : 'None', inline: true },
        { name: 'Per-user configs', value: `${Object.keys(g.userReactions).length} users`, inline: true },
        { name: 'Ghost Ping Detect', value: g.ghostPingEnabled ? 'On' : 'Off', inline: true },
        { name: 'Shielded Users', value: `${g.shieldedUsers.length} users`, inline: true },
        { name: 'Reaction Roles', value: `${g.reactionRoles.length} set up`, inline: true },
        { name: 'Ping Cooldowns', value: `${Object.keys(g.pingCooldownSeconds).length} users`, inline: true },
      ).setFooter({ text: 'Use /panel to see all commands.' }).setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'help') {
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('CEAS REACTION — Commands')
      .addFields(
        { name: 'Reactions', value: '`/setdefault` `/adddefault` `/removedefault` `/listdefault` `/cleardefault`\n`/setuseremojis` `/adduseremoji` `/removeuseremoji` `/clearuseremojis` `/listuseremojis`', inline: false },
        { name: 'Reaction Roles', value: '`/addreactionrole` `/listreactionroles` `/removereactionrole`', inline: false },
        { name: 'Unique Features', value: '`/togglerandom` `/togglemood` `/moodlist`\n`/setcooldown` `/removecooldown` `/listcooldowns`\n`/toggleghostping` `/setghostchannel`\n`/pingled` `/pingcount` `/resetpingcount` `/setmilestonechannel`\n`/shield` `/unshield` `/listshields` `/setshieldchannel`', inline: false },
        { name: 'General', value: '`/togglereactions` `/settings` `/panel` `/ping` `/help`', inline: false },
      ).setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'ping') {
    const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
    return interaction.editReply(`Pong! Latency: **${sent.createdTimestamp - interaction.createdTimestamp}ms** | API: **${Math.round(client.ws.ping)}ms**`);
  }

  if (commandName === 'togglereactions') {
    const updated = setGuild(guild.id, { reactionsEnabled: !cfg.reactionsEnabled });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(updated.reactionsEnabled ? 0x57F287 : 0xED4245)
      .setDescription(updated.reactionsEnabled ? 'Auto-reactions enabled.' : 'Auto-reactions disabled.')], ephemeral: true });
  }

  // ── Default reactions ──
  if (commandName === 'setdefault') {
    const emojis = parseManyEmojis(interaction.options.getString('emojis'));
    if (!emojis.length) return interaction.reply({ content: 'No valid emojis found.', ephemeral: true });
    setGuild(guild.id, { defaultReactions: emojis });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Default reactions set: ${emojis.map(emojiDisplay).join(' ')}`)], ephemeral: true });
  }
  if (commandName === 'adddefault') {
    const emoji = parseOneEmoji(interaction.options.getString('emoji'));
    if (!emoji) return interaction.reply({ content: 'No valid emoji found.', ephemeral: true });
    const list = [...new Set([...cfg.defaultReactions, emoji])];
    setGuild(guild.id, { defaultReactions: list });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Added ${emojiDisplay(emoji)}. Current: ${list.map(emojiDisplay).join(' ')}`)], ephemeral: true });
  }
  if (commandName === 'removedefault') {
    const emoji = parseOneEmoji(interaction.options.getString('emoji'));
    if (!emoji) return interaction.reply({ content: 'No valid emoji found.', ephemeral: true });
    const list = cfg.defaultReactions.filter(e => e !== emoji);
    setGuild(guild.id, { defaultReactions: list });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setDescription(`Removed ${emojiDisplay(emoji)}. Remaining: ${list.map(emojiDisplay).join(' ') || 'None'}`)], ephemeral: true });
  }
  if (commandName === 'listdefault') {
    const list = cfg.defaultReactions.length ? cfg.defaultReactions.map((e, i) => `${i + 1}. ${emojiDisplay(e)}`).join('\n') : 'No default emojis set.';
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Default Reaction Emojis').setDescription(list)], ephemeral: true });
  }
  if (commandName === 'cleardefault') {
    setGuild(guild.id, { defaultReactions: [] });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription('Default emojis cleared.')], ephemeral: true });
  }

  // ── Per-user reactions ──
  if (commandName === 'setuseremojis') {
    const user = interaction.options.getUser('user');
    const emojis = parseManyEmojis(interaction.options.getString('emojis'));
    if (!emojis.length) return interaction.reply({ content: 'No valid emojis found.', ephemeral: true });
    setGuild(guild.id, { userReactions: { ...cfg.userReactions, [user.id]: emojis } });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle(`Emojis set for ${user.username}`).setDescription(`When ${user} is pinged: ${emojis.map(emojiDisplay).join(' ')}`)], ephemeral: true });
  }
  if (commandName === 'adduseremoji') {
    const user = interaction.options.getUser('user');
    const emoji = parseOneEmoji(interaction.options.getString('emoji'));
    if (!emoji) return interaction.reply({ content: 'No valid emoji found.', ephemeral: true });
    const list = [...new Set([...(cfg.userReactions[user.id] || []), emoji])];
    setGuild(guild.id, { userReactions: { ...cfg.userReactions, [user.id]: list } });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Added ${emojiDisplay(emoji)} for ${user}. All: ${list.map(emojiDisplay).join(' ')}`)], ephemeral: true });
  }
  if (commandName === 'removeuseremoji') {
    const user = interaction.options.getUser('user');
    const emoji = parseOneEmoji(interaction.options.getString('emoji'));
    if (!emoji) return interaction.reply({ content: 'No valid emoji found.', ephemeral: true });
    const list = (cfg.userReactions[user.id] || []).filter(e => e !== emoji);
    const ur = { ...cfg.userReactions };
    if (list.length) ur[user.id] = list; else delete ur[user.id];
    setGuild(guild.id, { userReactions: ur });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setDescription(list.length ? `Removed for ${user}. Remaining: ${list.map(emojiDisplay).join(' ')}` : `Removed for ${user}. They now use default emojis.`)], ephemeral: true });
  }
  if (commandName === 'clearuseremojis') {
    const user = interaction.options.getUser('user');
    const ur = { ...cfg.userReactions };
    delete ur[user.id];
    setGuild(guild.id, { userReactions: ur });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription(`Custom emojis cleared for ${user}. They now use defaults.`)], ephemeral: true });
  }
  if (commandName === 'listuseremojis') {
    const entries = Object.entries(cfg.userReactions);
    if (!entries.length) return interaction.reply({ content: 'No per-user configs. Use `/setuseremojis @user`.', ephemeral: true });
    const lines = entries.map(([id, emojis], i) => `${i + 1}. <@${id}> → ${emojis.map(emojiDisplay).join(' ')}`).join('\n');
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Per-User Emoji Config').setDescription(lines).setFooter({ text: 'Users not listed use default emojis.' })], ephemeral: true });
  }

  // ── Reaction roles ──
  if (commandName === 'addreactionrole') {
    const messageId = interaction.options.getString('message_id');
    const emoji = parseOneEmoji(interaction.options.getString('emoji'));
    const role = interaction.options.getRole('role');
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (!emoji) return interaction.reply({ content: 'No valid emoji found.', ephemeral: true });
    let targetMessage;
    try { targetMessage = await channel.messages.fetch(messageId); } catch { return interaction.reply({ content: `Could not find that message in ${channel}.`, ephemeral: true }); }
    if (cfg.reactionRoles.find(r => r.messageId === messageId && r.emoji === emoji && r.roleId === role.id)) return interaction.reply({ content: 'That reaction role already exists.', ephemeral: true });
    cfg.reactionRoles.push({ messageId, channelId: channel.id, emoji, roleId: role.id });
    setGuild(guild.id, { reactionRoles: cfg.reactionRoles });
    await targetMessage.react(emoji).catch(() => {});
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('Reaction Role Added').setDescription(`[Jump to message](https://discord.com/channels/${guild.id}/${channel.id}/${messageId})\nEmoji: ${emojiDisplay(emoji)} → Role: ${role}`)], ephemeral: true });
  }
  if (commandName === 'listreactionroles') {
    if (!cfg.reactionRoles.length) return interaction.reply({ content: 'No reaction roles set up.', ephemeral: true });
    const lines = cfg.reactionRoles.map((r, i) => `**${i + 1}.** ${emojiDisplay(r.emoji)} → <@&${r.roleId}>\n   [message](https://discord.com/channels/${guild.id}/${r.channelId}/${r.messageId})`).join('\n\n');
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Reaction Roles').setDescription(lines)], ephemeral: true });
  }
  if (commandName === 'removereactionrole') {
    const num = interaction.options.getInteger('number');
    if (num > cfg.reactionRoles.length) return interaction.reply({ content: `No reaction role #${num}.`, ephemeral: true });
    const removed = cfg.reactionRoles.splice(num - 1, 1)[0];
    setGuild(guild.id, { reactionRoles: cfg.reactionRoles });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription(`Removed #${num} (${emojiDisplay(removed.emoji)} → <@&${removed.roleId}>).`)], ephemeral: true });
  }

  // ── Random mode ──
  if (commandName === 'togglerandom') {
    const updated = setGuild(guild.id, { randomMode: !cfg.randomMode });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(updated.randomMode ? 0x57F287 : 0xFEE75C)
      .setTitle(updated.randomMode ? 'Random Mode ON' : 'Random Mode OFF')
      .setDescription(updated.randomMode ? 'Bot will now pick ONE random emoji from your list each time.' : 'Bot will react with ALL emojis from your list.')], ephemeral: true });
  }

  // ── Mood reactions ──
  if (commandName === 'togglemood') {
    const updated = setGuild(guild.id, { moodReactionsEnabled: !cfg.moodReactionsEnabled });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(updated.moodReactionsEnabled ? 0x57F287 : 0xFEE75C)
      .setTitle(updated.moodReactionsEnabled ? 'Mood Reactions ON' : 'Mood Reactions OFF')
      .setDescription(updated.moodReactionsEnabled ? 'Bot will now react based on message context (birthday, gg, rip, etc.). Use `/moodlist` to see all triggers.' : 'Mood reactions disabled. Bot uses configured emojis.')], ephemeral: true });
  }
  if (commandName === 'moodlist') {
    const lines = MOOD_RULES.map(r => `${r.emojis.join(' ')} — \`${r.keywords.slice(0, 3).join('`, `')}\``).join('\n');
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Mood Reaction Triggers').setDescription(lines).setFooter({ text: 'When enabled via /togglemood, bot reacts with these when keywords appear in the message.' })], ephemeral: true });
  }

  // ── Cooldowns ──
  if (commandName === 'setcooldown') {
    const user = interaction.options.getUser('user');
    const seconds = interaction.options.getInteger('seconds');
    cfg.pingCooldownSeconds[user.id] = seconds;
    setGuild(guild.id, { pingCooldownSeconds: cfg.pingCooldownSeconds });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Cooldown for ${user} set to **${seconds} seconds**.\nBot will only react to their pings once every ${seconds}s.`)], ephemeral: true });
  }
  if (commandName === 'removecooldown') {
    const user = interaction.options.getUser('user');
    delete cfg.pingCooldownSeconds[user.id];
    delete cfg.lastPingTime[user.id];
    setGuild(guild.id, { pingCooldownSeconds: cfg.pingCooldownSeconds, lastPingTime: cfg.lastPingTime });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setDescription(`Cooldown removed for ${user}.`)], ephemeral: true });
  }
  if (commandName === 'listcooldowns') {
    const entries = Object.entries(cfg.pingCooldownSeconds);
    if (!entries.length) return interaction.reply({ content: 'No cooldowns set.', ephemeral: true });
    const lines = entries.map(([id, sec], i) => `${i + 1}. <@${id}> — ${sec}s`).join('\n');
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Ping Cooldowns').setDescription(lines)], ephemeral: true });
  }

  // ── Ghost ping ──
  if (commandName === 'toggleghostping') {
    const updated = setGuild(guild.id, { ghostPingEnabled: !cfg.ghostPingEnabled });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(updated.ghostPingEnabled ? 0x57F287 : 0xFEE75C)
      .setTitle(updated.ghostPingEnabled ? 'Ghost Ping Detector ON' : 'Ghost Ping Detector OFF')
      .setDescription(updated.ghostPingEnabled ? 'Bot will now detect deleted or edited pings and post an alert.' : 'Ghost ping detection disabled.')], ephemeral: true });
  }
  if (commandName === 'setghostchannel') {
    const channel = interaction.options.getChannel('channel');
    setGuild(guild.id, { ghostPingChannelId: channel.id });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Ghost ping alerts will be sent to ${channel}.`)], ephemeral: true });
  }

  // ── Ping leaderboard ──
  if (commandName === 'pingled') {
    const counts = Object.entries(cfg.pingCounts).sort(([, a], [, b]) => b - a).slice(0, 10);
    if (!counts.length) return interaction.reply({ content: 'No pings tracked yet.', ephemeral: false });
    const medals = ['🥇', '🥈', '🥉'];
    const lines = counts.map(([id, count], i) => `${medals[i] || `${i + 1}.`} <@${id}> — **${count}** pings`).join('\n');
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFFD700).setTitle('Ping Leaderboard').setDescription(lines).setTimestamp()] });
  }
  if (commandName === 'pingcount') {
    const user = interaction.options.getUser('user') || interaction.user;
    const count = cfg.pingCounts[user.id] || 0;
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setDescription(`${user} has been pinged **${count}** times in this server.`)] });
  }
  if (commandName === 'setmilestonechannel') {
    const channel = interaction.options.getChannel('channel');
    setGuild(guild.id, { pingMilestoneChannelId: channel.id });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Milestone announcements will be sent to ${channel}.\nMilestones: ${MILESTONES.join(', ')} pings.`)], ephemeral: true });
  }
  if (commandName === 'resetpingcount') {
    const user = interaction.options.getUser('user');
    cfg.pingCounts[user.id] = 0;
    setGuild(guild.id, { pingCounts: cfg.pingCounts });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription(`Ping count reset for ${user}.`)], ephemeral: true });
  }

  // ── Shield ──
  if (commandName === 'shield') {
    const user = interaction.options.getUser('user');
    const list = new Set(cfg.shieldedUsers);
    list.add(user.id);
    setGuild(guild.id, { shieldedUsers: [...list] });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('User Shielded').setDescription(`${user} is now protected. Anyone who pings them will get a warning.`)], ephemeral: true });
  }
  if (commandName === 'unshield') {
    const user = interaction.options.getUser('user');
    setGuild(guild.id, { shieldedUsers: cfg.shieldedUsers.filter(id => id !== user.id) });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setDescription(`Shield removed from ${user}.`)], ephemeral: true });
  }
  if (commandName === 'listshields') {
    const list = cfg.shieldedUsers.length ? cfg.shieldedUsers.map((id, i) => `${i + 1}. <@${id}>`).join('\n') : 'No shielded users.';
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Shielded Users').setDescription(list)], ephemeral: true });
  }
  if (commandName === 'setshieldchannel') {
    const channel = interaction.options.getChannel('channel');
    setGuild(guild.id, { shieldAlertChannelId: channel.id });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Shield alerts will be sent to ${channel}.`)], ephemeral: true });
  }
});

// ── Auto-react on ping ────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const cfg = getGuild(message.guild.id);
  if (!cfg.reactionsEnabled) return;

  const mentionedIds = [...message.mentions.users.keys()];
  const hasRolePing = message.mentions.roles.size > 0 || message.mentions.everyone;
  if (!mentionedIds.length && !hasRolePing) return;

  for (const userId of mentionedIds) {
    if (!checkCooldown(cfg, userId)) continue;

    const emojis = pickEmojis(cfg, userId, message.content);
    if (emojis.length) {
      for (const emoji of emojis) await message.react(emoji).catch(() => {});
      updateCooldown(cfg, message.guild.id, userId);
    }

    await incrementPingCount(cfg, message.guild.id, message.guild, userId);

    if (cfg.shieldedUsers.includes(userId)) {
      const alertCh = cfg.shieldAlertChannelId
        ? message.guild.channels.cache.get(cfg.shieldAlertChannelId)
        : message.channel;
      if (alertCh) {
        const embed = new EmbedBuilder().setColor(0xED4245)
          .setTitle('Shield Alert')
          .setDescription(`${message.author} — <@${userId}> is protected and should not be pinged.`)
          .setTimestamp();
        await alertCh.send({ embeds: [embed] }).catch(() => {});
      }
    }
  }

  if (!mentionedIds.length && hasRolePing) {
    const emojis = cfg.randomMode
      ? [cfg.defaultReactions[Math.floor(Math.random() * cfg.defaultReactions.length)]]
      : cfg.defaultReactions;
    for (const emoji of emojis) await message.react(emoji).catch(() => {});
  }
});

// ── Ghost ping: message deleted ───────────────────────────────────────────────
client.on('messageDelete', async (message) => {
  if (!message.guild || message.author?.bot) return;
  const cfg = getGuild(message.guild.id);
  if (!cfg.ghostPingEnabled) return;

  const hasPing = message.mentions?.users?.size > 0 || message.mentions?.roles?.size > 0;
  if (!hasPing) return;

  const alertCh = cfg.ghostPingChannelId
    ? message.guild.channels.cache.get(cfg.ghostPingChannelId)
    : message.channel;
  if (!alertCh) return;

  const pinged = message.mentions.users.map(u => `${u}`).join(', ') || 'a role';
  const embed = new EmbedBuilder().setColor(0xFF6B6B)
    .setTitle('👻 Ghost Ping Detected')
    .setDescription(`**${message.author?.tag || 'Someone'}** deleted a message that pinged ${pinged}.`)
    .addFields({ name: 'Original Message', value: message.content ? `"${message.content.slice(0, 300)}"` : '*(no content)*' })
    .setTimestamp();
  await alertCh.send({ embeds: [embed] }).catch(() => {});
});

// ── Ghost ping: message edited to remove ping ─────────────────────────────────
client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!oldMessage.guild || oldMessage.author?.bot) return;
  const cfg = getGuild(oldMessage.guild.id);
  if (!cfg.ghostPingEnabled) return;

  const hadPing = oldMessage.mentions?.users?.size > 0 || oldMessage.mentions?.roles?.size > 0;
  const hasPing = newMessage.mentions?.users?.size > 0 || newMessage.mentions?.roles?.size > 0;
  if (!hadPing || hasPing) return;

  const alertCh = cfg.ghostPingChannelId
    ? oldMessage.guild.channels.cache.get(cfg.ghostPingChannelId)
    : oldMessage.channel;
  if (!alertCh) return;

  const pinged = oldMessage.mentions.users.map(u => `${u}`).join(', ') || 'a role';
  const embed = new EmbedBuilder().setColor(0xFF6B6B)
    .setTitle('👻 Ghost Ping Detected (Edited)')
    .setDescription(`**${oldMessage.author?.tag || 'Someone'}** edited a message to remove a ping to ${pinged}.`)
    .addFields(
      { name: 'Before', value: oldMessage.content ? `"${oldMessage.content.slice(0, 200)}"` : '*(unknown)*' },
      { name: 'After', value: newMessage.content ? `"${newMessage.content.slice(0, 200)}"` : '*(empty)*' },
    )
    .setTimestamp();
  await alertCh.send({ embeds: [embed] }).catch(() => {});
});

// ── Reaction role: add/remove ─────────────────────────────────────────────────
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
  const guild = reaction.message.guild;
  if (!guild) return;
  const cfg = getGuild(guild.id);
  const key = emojiKey(reaction.emoji);
  const match = cfg.reactionRoles.find(r => r.messageId === reaction.message.id && r.emoji === key);
  if (!match) return;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (member) await member.roles.add(match.roleId).catch(() => {});
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
  const guild = reaction.message.guild;
  if (!guild) return;
  const cfg = getGuild(guild.id);
  const key = emojiKey(reaction.emoji);
  const match = cfg.reactionRoles.find(r => r.messageId === reaction.message.id && r.emoji === key);
  if (!match) return;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (member) await member.roles.remove(match.roleId).catch(() => {});
});

client.login(process.env.DISCORD_TOKEN);
