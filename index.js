require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  REST, Routes, SlashCommandBuilder, PermissionFlagsBits,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

// ── Default mood rules ────────────────────────────────────────────────────────
const DEFAULT_MOODS = [
  { keyword: 'happy birthday', emojis: ['🎂', '🎉', '🎈'] },
  { keyword: 'hbd', emojis: ['🎂', '🎉'] },
  { keyword: 'gg', emojis: ['🏆', '👏', '🔥'] },
  { keyword: 'well played', emojis: ['🏆', '👏'] },
  { keyword: 'rip', emojis: ['😢', '🪦', '💔'] },
  { keyword: 'welcome', emojis: ['👋', '🎉'] },
  { keyword: 'congrats', emojis: ['🎊', '🥳', '🎉'] },
  { keyword: 'good morning', emojis: ['☀️', '🌅'] },
  { keyword: 'gm', emojis: ['☀️', '🌅'] },
  { keyword: 'good night', emojis: ['🌙', '😴'] },
  { keyword: 'gn', emojis: ['🌙', '😴'] },
  { keyword: 'love you', emojis: ['❤️', '🥰'] },
  { keyword: 'ily', emojis: ['❤️', '🥰'] },
  { keyword: 'bruh', emojis: ['💀', '😂'] },
  { keyword: 'lets go', emojis: ['🚀', '🔥', '💪'] },
  { keyword: 'skill issue', emojis: ['😭', '💀'] },
  { keyword: 'ban', emojis: ['🔨', '⚠️'] },
  { keyword: 'good luck', emojis: ['🍀', '🤞'] },
  { keyword: 'gl', emojis: ['🍀', '🤞'] },
  { keyword: 'sus', emojis: ['👀', '🫵'] },
  { keyword: 'pog', emojis: ['😮', '🔥'] },
  { keyword: 'based', emojis: ['💪', '😤'] },
  { keyword: 'cringe', emojis: ['💀', '😬'] },
  { keyword: 'w', emojis: ['🏆', '💪'] },
  { keyword: 'l', emojis: ['💀', '📉'] },
];

// ── Persistence ───────────────────────────────────────────────────────────────
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
    autoMoodEnabled: false,
    moodRules: JSON.parse(JSON.stringify(DEFAULT_MOODS)),
    shieldedUsers: [],
    shieldAlertChannelId: null,
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (g[k] === undefined) g[k] = typeof v === 'object' && v !== null ? JSON.parse(JSON.stringify(v)) : v;
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

// ── Emoji helpers ─────────────────────────────────────────────────────────────
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
function emojiDisplay(e) { return isNaN(e) ? e : `<:_:${e}>`; }
function emojiKey(emoji) { return emoji.id || emoji.name; }

// ── Mood helpers ──────────────────────────────────────────────────────────────
function getMoodEmojis(moodRules, content) {
  const lower = content.toLowerCase();
  for (const rule of moodRules) {
    if (lower.includes(rule.keyword.toLowerCase())) return rule.emojis;
  }
  return null;
}

// ── Ping reaction helpers ─────────────────────────────────────────────────────
function pickEmojis(cfg, userId, messageContent) {
  if (cfg.moodReactionsEnabled) {
    const mood = getMoodEmojis(cfg.moodRules, messageContent);
    if (mood) return mood;
  }
  const userEmojis = cfg.userReactions[userId] || [];
  const pool = userEmojis.length ? userEmojis : cfg.defaultReactions;
  if (!pool.length) return [];
  return cfg.randomMode ? [pool[Math.floor(Math.random() * pool.length)]] : pool;
}

function checkCooldown(cfg, userId) {
  const cd = cfg.pingCooldownSeconds[userId];
  if (!cd) return true;
  return (Date.now() - (cfg.lastPingTime[userId] || 0)) / 1000 >= cd;
}
function updateCooldown(cfg, guildId, userId) {
  cfg.lastPingTime[userId] = Date.now();
  setGuild(guildId, { lastPingTime: cfg.lastPingTime });
}

const MILESTONES = [10, 25, 50, 100, 250, 500, 1000];
async function incrementPingCount(cfg, guildId, guild, userId) {
  cfg.pingCounts[userId] = (cfg.pingCounts[userId] || 0) + 1;
  const count = cfg.pingCounts[userId];
  setGuild(guildId, { pingCounts: cfg.pingCounts });
  if (cfg.pingMilestoneChannelId && MILESTONES.includes(count)) {
    const ch = guild.channels.cache.get(cfg.pingMilestoneChannelId);
    if (ch) await ch.send({ embeds: [new EmbedBuilder().setColor(0xFFD700).setTitle('🏅 Ping Milestone!').setDescription(`<@${userId}> has been pinged **${count} times** in this server!`).setTimestamp()] }).catch(() => {});
  }
}

// ── Client ────────────────────────────────────────────────────────────────────
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

// ── Commands ──────────────────────────────────────────────────────────────────
const ADMIN = PermissionFlagsBits.ManageGuild;
const commands = [
  // Info
  new SlashCommandBuilder().setName('panel').setDescription('Open the full control panel').setDefaultMemberPermissions(ADMIN),
  new SlashCommandBuilder().setName('help').setDescription('Browse all commands by category').addStringOption(o => o.setName('category').setDescription('Category to view').setChoices(
    { name: '📋 All', value: 'all' },
    { name: '🔔 Reactions', value: 'reactions' },
    { name: '🎭 Mood', value: 'mood' },
    { name: '🎯 Reaction Roles', value: 'roles' },
    { name: '👻 Ghost Ping', value: 'ghost' },
    { name: '📊 Leaderboard', value: 'leaderboard' },
    { name: '🛡️ Shield', value: 'shield' },
    { name: '⚙️ Settings', value: 'settings' },
  )),
  new SlashCommandBuilder().setName('settings').setDescription('View all current bot settings').setDefaultMemberPermissions(ADMIN),
  new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),

  // Core reactions
  new SlashCommandBuilder().setName('togglereactions').setDescription('Enable or disable all auto-reactions').setDefaultMemberPermissions(ADMIN),
  new SlashCommandBuilder().setName('togglerandom').setDescription('Random mode — picks ONE random emoji per ping instead of all').setDefaultMemberPermissions(ADMIN),
  new SlashCommandBuilder().setName('setdefault').setDescription('Replace all default reaction emojis').setDefaultMemberPermissions(ADMIN).addStringOption(o => o.setName('emojis').setDescription('Paste emojis separated by spaces').setRequired(true)),
  new SlashCommandBuilder().setName('adddefault').setDescription('Add one emoji to the default list').setDefaultMemberPermissions(ADMIN).addStringOption(o => o.setName('emoji').setDescription('Emoji to add').setRequired(true)),
  new SlashCommandBuilder().setName('removedefault').setDescription('Remove one emoji from the default list').setDefaultMemberPermissions(ADMIN).addStringOption(o => o.setName('emoji').setDescription('Emoji to remove').setRequired(true)),
  new SlashCommandBuilder().setName('listdefault').setDescription('Show the default reaction emoji list').setDefaultMemberPermissions(ADMIN),
  new SlashCommandBuilder().setName('cleardefault').setDescription('Clear all default reaction emojis').setDefaultMemberPermissions(ADMIN),

  // Per-user reactions
  new SlashCommandBuilder().setName('setuseremojis').setDescription('Set custom emojis for when a specific user is pinged').setDefaultMemberPermissions(ADMIN)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('emojis').setDescription('Paste emojis separated by spaces').setRequired(true)),
  new SlashCommandBuilder().setName('adduseremoji').setDescription('Add one emoji for a specific user').setDefaultMemberPermissions(ADMIN)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('emoji').setDescription('Emoji to add').setRequired(true)),
  new SlashCommandBuilder().setName('removeuseremoji').setDescription('Remove one emoji from a specific user').setDefaultMemberPermissions(ADMIN)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('emoji').setDescription('Emoji to remove').setRequired(true)),
  new SlashCommandBuilder().setName('clearuseremojis').setDescription('Clear custom emojis for a user — reverts to defaults').setDefaultMemberPermissions(ADMIN)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('listuseremojis').setDescription('Show all per-user emoji configurations').setDefaultMemberPermissions(ADMIN),

  // Mood
  new SlashCommandBuilder().setName('togglemood').setDescription('Mood mode — react based on keywords in the message when someone is pinged').setDefaultMemberPermissions(ADMIN),
  new SlashCommandBuilder().setName('toggleautomood').setDescription('Auto mood — react to ANY message with mood keywords (no ping required)').setDefaultMemberPermissions(ADMIN),
  new SlashCommandBuilder().setName('listmoods').setDescription('Show all mood rules with their keywords and emojis'),
  new SlashCommandBuilder().setName('addmood').setDescription('Add a custom mood rule — set what emojis react to a keyword').setDefaultMemberPermissions(ADMIN)
    .addStringOption(o => o.setName('keyword').setDescription('Word or phrase that triggers this mood (e.g. "nice one")').setRequired(true))
    .addStringOption(o => o.setName('emojis').setDescription('Emojis to react with when keyword appears').setRequired(true)),
  new SlashCommandBuilder().setName('editmood').setDescription('Change the emojis for an existing mood rule').setDefaultMemberPermissions(ADMIN)
    .addStringOption(o => o.setName('keyword').setDescription('The keyword of the rule to edit').setRequired(true))
    .addStringOption(o => o.setName('emojis').setDescription('New emojis').setRequired(true)),
  new SlashCommandBuilder().setName('removemood').setDescription('Remove a mood rule by keyword').setDefaultMemberPermissions(ADMIN)
    .addStringOption(o => o.setName('keyword').setDescription('Keyword of the rule to remove').setRequired(true)),
  new SlashCommandBuilder().setName('resetmoods').setDescription('Reset all mood rules back to the built-in defaults').setDefaultMemberPermissions(ADMIN),

  // Reaction roles
  new SlashCommandBuilder().setName('addreactionrole').setDescription('Give a role when someone reacts to a message with an emoji').setDefaultMemberPermissions(ADMIN)
    .addStringOption(o => o.setName('message_id').setDescription('Message ID').setRequired(true))
    .addStringOption(o => o.setName('emoji').setDescription('Emoji to react with').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Role to give').setRequired(true))
    .addChannelOption(o => o.setName('channel').setDescription('Channel the message is in (defaults to current)')),
  new SlashCommandBuilder().setName('listreactionroles').setDescription('List all reaction role setups').setDefaultMemberPermissions(ADMIN),
  new SlashCommandBuilder().setName('removereactionrole').setDescription('Remove a reaction role by its number').setDefaultMemberPermissions(ADMIN)
    .addIntegerOption(o => o.setName('number').setDescription('Number from /listreactionroles').setRequired(true).setMinValue(1)),

  // Ghost ping
  new SlashCommandBuilder().setName('toggleghostping').setDescription('Detect deleted or edited messages that contained pings').setDefaultMemberPermissions(ADMIN),
  new SlashCommandBuilder().setName('setghostchannel').setDescription('Set channel where ghost ping alerts are sent').setDefaultMemberPermissions(ADMIN)
    .addChannelOption(o => o.setName('channel').setDescription('Alert channel').setRequired(true)),

  // Ping leaderboard
  new SlashCommandBuilder().setName('pingled').setDescription('Show the ping leaderboard for this server'),
  new SlashCommandBuilder().setName('pingcount').setDescription('See how many times a user has been pinged')
    .addUserOption(o => o.setName('user').setDescription('User (defaults to you)')),
  new SlashCommandBuilder().setName('setmilestonechannel').setDescription('Set channel for ping milestone announcements').setDefaultMemberPermissions(ADMIN)
    .addChannelOption(o => o.setName('channel').setDescription('Milestone channel').setRequired(true)),
  new SlashCommandBuilder().setName('resetpingcount').setDescription('Reset ping count for a user').setDefaultMemberPermissions(ADMIN)
    .addUserOption(o => o.setName('user').setDescription('User to reset').setRequired(true)),

  // Cooldowns
  new SlashCommandBuilder().setName('setcooldown').setDescription('Set a reaction cooldown for a user in seconds').setDefaultMemberPermissions(ADMIN)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(o => o.setName('seconds').setDescription('Cooldown in seconds').setRequired(true).setMinValue(5)),
  new SlashCommandBuilder().setName('removecooldown').setDescription('Remove cooldown for a user').setDefaultMemberPermissions(ADMIN)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('listcooldowns').setDescription('Show all active ping cooldowns').setDefaultMemberPermissions(ADMIN),

  // Shield
  new SlashCommandBuilder().setName('shield').setDescription('Protect a user — bot warns anyone who pings them').setDefaultMemberPermissions(ADMIN)
    .addUserOption(o => o.setName('user').setDescription('User to protect').setRequired(true)),
  new SlashCommandBuilder().setName('unshield').setDescription('Remove shield from a user').setDefaultMemberPermissions(ADMIN)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('listshields').setDescription('Show all shielded users').setDefaultMemberPermissions(ADMIN),
  new SlashCommandBuilder().setName('setshieldchannel').setDescription('Set channel for shield violation alerts').setDefaultMemberPermissions(ADMIN)
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
  client.user.setActivity('Type /panel to configure', { type: 3 });
  await registerCommands();
});

// ── Panel sections helper ─────────────────────────────────────────────────────
function buildPanelEmbed(cfg) {
  const statusLine = (on) => on ? '`ON`' : '`OFF`';
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('⚙️ CEAS REACTION — Control Panel')
    .setDescription('All settings for this server. Only admins can use config commands.')
    .addFields(
      {
        name: '─── 🔔 Ping Reactions ───',
        value: [
          `Auto-react: ${statusLine(cfg.reactionsEnabled)} | Random mode: ${statusLine(cfg.randomMode)}`,
          `Default emojis: ${cfg.defaultReactions.length ? cfg.defaultReactions.map(emojiDisplay).join(' ') : '*(none set)*'}`,
          `Per-user configs: **${Object.keys(cfg.userReactions).length}** users`,
          '`/setdefault` `/adddefault` `/removedefault` `/listdefault` `/cleardefault`',
          '`/setuseremojis` `/adduseremoji` `/removeuseremoji` `/clearuseremojis` `/listuseremojis`',
          '`/togglereactions` `/togglerandom`',
        ].join('\n'),
        inline: false,
      },
      {
        name: '─── 🎭 Mood Reactions ───',
        value: [
          `Mood on ping: ${statusLine(cfg.moodReactionsEnabled)} | Auto mood (any msg): ${statusLine(cfg.autoMoodEnabled)}`,
          `Mood rules: **${cfg.moodRules.length}** rules`,
          '`/togglemood` `/toggleautomood` `/listmoods`',
          '`/addmood` `/editmood` `/removemood` `/resetmoods`',
        ].join('\n'),
        inline: false,
      },
      {
        name: '─── 🎯 Reaction Roles ───',
        value: [
          `Active setups: **${cfg.reactionRoles.length}**`,
          '`/addreactionrole` `/listreactionroles` `/removereactionrole`',
        ].join('\n'),
        inline: false,
      },
      {
        name: '─── 👻 Ghost Ping Detector ───',
        value: [
          `Status: ${statusLine(cfg.ghostPingEnabled)} | Alert channel: ${cfg.ghostPingChannelId ? `<#${cfg.ghostPingChannelId}>` : '*(same channel)*'}`,
          '`/toggleghostping` `/setghostchannel`',
        ].join('\n'),
        inline: false,
      },
      {
        name: '─── 📊 Ping Leaderboard ───',
        value: [
          `Milestone channel: ${cfg.pingMilestoneChannelId ? `<#${cfg.pingMilestoneChannelId}>` : '*(not set)*'}`,
          `Milestones fire at: ${MILESTONES.join(', ')} pings`,
          '`/pingled` `/pingcount` `/resetpingcount` `/setmilestonechannel`',
        ].join('\n'),
        inline: false,
      },
      {
        name: '─── ⏱️ Cooldowns ───',
        value: [
          `Active cooldowns: **${Object.keys(cfg.pingCooldownSeconds).length}** users`,
          '`/setcooldown` `/removecooldown` `/listcooldowns`',
        ].join('\n'),
        inline: false,
      },
      {
        name: '─── 🛡️ Anti-Ping Shield ───',
        value: [
          `Shielded users: **${cfg.shieldedUsers.length}** | Alert channel: ${cfg.shieldAlertChannelId ? `<#${cfg.shieldAlertChannelId}>` : '*(same channel)*'}`,
          '`/shield` `/unshield` `/listshields` `/setshieldchannel`',
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'Use /help <category> for detailed info on any section.' })
    .setTimestamp();
}

// ── Help embeds by category ───────────────────────────────────────────────────
function buildHelpEmbed(category) {
  const base = new EmbedBuilder().setColor(0x5865F2).setTimestamp();

  if (!category || category === 'all') {
    return base.setTitle('📖 CEAS REACTION — Command Categories')
      .setDescription('Use `/help <category>` to see detailed commands for each section.')
      .addFields(
        { name: '🔔 Reactions', value: 'Set emojis, per-user emojis, random mode\n`/help reactions`', inline: true },
        { name: '🎭 Mood', value: 'Mood & auto mood reactions, custom rules\n`/help mood`', inline: true },
        { name: '🎯 Reaction Roles', value: 'Assign roles via emoji reactions\n`/help roles`', inline: true },
        { name: '👻 Ghost Ping', value: 'Detect deleted/edited pings\n`/help ghost`', inline: true },
        { name: '📊 Leaderboard', value: 'Ping counts, milestones, stats\n`/help leaderboard`', inline: true },
        { name: '🛡️ Shield', value: 'Protect users from being pinged\n`/help shield`', inline: true },
        { name: '⚙️ Settings', value: 'Cooldowns, toggles, panel\n`/help settings`', inline: true },
      );
  }

  if (category === 'reactions') {
    return base.setTitle('🔔 Ping Reactions — Commands')
      .addFields(
        { name: '`/togglereactions`', value: 'Turn all auto-reactions on or off.', inline: false },
        { name: '`/togglerandom`', value: 'When ON, picks **one random emoji** from your list each ping instead of all of them.', inline: false },
        { name: '`/setdefault <emojis>`', value: 'Replace the entire default emoji list. Paste emojis separated by spaces.\nWorks with standard, custom `<:name:ID>`, and Nitro `<a:name:ID>` emojis.', inline: false },
        { name: '`/adddefault <emoji>`', value: 'Add a single emoji to the default list.', inline: false },
        { name: '`/removedefault <emoji>`', value: 'Remove a single emoji from the default list.', inline: false },
        { name: '`/listdefault`', value: 'Show the current default emoji list.', inline: false },
        { name: '`/cleardefault`', value: 'Remove all default emojis.', inline: false },
        { name: '`/setuseremojis @user <emojis>`', value: 'Set unique emojis for when a **specific user** is pinged. Overrides defaults for that user.', inline: false },
        { name: '`/adduseremoji @user <emoji>`', value: 'Add one emoji for a specific user.', inline: false },
        { name: '`/removeuseremoji @user <emoji>`', value: 'Remove one emoji from a specific user.', inline: false },
        { name: '`/clearuseremojis @user`', value: 'Remove all custom emojis for a user — they fall back to the default list.', inline: false },
        { name: '`/listuseremojis`', value: 'See every user with custom emoji configs.', inline: false },
      );
  }

  if (category === 'mood') {
    return base.setTitle('🎭 Mood Reactions — Commands')
      .setDescription('Mood reactions detect keywords in messages and react with themed emojis.')
      .addFields(
        { name: '`/togglemood`', value: '**Ping mood** — When a user is pinged AND the message contains a mood keyword, the bot uses mood emojis instead of the normal ones.', inline: false },
        { name: '`/toggleautomood`', value: '**Auto mood** — Bot reacts to ANY message that contains a mood keyword, even if nobody is pinged. Great for active servers.', inline: false },
        { name: '`/listmoods`', value: 'Show all mood rules: keyword → emojis. Includes built-in rules and any you have added.', inline: false },
        { name: '`/addmood <keyword> <emojis>`', value: 'Add a new mood rule.\nExample: `/addmood keyword:nice one emojis:😍🔥`', inline: false },
        { name: '`/editmood <keyword> <emojis>`', value: 'Change the emojis for an existing mood rule.\nExample: `/editmood keyword:gg emojis:🥇👑`', inline: false },
        { name: '`/removemood <keyword>`', value: 'Delete a mood rule by its keyword.', inline: false },
        { name: '`/resetmoods`', value: 'Wipe all custom rules and restore the built-in defaults.', inline: false },
        { name: 'Built-in keywords', value: 'happy birthday, hbd, gg, well played, rip, welcome, congrats, good morning, gm, good night, gn, love you, ily, bruh, lets go, skill issue, ban, good luck, gl, sus, pog, based, cringe, w, l', inline: false },
      );
  }

  if (category === 'roles') {
    return base.setTitle('🎯 Reaction Roles — Commands')
      .setDescription('Give roles to users automatically when they react to a message.')
      .addFields(
        { name: '`/addreactionrole`', value: 'Set up a reaction role.\n**message_id** — Right-click a message → Copy Message ID\n**emoji** — The emoji users react with\n**role** — The role they receive\n**channel** — Where the message is (optional, defaults to current channel)', inline: false },
        { name: '`/listreactionroles`', value: 'Show all active reaction role setups with links.', inline: false },
        { name: '`/removereactionrole <number>`', value: 'Remove a reaction role by its number from `/listreactionroles`.', inline: false },
        { name: 'How to get a Message ID', value: '1. Enable Developer Mode in Discord settings\n2. Right-click any message\n3. Click "Copy Message ID"', inline: false },
      );
  }

  if (category === 'ghost') {
    return base.setTitle('👻 Ghost Ping Detector — Commands')
      .setDescription('Catches users who ping someone then delete or edit the message to hide it.')
      .addFields(
        { name: '`/toggleghostping`', value: 'Turn ghost ping detection on or off.', inline: false },
        { name: '`/setghostchannel <channel>`', value: 'Choose a channel for ghost ping alerts. If not set, the alert goes to the same channel as the deleted message.', inline: false },
        { name: 'What it detects', value: '**Deleted pings** — Someone pinged a user then deleted the message.\n**Edited pings** — Someone pinged a user then edited the message to remove the ping.', inline: false },
        { name: 'Alert includes', value: 'Who sent it, who was pinged, and the original message content.', inline: false },
      );
  }

  if (category === 'leaderboard') {
    return base.setTitle('📊 Ping Leaderboard — Commands')
      .setDescription('Tracks how many times each user has been pinged in the server.')
      .addFields(
        { name: '`/pingled`', value: 'Show the top 10 most-pinged users in the server.', inline: false },
        { name: '`/pingcount [@user]`', value: 'See how many times a user has been pinged. Defaults to yourself.', inline: false },
        { name: '`/setmilestonechannel <channel>`', value: `Set a channel for milestone announcements. Bot posts when a user hits ${MILESTONES.join(', ')} pings.`, inline: false },
        { name: '`/resetpingcount @user`', value: 'Reset the ping counter for a specific user to 0.', inline: false },
      );
  }

  if (category === 'shield') {
    return base.setTitle('🛡️ Anti-Ping Shield — Commands')
      .setDescription('Protect specific users. Anyone who pings a shielded user receives a warning.')
      .addFields(
        { name: '`/shield @user`', value: 'Add a user to the shield list. Bot will warn anyone who pings them.', inline: false },
        { name: '`/unshield @user`', value: 'Remove a user from the shield list.', inline: false },
        { name: '`/listshields`', value: 'Show all currently shielded users.', inline: false },
        { name: '`/setshieldchannel <channel>`', value: 'Choose a channel for shield alerts. If not set, the alert is sent in the same channel as the ping.', inline: false },
      );
  }

  if (category === 'settings') {
    return base.setTitle('⚙️ Settings & Cooldowns — Commands')
      .addFields(
        { name: '`/panel`', value: 'Full control panel showing all settings and their current status at a glance.', inline: false },
        { name: '`/settings`', value: 'Compact view of all current settings.', inline: false },
        { name: '`/ping`', value: 'Check the bot\'s latency.', inline: false },
        { name: '`/setcooldown @user <seconds>`', value: 'Set a cooldown for a user. Bot will only react to their pings once per cooldown period.\nExample: `/setcooldown @user seconds:60` = react at most once per minute.', inline: false },
        { name: '`/removecooldown @user`', value: 'Remove the cooldown for a user.', inline: false },
        { name: '`/listcooldowns`', value: 'Show all users who have a cooldown set.', inline: false },
      );
  }

  return base.setTitle('Help').setDescription('Unknown category. Use `/help` to see all categories.');
}

// ── Slash command handler ─────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, guild } = interaction;
  const cfg = guild ? getGuild(guild.id) : {};

  if (commandName === 'panel') {
    return interaction.reply({ embeds: [buildPanelEmbed(cfg)], ephemeral: true });
  }

  if (commandName === 'help') {
    const category = interaction.options.getString('category') || 'all';
    return interaction.reply({ embeds: [buildHelpEmbed(category)], ephemeral: true });
  }

  if (commandName === 'settings') {
    const g = cfg;
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Current Settings')
      .addFields(
        { name: 'Auto-reactions', value: g.reactionsEnabled ? 'ON' : 'OFF', inline: true },
        { name: 'Random Mode', value: g.randomMode ? 'ON' : 'OFF', inline: true },
        { name: 'Mood on Ping', value: g.moodReactionsEnabled ? 'ON' : 'OFF', inline: true },
        { name: 'Auto Mood', value: g.autoMoodEnabled ? 'ON' : 'OFF', inline: true },
        { name: 'Ghost Ping', value: g.ghostPingEnabled ? 'ON' : 'OFF', inline: true },
        { name: 'Default Emojis', value: g.defaultReactions.length ? g.defaultReactions.map(emojiDisplay).join(' ') : '*(none)*', inline: false },
        { name: 'Per-user configs', value: `${Object.keys(g.userReactions).length} users`, inline: true },
        { name: 'Mood Rules', value: `${g.moodRules.length} rules`, inline: true },
        { name: 'Reaction Roles', value: `${g.reactionRoles.length}`, inline: true },
        { name: 'Shielded Users', value: `${g.shieldedUsers.length}`, inline: true },
        { name: 'Cooldowns', value: `${Object.keys(g.pingCooldownSeconds).length} users`, inline: true },
      ).setFooter({ text: 'Use /panel for the full overview with commands.' }).setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'ping') {
    const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
    return interaction.editReply(`Pong! Latency: **${sent.createdTimestamp - interaction.createdTimestamp}ms** | API: **${Math.round(client.ws.ping)}ms**`);
  }

  if (commandName === 'togglereactions') {
    const updated = setGuild(guild.id, { reactionsEnabled: !cfg.reactionsEnabled });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(updated.reactionsEnabled ? 0x57F287 : 0xED4245).setDescription(`Auto-reactions are now **${updated.reactionsEnabled ? 'ON' : 'OFF'}**.`)], ephemeral: true });
  }

  if (commandName === 'togglerandom') {
    const updated = setGuild(guild.id, { randomMode: !cfg.randomMode });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(updated.randomMode ? 0x57F287 : 0xFEE75C)
      .setTitle(`Random Mode ${updated.randomMode ? 'ON' : 'OFF'}`)
      .setDescription(updated.randomMode ? 'Bot picks ONE random emoji from your list each ping.' : 'Bot reacts with ALL emojis from your list.')], ephemeral: true });
  }

  // Default reactions
  if (commandName === 'setdefault') {
    const emojis = parseManyEmojis(interaction.options.getString('emojis'));
    if (!emojis.length) return interaction.reply({ content: 'No valid emojis found.', ephemeral: true });
    setGuild(guild.id, { defaultReactions: emojis });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Default reactions set to: ${emojis.map(emojiDisplay).join(' ')}`)], ephemeral: true });
  }
  if (commandName === 'adddefault') {
    const emoji = parseOneEmoji(interaction.options.getString('emoji'));
    if (!emoji) return interaction.reply({ content: 'No valid emoji found.', ephemeral: true });
    const list = [...new Set([...cfg.defaultReactions, emoji])];
    setGuild(guild.id, { defaultReactions: list });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Added ${emojiDisplay(emoji)}. Current list: ${list.map(emojiDisplay).join(' ')}`)], ephemeral: true });
  }
  if (commandName === 'removedefault') {
    const emoji = parseOneEmoji(interaction.options.getString('emoji'));
    if (!emoji) return interaction.reply({ content: 'No valid emoji found.', ephemeral: true });
    const list = cfg.defaultReactions.filter(e => e !== emoji);
    setGuild(guild.id, { defaultReactions: list });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setDescription(`Removed ${emojiDisplay(emoji)}. Remaining: ${list.map(emojiDisplay).join(' ') || '*(none)*'}`)], ephemeral: true });
  }
  if (commandName === 'listdefault') {
    const list = cfg.defaultReactions.length ? cfg.defaultReactions.map((e, i) => `${i + 1}. ${emojiDisplay(e)}`).join('\n') : 'No default emojis set. Use `/adddefault` to add one.';
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Default Reaction Emojis').setDescription(list)], ephemeral: true });
  }
  if (commandName === 'cleardefault') {
    setGuild(guild.id, { defaultReactions: [] });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription('All default emojis cleared.')], ephemeral: true });
  }

  // Per-user reactions
  if (commandName === 'setuseremojis') {
    const user = interaction.options.getUser('user');
    const emojis = parseManyEmojis(interaction.options.getString('emojis'));
    if (!emojis.length) return interaction.reply({ content: 'No valid emojis found.', ephemeral: true });
    setGuild(guild.id, { userReactions: { ...cfg.userReactions, [user.id]: emojis } });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`When ${user} is pinged, bot reacts with: ${emojis.map(emojiDisplay).join(' ')}`)], ephemeral: true });
  }
  if (commandName === 'adduseremoji') {
    const user = interaction.options.getUser('user');
    const emoji = parseOneEmoji(interaction.options.getString('emoji'));
    if (!emoji) return interaction.reply({ content: 'No valid emoji found.', ephemeral: true });
    const list = [...new Set([...(cfg.userReactions[user.id] || []), emoji])];
    setGuild(guild.id, { userReactions: { ...cfg.userReactions, [user.id]: list } });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Added ${emojiDisplay(emoji)} for ${user}. Full list: ${list.map(emojiDisplay).join(' ')}`)], ephemeral: true });
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
    if (!entries.length) return interaction.reply({ content: 'No per-user configs. Use `/setuseremojis @user <emojis>` to add one.', ephemeral: true });
    const lines = entries.map(([id, emojis], i) => `${i + 1}. <@${id}> → ${emojis.map(emojiDisplay).join(' ')}`).join('\n');
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Per-User Emoji Configs').setDescription(lines).setFooter({ text: 'Users not listed fall back to default emojis.' })], ephemeral: true });
  }

  // Mood
  if (commandName === 'togglemood') {
    const updated = setGuild(guild.id, { moodReactionsEnabled: !cfg.moodReactionsEnabled });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(updated.moodReactionsEnabled ? 0x57F287 : 0xFEE75C)
      .setTitle(`Mood Reactions (on ping) — ${updated.moodReactionsEnabled ? 'ON' : 'OFF'}`)
      .setDescription(updated.moodReactionsEnabled
        ? 'When someone is pinged and the message has a mood keyword, bot uses mood emojis. Use `/listmoods` to see all keywords.'
        : 'Mood reactions disabled. Bot uses your configured emojis.')], ephemeral: true });
  }
  if (commandName === 'toggleautomood') {
    const updated = setGuild(guild.id, { autoMoodEnabled: !cfg.autoMoodEnabled });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(updated.autoMoodEnabled ? 0x57F287 : 0xFEE75C)
      .setTitle(`Auto Mood — ${updated.autoMoodEnabled ? 'ON' : 'OFF'}`)
      .setDescription(updated.autoMoodEnabled
        ? 'Bot will now react to ANY message that contains a mood keyword — no ping needed.'
        : 'Auto mood off. Bot only uses mood reactions when someone is pinged.')], ephemeral: true });
  }
  if (commandName === 'listmoods') {
    const rules = cfg.moodRules;
    const lines = rules.map((r, i) => `${i + 1}. \`${r.keyword}\` → ${r.emojis.join(' ')}`).join('\n');
    const chunks = [];
    let current = '';
    for (const line of lines.split('\n')) {
      if ((current + '\n' + line).length > 1000) { chunks.push(current); current = line; }
      else current = current ? current + '\n' + line : line;
    }
    if (current) chunks.push(current);
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`Mood Rules (${rules.length})`)
      .setDescription(chunks[0] || 'No rules.')
      .setFooter({ text: 'Use /addmood to add custom rules, /editmood to change emojis, /removemood to delete.' });
    if (chunks[1]) embed.addFields({ name: '(continued)', value: chunks[1] });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
  if (commandName === 'addmood') {
    const keyword = interaction.options.getString('keyword').toLowerCase().trim();
    const emojis = parseManyEmojis(interaction.options.getString('emojis'));
    if (!emojis.length) return interaction.reply({ content: 'No valid emojis found.', ephemeral: true });
    if (cfg.moodRules.find(r => r.keyword === keyword)) return interaction.reply({ content: `A rule for \`${keyword}\` already exists. Use \`/editmood\` to change it.`, ephemeral: true });
    cfg.moodRules.push({ keyword, emojis });
    setGuild(guild.id, { moodRules: cfg.moodRules });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Added mood rule: \`${keyword}\` → ${emojis.join(' ')}\n\nNow when a message contains "${keyword}", bot reacts with those emojis.`)], ephemeral: true });
  }
  if (commandName === 'editmood') {
    const keyword = interaction.options.getString('keyword').toLowerCase().trim();
    const emojis = parseManyEmojis(interaction.options.getString('emojis'));
    if (!emojis.length) return interaction.reply({ content: 'No valid emojis found.', ephemeral: true });
    const idx = cfg.moodRules.findIndex(r => r.keyword === keyword);
    if (idx === -1) return interaction.reply({ content: `No rule found for \`${keyword}\`. Use \`/listmoods\` to see all rules.`, ephemeral: true });
    cfg.moodRules[idx].emojis = emojis;
    setGuild(guild.id, { moodRules: cfg.moodRules });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Updated \`${keyword}\` → ${emojis.join(' ')}`)], ephemeral: true });
  }
  if (commandName === 'removemood') {
    const keyword = interaction.options.getString('keyword').toLowerCase().trim();
    const before = cfg.moodRules.length;
    cfg.moodRules = cfg.moodRules.filter(r => r.keyword !== keyword);
    if (cfg.moodRules.length === before) return interaction.reply({ content: `No rule found for \`${keyword}\`. Use \`/listmoods\` to see all rules.`, ephemeral: true });
    setGuild(guild.id, { moodRules: cfg.moodRules });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription(`Removed mood rule for \`${keyword}\`.`)], ephemeral: true });
  }
  if (commandName === 'resetmoods') {
    setGuild(guild.id, { moodRules: JSON.parse(JSON.stringify(DEFAULT_MOODS)) });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Mood rules reset to **${DEFAULT_MOODS.length}** built-in defaults.`)], ephemeral: true });
  }

  // Reaction roles
  if (commandName === 'addreactionrole') {
    const messageId = interaction.options.getString('message_id');
    const emoji = parseOneEmoji(interaction.options.getString('emoji'));
    const role = interaction.options.getRole('role');
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (!emoji) return interaction.reply({ content: 'No valid emoji found.', ephemeral: true });
    let targetMessage;
    try { targetMessage = await channel.messages.fetch(messageId); } catch { return interaction.reply({ content: `Could not find that message in ${channel}. Check the message ID.`, ephemeral: true }); }
    if (cfg.reactionRoles.find(r => r.messageId === messageId && r.emoji === emoji && r.roleId === role.id)) return interaction.reply({ content: 'That reaction role already exists.', ephemeral: true });
    cfg.reactionRoles.push({ messageId, channelId: channel.id, emoji, roleId: role.id });
    setGuild(guild.id, { reactionRoles: cfg.reactionRoles });
    await targetMessage.react(emoji).catch(() => {});
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('Reaction Role Added')
      .setDescription(`[Jump to message](https://discord.com/channels/${guild.id}/${channel.id}/${messageId})\nEmoji: ${emojiDisplay(emoji)} → Role: ${role}`)
      .setFooter({ text: 'Bot reacted to the message. Users can now react to get the role.' })], ephemeral: true });
  }
  if (commandName === 'listreactionroles') {
    if (!cfg.reactionRoles.length) return interaction.reply({ content: 'No reaction roles set up. Use `/addreactionrole` to create one.', ephemeral: true });
    const lines = cfg.reactionRoles.map((r, i) => `**${i + 1}.** ${emojiDisplay(r.emoji)} → <@&${r.roleId}>\n   [message](https://discord.com/channels/${guild.id}/${r.channelId}/${r.messageId})`).join('\n\n');
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Reaction Roles').setDescription(lines)], ephemeral: true });
  }
  if (commandName === 'removereactionrole') {
    const num = interaction.options.getInteger('number');
    if (num > cfg.reactionRoles.length) return interaction.reply({ content: `No reaction role #${num}.`, ephemeral: true });
    const removed = cfg.reactionRoles.splice(num - 1, 1)[0];
    setGuild(guild.id, { reactionRoles: cfg.reactionRoles });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription(`Removed #${num}: ${emojiDisplay(removed.emoji)} → <@&${removed.roleId}>`)], ephemeral: true });
  }

  // Ghost ping
  if (commandName === 'toggleghostping') {
    const updated = setGuild(guild.id, { ghostPingEnabled: !cfg.ghostPingEnabled });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(updated.ghostPingEnabled ? 0x57F287 : 0xFEE75C)
      .setTitle(`Ghost Ping Detector — ${updated.ghostPingEnabled ? 'ON' : 'OFF'}`)
      .setDescription(updated.ghostPingEnabled ? 'Bot will now alert when someone deletes or edits a ping.' : 'Ghost ping detection disabled.')], ephemeral: true });
  }
  if (commandName === 'setghostchannel') {
    const channel = interaction.options.getChannel('channel');
    setGuild(guild.id, { ghostPingChannelId: channel.id });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Ghost ping alerts → ${channel}`)], ephemeral: true });
  }

  // Leaderboard
  if (commandName === 'pingled') {
    const counts = Object.entries(cfg.pingCounts).sort(([, a], [, b]) => b - a).slice(0, 10);
    if (!counts.length) return interaction.reply({ content: 'No pings tracked yet.', ephemeral: false });
    const medals = ['🥇', '🥈', '🥉'];
    const lines = counts.map(([id, count], i) => `${medals[i] || `**${i + 1}.**`} <@${id}> — **${count}** pings`).join('\n');
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFFD700).setTitle('📊 Ping Leaderboard').setDescription(lines).setTimestamp()] });
  }
  if (commandName === 'pingcount') {
    const user = interaction.options.getUser('user') || interaction.user;
    const count = cfg.pingCounts[user.id] || 0;
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setDescription(`${user} has been pinged **${count} times** in this server.`)] });
  }
  if (commandName === 'setmilestonechannel') {
    const channel = interaction.options.getChannel('channel');
    setGuild(guild.id, { pingMilestoneChannelId: channel.id });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Milestone announcements → ${channel}\nFires at: ${MILESTONES.join(', ')} pings.`)], ephemeral: true });
  }
  if (commandName === 'resetpingcount') {
    const user = interaction.options.getUser('user');
    cfg.pingCounts[user.id] = 0;
    setGuild(guild.id, { pingCounts: cfg.pingCounts });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription(`Ping count for ${user} reset to 0.`)], ephemeral: true });
  }

  // Cooldowns
  if (commandName === 'setcooldown') {
    const user = interaction.options.getUser('user');
    const seconds = interaction.options.getInteger('seconds');
    cfg.pingCooldownSeconds[user.id] = seconds;
    setGuild(guild.id, { pingCooldownSeconds: cfg.pingCooldownSeconds });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Cooldown for ${user}: **${seconds}s**. Bot reacts to their pings at most once every ${seconds}s.`)], ephemeral: true });
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
    const lines = entries.map(([id, sec], i) => `${i + 1}. <@${id}> — every **${sec}s**`).join('\n');
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Ping Cooldowns').setDescription(lines)], ephemeral: true });
  }

  // Shield
  if (commandName === 'shield') {
    const user = interaction.options.getUser('user');
    const list = new Set(cfg.shieldedUsers);
    list.add(user.id);
    setGuild(guild.id, { shieldedUsers: [...list] });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('User Shielded').setDescription(`${user} is protected. Bot will warn anyone who pings them.`)], ephemeral: true });
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
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Shield alerts → ${channel}`)], ephemeral: true });
  }
});

// ── Auto-react on ping ────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const cfg = getGuild(message.guild.id);
  if (!cfg.reactionsEnabled) return;

  const mentionedIds = [...message.mentions.users.keys()];
  const hasRolePing = message.mentions.roles.size > 0 || message.mentions.everyone;

  // Auto mood — reacts to any message with a mood keyword (no ping needed)
  if (cfg.autoMoodEnabled) {
    const mood = getMoodEmojis(cfg.moodRules, message.content);
    if (mood) {
      for (const emoji of mood) await message.react(emoji).catch(() => {});
      return;
    }
  }

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
      const alertCh = cfg.shieldAlertChannelId ? message.guild.channels.cache.get(cfg.shieldAlertChannelId) : message.channel;
      if (alertCh) await alertCh.send({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('🛡️ Shield Alert').setDescription(`${message.author} — <@${userId}> is a protected user.`).setTimestamp()] }).catch(() => {});
    }
  }

  if (!mentionedIds.length && hasRolePing && cfg.defaultReactions.length) {
    const emojis = cfg.randomMode ? [cfg.defaultReactions[Math.floor(Math.random() * cfg.defaultReactions.length)]] : cfg.defaultReactions;
    for (const emoji of emojis) await message.react(emoji).catch(() => {});
  }
});

// ── Ghost ping: deleted ───────────────────────────────────────────────────────
client.on('messageDelete', async (message) => {
  if (!message.guild || message.author?.bot) return;
  const cfg = getGuild(message.guild.id);
  if (!cfg.ghostPingEnabled) return;
  const hasPing = message.mentions?.users?.size > 0 || message.mentions?.roles?.size > 0;
  if (!hasPing) return;
  const alertCh = cfg.ghostPingChannelId ? message.guild.channels.cache.get(cfg.ghostPingChannelId) : message.channel;
  if (!alertCh) return;
  const pinged = message.mentions.users.map(u => `${u}`).join(', ') || 'a role';
  await alertCh.send({ embeds: [new EmbedBuilder().setColor(0xFF6B6B).setTitle('👻 Ghost Ping Detected')
    .setDescription(`**${message.author?.tag || 'Someone'}** deleted a message that pinged ${pinged}.`)
    .addFields({ name: 'Original Message', value: message.content ? `"${message.content.slice(0, 300)}"` : '*(no content)*' })
    .setTimestamp()] }).catch(() => {});
});

// ── Ghost ping: edited ────────────────────────────────────────────────────────
client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!oldMessage.guild || oldMessage.author?.bot) return;
  const cfg = getGuild(oldMessage.guild.id);
  if (!cfg.ghostPingEnabled) return;
  const hadPing = oldMessage.mentions?.users?.size > 0 || oldMessage.mentions?.roles?.size > 0;
  const hasPing = newMessage.mentions?.users?.size > 0 || newMessage.mentions?.roles?.size > 0;
  if (!hadPing || hasPing) return;
  const alertCh = cfg.ghostPingChannelId ? oldMessage.guild.channels.cache.get(cfg.ghostPingChannelId) : oldMessage.channel;
  if (!alertCh) return;
  const pinged = oldMessage.mentions.users.map(u => `${u}`).join(', ') || 'a role';
  await alertCh.send({ embeds: [new EmbedBuilder().setColor(0xFF6B6B).setTitle('👻 Ghost Ping (Edited)')
    .setDescription(`**${oldMessage.author?.tag}** edited a message to remove a ping to ${pinged}.`)
    .addFields(
      { name: 'Before', value: oldMessage.content ? `"${oldMessage.content.slice(0, 200)}"` : '*(unknown)*' },
      { name: 'After', value: newMessage.content ? `"${newMessage.content.slice(0, 200)}"` : '*(empty)*' },
    ).setTimestamp()] }).catch(() => {});
});

// ── Reaction roles ────────────────────────────────────────────────────────────
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
