require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

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
];

// ── Persistence ───────────────────────────────────────────────────────────────
function load() {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; }
}
function save(data) { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2)); }
function getGuild(guildId) {
  const all = load();
  if (!all[guildId]) all[guildId] = {};
  const g = all[guildId];
  const defaults = {
    on: true,
    random: false,
    defaultEmojis: [],
    userEmojis: {},
    roleEmojis: {},
    reactionRoles: [],
    mood: false,
    automood: false,
    moods: JSON.parse(JSON.stringify(DEFAULT_MOODS)),
    ghost: false,
    ghostLog: null,
    pingCounts: {},
    milestoneLog: null,
    cooldowns: {},
    lastPing: {},
    shields: [],
    shieldLog: null,
    blocked: [],
    hoursStart: null,
    hoursEnd: null,
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (g[k] === undefined) g[k] = typeof v === 'object' && v !== null ? JSON.parse(JSON.stringify(v)) : v;
  }
  all[guildId] = g;
  save(all);
  return g;
}
function setGuild(guildId, data) {
  const all = load();
  all[guildId] = { ...getGuild(guildId), ...data };
  save(all);
  return all[guildId];
}

// ── Emoji helpers ─────────────────────────────────────────────────────────────
function one(raw) {
  const c = raw.match(/<a?:(\w+):(\d+)>/);
  if (c) return c[2];
  const u = raw.match(/\p{Emoji_Presentation}|\p{Emoji}\uFE0F/u);
  return u ? u[0] : null;
}
function many(raw) {
  const r = [];
  const re = /<a?:\w+:(\d+)>/g;
  let m;
  while ((m = re.exec(raw)) !== null) r.push(m[1]);
  const u = raw.replace(/<a?:\w+:\d+>/g, '').match(/\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu);
  if (u) r.push(...u);
  return [...new Set(r)];
}
function disp(e) { return isNaN(e) ? e : `<:_:${e}>`; }
function ekey(emoji) { return emoji.id || emoji.name; }

// ── Mood ──────────────────────────────────────────────────────────────────────
function moodMatch(moods, content) {
  const lower = content.toLowerCase();
  for (const r of moods) {
    if (lower.includes(r.keyword.toLowerCase())) return r.emojis;
  }
  return null;
}

// ── Hours check ───────────────────────────────────────────────────────────────
function inHours(cfg) {
  if (cfg.hoursStart === null || cfg.hoursEnd === null) return true;
  const hour = new Date().getUTCHours();
  if (cfg.hoursStart <= cfg.hoursEnd) return hour >= cfg.hoursStart && hour < cfg.hoursEnd;
  return hour >= cfg.hoursStart || hour < cfg.hoursEnd;
}

// ── Pick emojis ───────────────────────────────────────────────────────────────
function pickEmojis(cfg, userId, memberRoles, content) {
  if (cfg.mood) {
    const mood = moodMatch(cfg.moods, content);
    if (mood) return mood;
  }
  if (cfg.userEmojis[userId]?.length) {
    return cfg.random
      ? [cfg.userEmojis[userId][Math.floor(Math.random() * cfg.userEmojis[userId].length)]]
      : cfg.userEmojis[userId];
  }
  if (memberRoles) {
    for (const roleId of memberRoles) {
      if (cfg.roleEmojis[roleId]?.length) {
        return cfg.random
          ? [cfg.roleEmojis[roleId][Math.floor(Math.random() * cfg.roleEmojis[roleId].length)]]
          : cfg.roleEmojis[roleId];
      }
    }
  }
  if (!cfg.defaultEmojis.length) return [];
  return cfg.random
    ? [cfg.defaultEmojis[Math.floor(Math.random() * cfg.defaultEmojis.length)]]
    : cfg.defaultEmojis;
}

// ── Cooldown ──────────────────────────────────────────────────────────────────
function canReact(cfg, userId) {
  const cd = cfg.cooldowns[userId];
  if (!cd) return true;
  return (Date.now() - (cfg.lastPing[userId] || 0)) / 1000 >= cd;
}
function stampCooldown(cfg, guildId, userId) {
  cfg.lastPing[userId] = Date.now();
  setGuild(guildId, { lastPing: cfg.lastPing });
}

// ── Milestones ────────────────────────────────────────────────────────────────
const MILESTONES = [10, 25, 50, 100, 250, 500, 1000];
async function trackPing(cfg, guildId, guild, userId) {
  cfg.pingCounts[userId] = (cfg.pingCounts[userId] || 0) + 1;
  const n = cfg.pingCounts[userId];
  setGuild(guildId, { pingCounts: cfg.pingCounts });
  if (cfg.milestoneLog && MILESTONES.includes(n)) {
    const ch = guild.channels.cache.get(cfg.milestoneLog);
    if (ch) await ch.send({ embeds: [new EmbedBuilder().setColor(0xFFD700).setTitle('🏅 Ping Milestone!').setDescription(`<@${userId}> has been pinged **${n} times**!`).setTimestamp()] }).catch(() => {});
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

const A = PermissionFlagsBits.ManageGuild;
const commands = [
  // ── Core ─────────────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('panel').setDescription('Open the control panel').setDefaultMemberPermissions(A),
  new SlashCommandBuilder().setName('settings').setDescription('View current settings').setDefaultMemberPermissions(A),
  new SlashCommandBuilder().setName('help').setDescription('Browse commands by category')
    .addStringOption(o => o.setName('category').setDescription('Category').setChoices(
      { name: 'All', value: 'all' }, { name: 'Reactions', value: 'reactions' },
      { name: 'Mood', value: 'mood' }, { name: 'Reaction Roles', value: 'rr' },
      { name: 'Ghost Ping', value: 'ghost' }, { name: 'Leaderboard', value: 'lb' },
      { name: 'Shield & Block', value: 'shield' }, { name: 'Other', value: 'other' },
    )),
  new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),

  // ── Reaction toggles ──────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('on').setDescription('Turn auto-reactions ON').setDefaultMemberPermissions(A),
  new SlashCommandBuilder().setName('off').setDescription('Turn auto-reactions OFF').setDefaultMemberPermissions(A),
  new SlashCommandBuilder().setName('random').setDescription('Toggle random mode — reacts with ONE random emoji instead of all').setDefaultMemberPermissions(A),

  // ── Default emojis ────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('set').setDescription('Set all default reaction emojis at once').setDefaultMemberPermissions(A)
    .addStringOption(o => o.setName('emojis').setDescription('Paste emojis separated by spaces').setRequired(true)),
  new SlashCommandBuilder().setName('add').setDescription('Add one emoji to the default list').setDefaultMemberPermissions(A)
    .addStringOption(o => o.setName('emoji').setDescription('Emoji to add').setRequired(true)),
  new SlashCommandBuilder().setName('del').setDescription('Remove one emoji from the default list').setDefaultMemberPermissions(A)
    .addStringOption(o => o.setName('emoji').setDescription('Emoji to remove').setRequired(true)),
  new SlashCommandBuilder().setName('emojis').setDescription('Show the default emoji list').setDefaultMemberPermissions(A),
  new SlashCommandBuilder().setName('clearemojis').setDescription('Clear all default emojis').setDefaultMemberPermissions(A),

  // ── Per-user emojis ───────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('setuser').setDescription('Set custom emojis for when a specific user is pinged').setDefaultMemberPermissions(A)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('emojis').setDescription('Emojis').setRequired(true)),
  new SlashCommandBuilder().setName('adduser').setDescription('Add one emoji for a specific user').setDefaultMemberPermissions(A)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('emoji').setDescription('Emoji').setRequired(true)),
  new SlashCommandBuilder().setName('deluser').setDescription('Remove one emoji from a specific user').setDefaultMemberPermissions(A)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('emoji').setDescription('Emoji').setRequired(true)),
  new SlashCommandBuilder().setName('clearuser').setDescription('Clear custom emojis for a user').setDefaultMemberPermissions(A)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('users').setDescription('Show all per-user emoji configs').setDefaultMemberPermissions(A),

  // ── Role emojis (NEW) ─────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('setrole').setDescription('Set custom emojis when any member of a role is pinged').setDefaultMemberPermissions(A)
    .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true))
    .addStringOption(o => o.setName('emojis').setDescription('Emojis').setRequired(true)),
  new SlashCommandBuilder().setName('delrole').setDescription('Remove custom emojis for a role').setDefaultMemberPermissions(A)
    .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)),
  new SlashCommandBuilder().setName('roles').setDescription('Show all role emoji configs').setDefaultMemberPermissions(A),

  // ── Mood ──────────────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('mood').setDescription('Toggle mood reactions on ping (reacts based on message keywords)').setDefaultMemberPermissions(A),
  new SlashCommandBuilder().setName('automood').setDescription('Toggle auto mood — reacts to any message with mood keywords (no ping needed)').setDefaultMemberPermissions(A),
  new SlashCommandBuilder().setName('moods').setDescription('Show all mood rules'),
  new SlashCommandBuilder().setName('moodadd').setDescription('Add a custom mood rule').setDefaultMemberPermissions(A)
    .addStringOption(o => o.setName('keyword').setDescription('Word or phrase that triggers this mood').setRequired(true))
    .addStringOption(o => o.setName('emojis').setDescription('Emojis to react with').setRequired(true)),
  new SlashCommandBuilder().setName('moodedit').setDescription('Edit emojis for an existing mood rule').setDefaultMemberPermissions(A)
    .addStringOption(o => o.setName('keyword').setDescription('Keyword of the rule to edit').setRequired(true))
    .addStringOption(o => o.setName('emojis').setDescription('New emojis').setRequired(true)),
  new SlashCommandBuilder().setName('mooddel').setDescription('Remove a mood rule').setDefaultMemberPermissions(A)
    .addStringOption(o => o.setName('keyword').setDescription('Keyword to remove').setRequired(true)),
  new SlashCommandBuilder().setName('moodreset').setDescription('Reset mood rules to built-in defaults').setDefaultMemberPermissions(A),

  // ── Reaction roles ────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('rradd').setDescription('Add a reaction role to a message').setDefaultMemberPermissions(A)
    .addStringOption(o => o.setName('message_id').setDescription('Message ID').setRequired(true))
    .addStringOption(o => o.setName('emoji').setDescription('Emoji').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Role to give').setRequired(true))
    .addChannelOption(o => o.setName('channel').setDescription('Channel (defaults to current)')),
  new SlashCommandBuilder().setName('rrlist').setDescription('List all reaction roles').setDefaultMemberPermissions(A),
  new SlashCommandBuilder().setName('rrdel').setDescription('Remove a reaction role by number').setDefaultMemberPermissions(A)
    .addIntegerOption(o => o.setName('number').setDescription('Number from /rrlist').setRequired(true).setMinValue(1)),

  // ── Ghost ping ────────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('ghost').setDescription('Toggle ghost ping detector').setDefaultMemberPermissions(A),
  new SlashCommandBuilder().setName('ghostlog').setDescription('Set channel for ghost ping alerts').setDefaultMemberPermissions(A)
    .addChannelOption(o => o.setName('channel').setDescription('Alert channel').setRequired(true)),

  // ── Leaderboard ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('top').setDescription('Show the ping leaderboard'),
  new SlashCommandBuilder().setName('count').setDescription('See how many times a user has been pinged')
    .addUserOption(o => o.setName('user').setDescription('User (defaults to you)')),
  new SlashCommandBuilder().setName('milestone').setDescription('Set channel for ping milestone announcements').setDefaultMemberPermissions(A)
    .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)),
  new SlashCommandBuilder().setName('resetcount').setDescription('Reset ping count for a user').setDefaultMemberPermissions(A)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  // ── Cooldown ──────────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('cooldown').setDescription('Set a reaction cooldown for a user in seconds').setDefaultMemberPermissions(A)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(o => o.setName('seconds').setDescription('Cooldown seconds').setRequired(true).setMinValue(5)),
  new SlashCommandBuilder().setName('nocooldown').setDescription('Remove cooldown for a user').setDefaultMemberPermissions(A)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('cooldowns').setDescription('List all active cooldowns').setDefaultMemberPermissions(A),

  // ── Shield ────────────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('shield').setDescription('Protect a user — warns anyone who pings them').setDefaultMemberPermissions(A)
    .addUserOption(o => o.setName('user').setDescription('User to protect').setRequired(true)),
  new SlashCommandBuilder().setName('unshield').setDescription('Remove shield from a user').setDefaultMemberPermissions(A)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('shields').setDescription('List all shielded users').setDefaultMemberPermissions(A),
  new SlashCommandBuilder().setName('shieldlog').setDescription('Set channel for shield alerts').setDefaultMemberPermissions(A)
    .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)),

  // ── Block (NEW) ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('block').setDescription('Block a user — bot ignores pings sent by them').setDefaultMemberPermissions(A)
    .addUserOption(o => o.setName('user').setDescription('User to block').setRequired(true)),
  new SlashCommandBuilder().setName('unblock').setDescription('Unblock a user').setDefaultMemberPermissions(A)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('blocked').setDescription('List all blocked users').setDefaultMemberPermissions(A),

  // ── Hours (NEW) ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('hours').setDescription('Only auto-react during certain hours (UTC)').setDefaultMemberPermissions(A)
    .addIntegerOption(o => o.setName('start').setDescription('Start hour in UTC (0-23)').setRequired(true).setMinValue(0).setMaxValue(23))
    .addIntegerOption(o => o.setName('end').setDescription('End hour in UTC (0-23)').setRequired(true).setMinValue(0).setMaxValue(23)),
  new SlashCommandBuilder().setName('nohours').setDescription('Remove time restriction — react 24/7').setDefaultMemberPermissions(A),

  // ── Rain (NEW) ────────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('rain').setDescription('React to the last N messages with an emoji').setDefaultMemberPermissions(A)
    .addStringOption(o => o.setName('emoji').setDescription('Emoji to react with').setRequired(true))
    .addIntegerOption(o => o.setName('count').setDescription('Number of messages (1-20)').setRequired(true).setMinValue(1).setMaxValue(20)),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('Commands registered');
  } catch (e) { console.error('Register failed:', e.message); }
}

client.once('ready', async () => {
  console.log(`CEAS REACTION online as ${client.user.tag}`);
  client.user.setActivity('BENDUK SENA OP', { type: 3 });
  await registerCommands();
});

// ── Panel ─────────────────────────────────────────────────────────────────────
function panelEmbed(cfg) {
  const s = (v) => v ? '`ON`' : '`OFF`';
  const hoursStr = cfg.hoursStart !== null ? `${cfg.hoursStart}:00–${cfg.hoursEnd}:00 UTC` : 'Always (24/7)';
  return new EmbedBuilder().setColor(0x5865F2).setTitle('⚙️ CEAS REACTION — Control Panel')
    .addFields(
      { name: '─── 🔔 Reactions', value: `Auto-react: ${s(cfg.on)} | Random: ${s(cfg.random)} | Hours: ${hoursStr}\nDefault emojis: ${cfg.defaultEmojis.length ? cfg.defaultEmojis.map(disp).join(' ') : '*(none)*'}\nPer-user: **${Object.keys(cfg.userEmojis).length}** | Per-role: **${Object.keys(cfg.roleEmojis).length}**\n\`/on\` \`/off\` \`/random\` \`/set\` \`/add\` \`/del\` \`/emojis\` \`/clearemojis\`\n\`/setuser\` \`/adduser\` \`/deluser\` \`/clearuser\` \`/users\`\n\`/setrole\` \`/delrole\` \`/roles\`\n\`/hours\` \`/nohours\``, inline: false },
      { name: '─── 🎭 Mood', value: `Mood on ping: ${s(cfg.mood)} | Auto mood: ${s(cfg.automood)} | Rules: **${cfg.moods.length}**\n\`/mood\` \`/automood\` \`/moods\` \`/moodadd\` \`/moodedit\` \`/mooddel\` \`/moodreset\``, inline: false },
      { name: '─── 🎯 Reaction Roles', value: `Active: **${cfg.reactionRoles.length}**\n\`/rradd\` \`/rrlist\` \`/rrdel\``, inline: false },
      { name: '─── 👻 Ghost Ping', value: `Status: ${s(cfg.ghost)} | Log: ${cfg.ghostLog ? `<#${cfg.ghostLog}>` : '*(same channel)*'}\n\`/ghost\` \`/ghostlog\``, inline: false },
      { name: '─── 📊 Leaderboard', value: `Milestone log: ${cfg.milestoneLog ? `<#${cfg.milestoneLog}>` : '*(not set)*'}\n\`/top\` \`/count\` \`/resetcount\` \`/milestone\``, inline: false },
      { name: '─── ⏱️ Cooldown', value: `Active: **${Object.keys(cfg.cooldowns).length}** users\n\`/cooldown\` \`/nocooldown\` \`/cooldowns\``, inline: false },
      { name: '─── 🛡️ Shield & Block', value: `Shielded: **${cfg.shields.length}** | Blocked: **${cfg.blocked.length}** | Shield log: ${cfg.shieldLog ? `<#${cfg.shieldLog}>` : '*(same channel)*'}\n\`/shield\` \`/unshield\` \`/shields\` \`/shieldlog\`\n\`/block\` \`/unblock\` \`/blocked\``, inline: false },
      { name: '─── 🌧️ Rain', value: 'React to the last N messages with any emoji\n`/rain`', inline: false },
    )
    .setFooter({ text: 'Use /help <category> for detailed command info.' }).setTimestamp();
}

// ── Help ──────────────────────────────────────────────────────────────────────
function helpEmbed(cat) {
  const e = new EmbedBuilder().setColor(0x5865F2).setTimestamp();
  if (!cat || cat === 'all') return e.setTitle('📖 CEAS REACTION — Help')
    .setDescription('Use `/help category:<name>` for details on each section.')
    .addFields(
      { name: '🔔 Reactions', value: '`/help reactions`', inline: true },
      { name: '🎭 Mood', value: '`/help mood`', inline: true },
      { name: '🎯 Reaction Roles', value: '`/help rr`', inline: true },
      { name: '👻 Ghost Ping', value: '`/help ghost`', inline: true },
      { name: '📊 Leaderboard', value: '`/help lb`', inline: true },
      { name: '🛡️ Shield & Block', value: '`/help shield`', inline: true },
      { name: '⚙️ Other', value: '`/help other`', inline: true },
    );
  if (cat === 'reactions') return e.setTitle('🔔 Reactions').addFields(
    { name: '`/on` / `/off`', value: 'Turn all auto-reactions on or off.' },
    { name: '`/random`', value: 'Toggle random mode — picks ONE emoji per ping.' },
    { name: '`/set <emojis>`', value: 'Replace ALL default emojis. Paste any mix of standard/custom/Nitro emojis.' },
    { name: '`/add <emoji>`', value: 'Add one emoji to the default list.' },
    { name: '`/del <emoji>`', value: 'Remove one emoji from the default list.' },
    { name: '`/emojis`', value: 'Show the current default emoji list.' },
    { name: '`/clearemojis`', value: 'Remove all default emojis.' },
    { name: '`/setuser @user <emojis>`', value: 'Set unique emojis for a specific user when pinged. Overrides defaults.' },
    { name: '`/adduser @user <emoji>`', value: 'Add one emoji for a user.' },
    { name: '`/deluser @user <emoji>`', value: 'Remove one emoji from a user.' },
    { name: '`/clearuser @user`', value: 'Clear all custom emojis for a user (falls back to defaults).' },
    { name: '`/users`', value: 'Show all per-user emoji configs.' },
    { name: '`/setrole @role <emojis>`', value: 'Set emojis when any member of a role is pinged.' },
    { name: '`/delrole @role`', value: 'Remove role emoji config.' },
    { name: '`/roles`', value: 'Show all role emoji configs.' },
    { name: '`/hours <start> <end>`', value: 'Only auto-react between these hours (UTC). e.g. `/hours start:9 end:17` = 9am–5pm UTC.' },
    { name: '`/nohours`', value: 'Remove the time restriction — react 24/7.' },
    { name: '`/rain <emoji> <count>`', value: 'React to the last N messages (up to 20) with an emoji all at once.' },
  );
  if (cat === 'mood') return e.setTitle('🎭 Mood').addFields(
    { name: '`/mood`', value: 'When someone is **pinged** AND the message contains a keyword → use mood emojis.' },
    { name: '`/automood`', value: 'React to **any message** with a mood keyword — no ping needed.' },
    { name: '`/moods`', value: 'List all mood rules.' },
    { name: '`/moodadd <keyword> <emojis>`', value: 'Add a new mood rule. Example: `/moodadd keyword:nice one emojis:😍🔥`' },
    { name: '`/moodedit <keyword> <emojis>`', value: 'Change the emojis for an existing rule. Works with custom/Nitro emojis.' },
    { name: '`/mooddel <keyword>`', value: 'Delete a mood rule.' },
    { name: '`/moodreset`', value: 'Wipe all custom rules and restore built-in defaults.' },
  );
  if (cat === 'rr') return e.setTitle('🎯 Reaction Roles').addFields(
    { name: '`/rradd`', value: 'Set up a reaction role.\n**message_id** — Right-click message → Copy Message ID (needs Developer Mode)\n**emoji** — Emoji users react with\n**role** — Role they receive\n**channel** — Where the message is (optional)' },
    { name: '`/rrlist`', value: 'Show all reaction role setups.' },
    { name: '`/rrdel <number>`', value: 'Remove a reaction role by its number from `/rrlist`.' },
  );
  if (cat === 'ghost') return e.setTitle('👻 Ghost Ping').addFields(
    { name: '`/ghost`', value: 'Toggle ghost ping detection on/off.' },
    { name: '`/ghostlog <channel>`', value: 'Set which channel receives ghost ping alerts.' },
    { name: 'What it catches', value: '**Deleted** — Someone pinged then deleted the message.\n**Edited** — Someone pinged then edited out the ping.' },
  );
  if (cat === 'lb') return e.setTitle('📊 Leaderboard').addFields(
    { name: '`/top`', value: 'Top 10 most-pinged users in the server.' },
    { name: '`/count [@user]`', value: 'See how many times a user has been pinged.' },
    { name: '`/milestone <channel>`', value: `Announce when users hit ping milestones: ${MILESTONES.join(', ')}.` },
    { name: '`/resetcount @user`', value: 'Reset ping count for a user.' },
  );
  if (cat === 'shield') return e.setTitle('🛡️ Shield & Block').addFields(
    { name: '`/shield @user`', value: 'Protect a user — bot warns anyone who pings them.' },
    { name: '`/unshield @user`', value: 'Remove shield.' },
    { name: '`/shields`', value: 'List all shielded users.' },
    { name: '`/shieldlog <channel>`', value: 'Set channel for shield alerts.' },
    { name: '`/block @user`', value: 'Block a user — bot will NOT react to ANY ping sent by them.' },
    { name: '`/unblock @user`', value: 'Unblock a user.' },
    { name: '`/blocked`', value: 'List all blocked users.' },
  );
  if (cat === 'other') return e.setTitle('⚙️ Other').addFields(
    { name: '`/cooldown @user <seconds>`', value: 'React to their pings at most once every N seconds.' },
    { name: '`/nocooldown @user`', value: 'Remove cooldown.' },
    { name: '`/cooldowns`', value: 'List all cooldowns.' },
    { name: '`/panel`', value: 'Full control panel with all settings.' },
    { name: '`/settings`', value: 'Quick settings overview.' },
    { name: '`/ping`', value: 'Bot latency.' },
  );
  return e.setDescription('Unknown category. Use `/help` for the list.');
}

// ── Command handler ───────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName: cmd, guild } = interaction;
  const cfg = guild ? getGuild(guild.id) : {};

  if (cmd === 'panel') return interaction.reply({ embeds: [panelEmbed(cfg)], ephemeral: true });
  if (cmd === 'help') return interaction.reply({ embeds: [helpEmbed(interaction.options.getString('category'))], ephemeral: true });
  if (cmd === 'ping') {
    const s = await interaction.reply({ content: 'Pinging...', fetchReply: true });
    return interaction.editReply(`Pong! **${s.createdTimestamp - interaction.createdTimestamp}ms** | API: **${Math.round(client.ws.ping)}ms**`);
  }
  if (cmd === 'settings') {
    const g = cfg;
    const e = new EmbedBuilder().setColor(0x5865F2).setTitle('Settings').addFields(
      { name: 'Auto-react', value: g.on ? 'ON' : 'OFF', inline: true },
      { name: 'Random', value: g.random ? 'ON' : 'OFF', inline: true },
      { name: 'Mood on ping', value: g.mood ? 'ON' : 'OFF', inline: true },
      { name: 'Auto Mood', value: g.automood ? 'ON' : 'OFF', inline: true },
      { name: 'Ghost Ping', value: g.ghost ? 'ON' : 'OFF', inline: true },
      { name: 'Hours (UTC)', value: g.hoursStart !== null ? `${g.hoursStart}:00–${g.hoursEnd}:00` : '24/7', inline: true },
      { name: 'Default Emojis', value: g.defaultEmojis.length ? g.defaultEmojis.map(disp).join(' ') : '*(none)*', inline: false },
      { name: 'Per-user', value: `${Object.keys(g.userEmojis).length}`, inline: true },
      { name: 'Per-role', value: `${Object.keys(g.roleEmojis).length}`, inline: true },
      { name: 'Mood Rules', value: `${g.moods.length}`, inline: true },
      { name: 'Reaction Roles', value: `${g.reactionRoles.length}`, inline: true },
      { name: 'Shielded', value: `${g.shields.length}`, inline: true },
      { name: 'Blocked', value: `${g.blocked.length}`, inline: true },
    ).setFooter({ text: 'Use /panel for the full overview.' }).setTimestamp();
    return interaction.reply({ embeds: [e], ephemeral: true });
  }

  // ── Toggles ──
  if (cmd === 'on') { setGuild(guild.id, { on: true }); return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription('✅ Auto-reactions are now **ON**.')], ephemeral: true }); }
  if (cmd === 'off') { setGuild(guild.id, { on: false }); return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription('❌ Auto-reactions are now **OFF**.')], ephemeral: true }); }
  if (cmd === 'random') {
    const u = setGuild(guild.id, { random: !cfg.random });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(u.random ? 0x57F287 : 0xFEE75C).setDescription(u.random ? '🎲 Random mode **ON** — picks ONE emoji per ping.' : '🎲 Random mode **OFF** — uses all emojis.')], ephemeral: true });
  }

  // ── Default emojis ──
  if (cmd === 'set') {
    const emojis = many(interaction.options.getString('emojis'));
    if (!emojis.length) return interaction.reply({ content: 'No valid emojis found.', ephemeral: true });
    setGuild(guild.id, { defaultEmojis: emojis });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Default emojis set: ${emojis.map(disp).join(' ')}`)], ephemeral: true });
  }
  if (cmd === 'add') {
    const emoji = one(interaction.options.getString('emoji'));
    if (!emoji) return interaction.reply({ content: 'No valid emoji.', ephemeral: true });
    const list = [...new Set([...cfg.defaultEmojis, emoji])];
    setGuild(guild.id, { defaultEmojis: list });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Added ${disp(emoji)}. List: ${list.map(disp).join(' ')}`)], ephemeral: true });
  }
  if (cmd === 'del') {
    const emoji = one(interaction.options.getString('emoji'));
    if (!emoji) return interaction.reply({ content: 'No valid emoji.', ephemeral: true });
    const list = cfg.defaultEmojis.filter(e => e !== emoji);
    setGuild(guild.id, { defaultEmojis: list });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setDescription(`Removed ${disp(emoji)}. Remaining: ${list.map(disp).join(' ') || '*(none)*'}`)], ephemeral: true });
  }
  if (cmd === 'emojis') {
    const list = cfg.defaultEmojis.length ? cfg.defaultEmojis.map((e, i) => `${i + 1}. ${disp(e)}`).join('\n') : 'No default emojis. Use `/add` to add one.';
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Default Emojis').setDescription(list)], ephemeral: true });
  }
  if (cmd === 'clearemojis') {
    setGuild(guild.id, { defaultEmojis: [] });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription('All default emojis cleared.')], ephemeral: true });
  }

  // ── Per-user emojis ──
  if (cmd === 'setuser') {
    const user = interaction.options.getUser('user');
    const emojis = many(interaction.options.getString('emojis'));
    if (!emojis.length) return interaction.reply({ content: 'No valid emojis.', ephemeral: true });
    setGuild(guild.id, { userEmojis: { ...cfg.userEmojis, [user.id]: emojis } });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`When ${user} is pinged → ${emojis.map(disp).join(' ')}`)], ephemeral: true });
  }
  if (cmd === 'adduser') {
    const user = interaction.options.getUser('user');
    const emoji = one(interaction.options.getString('emoji'));
    if (!emoji) return interaction.reply({ content: 'No valid emoji.', ephemeral: true });
    const list = [...new Set([...(cfg.userEmojis[user.id] || []), emoji])];
    setGuild(guild.id, { userEmojis: { ...cfg.userEmojis, [user.id]: list } });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Added ${disp(emoji)} for ${user}. All: ${list.map(disp).join(' ')}`)], ephemeral: true });
  }
  if (cmd === 'deluser') {
    const user = interaction.options.getUser('user');
    const emoji = one(interaction.options.getString('emoji'));
    if (!emoji) return interaction.reply({ content: 'No valid emoji.', ephemeral: true });
    const list = (cfg.userEmojis[user.id] || []).filter(e => e !== emoji);
    const ue = { ...cfg.userEmojis };
    if (list.length) ue[user.id] = list; else delete ue[user.id];
    setGuild(guild.id, { userEmojis: ue });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setDescription(list.length ? `Removed for ${user}. Left: ${list.map(disp).join(' ')}` : `Removed for ${user}. Now uses defaults.`)], ephemeral: true });
  }
  if (cmd === 'clearuser') {
    const user = interaction.options.getUser('user');
    const ue = { ...cfg.userEmojis };
    delete ue[user.id];
    setGuild(guild.id, { userEmojis: ue });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription(`Custom emojis cleared for ${user}.`)], ephemeral: true });
  }
  if (cmd === 'users') {
    const entries = Object.entries(cfg.userEmojis);
    if (!entries.length) return interaction.reply({ content: 'No per-user configs. Use `/setuser @user <emojis>`.', ephemeral: true });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Per-User Emojis').setDescription(entries.map(([id, em], i) => `${i + 1}. <@${id}> → ${em.map(disp).join(' ')}`).join('\n')).setFooter({ text: 'Users not listed use default or role emojis.' })], ephemeral: true });
  }

  // ── Role emojis ──
  if (cmd === 'setrole') {
    const role = interaction.options.getRole('role');
    const emojis = many(interaction.options.getString('emojis'));
    if (!emojis.length) return interaction.reply({ content: 'No valid emojis.', ephemeral: true });
    setGuild(guild.id, { roleEmojis: { ...cfg.roleEmojis, [role.id]: emojis } });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`When a member of ${role} is pinged → ${emojis.map(disp).join(' ')}`)], ephemeral: true });
  }
  if (cmd === 'delrole') {
    const role = interaction.options.getRole('role');
    const re = { ...cfg.roleEmojis };
    delete re[role.id];
    setGuild(guild.id, { roleEmojis: re });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription(`Role emoji config removed for ${role}.`)], ephemeral: true });
  }
  if (cmd === 'roles') {
    const entries = Object.entries(cfg.roleEmojis);
    if (!entries.length) return interaction.reply({ content: 'No role configs. Use `/setrole @role <emojis>`.', ephemeral: true });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Role Emojis').setDescription(entries.map(([id, em], i) => `${i + 1}. <@&${id}> → ${em.map(disp).join(' ')}`).join('\n'))], ephemeral: true });
  }

  // ── Mood ──
  if (cmd === 'mood') {
    const u = setGuild(guild.id, { mood: !cfg.mood });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(u.mood ? 0x57F287 : 0xFEE75C).setDescription(`Mood on ping: **${u.mood ? 'ON' : 'OFF'}**.\n${u.mood ? 'Bot uses mood emojis when a keyword appears in a ping message.' : 'Using configured emojis.'}`)], ephemeral: true });
  }
  if (cmd === 'automood') {
    const u = setGuild(guild.id, { automood: !cfg.automood });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(u.automood ? 0x57F287 : 0xFEE75C).setDescription(`Auto mood: **${u.automood ? 'ON' : 'OFF'}**.\n${u.automood ? 'Bot reacts to any message with a mood keyword — no ping needed.' : 'Auto mood off.'}`)], ephemeral: true });
  }
  if (cmd === 'moods') {
    const rules = cfg.moods;
    const lines = rules.map((r, i) => `${i + 1}. \`${r.keyword}\` → ${r.emojis.join(' ')}`).join('\n');
    const chunks = [];
    let cur = '';
    for (const line of lines.split('\n')) {
      if ((cur + '\n' + line).length > 1000) { chunks.push(cur); cur = line; } else cur = cur ? cur + '\n' + line : line;
    }
    if (cur) chunks.push(cur);
    const e = new EmbedBuilder().setColor(0x5865F2).setTitle(`Mood Rules (${rules.length})`).setDescription(chunks[0] || 'No rules.').setFooter({ text: 'Use /moodadd, /moodedit, /mooddel to manage.' });
    if (chunks[1]) e.addFields({ name: '...continued', value: chunks[1] });
    return interaction.reply({ embeds: [e], ephemeral: true });
  }
  if (cmd === 'moodadd') {
    const kw = interaction.options.getString('keyword').toLowerCase().trim();
    const emojis = many(interaction.options.getString('emojis'));
    if (!emojis.length) return interaction.reply({ content: 'No valid emojis.', ephemeral: true });
    if (cfg.moods.find(r => r.keyword === kw)) return interaction.reply({ content: `Rule for \`${kw}\` exists. Use \`/moodedit\`.`, ephemeral: true });
    cfg.moods.push({ keyword: kw, emojis });
    setGuild(guild.id, { moods: cfg.moods });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Added: \`${kw}\` → ${emojis.join(' ')}`)], ephemeral: true });
  }
  if (cmd === 'moodedit') {
    const kw = interaction.options.getString('keyword').toLowerCase().trim();
    const emojis = many(interaction.options.getString('emojis'));
    if (!emojis.length) return interaction.reply({ content: 'No valid emojis.', ephemeral: true });
    const idx = cfg.moods.findIndex(r => r.keyword === kw);
    if (idx === -1) return interaction.reply({ content: `No rule for \`${kw}\`. Use \`/moods\` to see all.`, ephemeral: true });
    cfg.moods[idx].emojis = emojis;
    setGuild(guild.id, { moods: cfg.moods });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Updated \`${kw}\` → ${emojis.join(' ')}`)], ephemeral: true });
  }
  if (cmd === 'mooddel') {
    const kw = interaction.options.getString('keyword').toLowerCase().trim();
    const before = cfg.moods.length;
    cfg.moods = cfg.moods.filter(r => r.keyword !== kw);
    if (cfg.moods.length === before) return interaction.reply({ content: `No rule for \`${kw}\`.`, ephemeral: true });
    setGuild(guild.id, { moods: cfg.moods });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription(`Removed mood rule: \`${kw}\``)], ephemeral: true });
  }
  if (cmd === 'moodreset') {
    setGuild(guild.id, { moods: JSON.parse(JSON.stringify(DEFAULT_MOODS)) });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Mood rules reset to **${DEFAULT_MOODS.length}** built-in defaults.`)], ephemeral: true });
  }

  // ── Reaction roles ──
  if (cmd === 'rradd') {
    const msgId = interaction.options.getString('message_id');
    const emoji = one(interaction.options.getString('emoji'));
    const role = interaction.options.getRole('role');
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (!emoji) return interaction.reply({ content: 'No valid emoji.', ephemeral: true });
    let msg;
    try { msg = await channel.messages.fetch(msgId); } catch { return interaction.reply({ content: `Couldn't find that message in ${channel}.`, ephemeral: true }); }
    if (cfg.reactionRoles.find(r => r.messageId === msgId && r.emoji === emoji && r.roleId === role.id)) return interaction.reply({ content: 'Already exists.', ephemeral: true });
    cfg.reactionRoles.push({ messageId: msgId, channelId: channel.id, emoji, roleId: role.id });
    setGuild(guild.id, { reactionRoles: cfg.reactionRoles });
    await msg.react(emoji).catch(() => {});
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('Reaction Role Added').setDescription(`[Jump](https://discord.com/channels/${guild.id}/${channel.id}/${msgId})\n${disp(emoji)} → ${role}`)], ephemeral: true });
  }
  if (cmd === 'rrlist') {
    if (!cfg.reactionRoles.length) return interaction.reply({ content: 'No reaction roles. Use `/rradd`.', ephemeral: true });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Reaction Roles').setDescription(cfg.reactionRoles.map((r, i) => `**${i + 1}.** ${disp(r.emoji)} → <@&${r.roleId}>\n[message](https://discord.com/channels/${guild.id}/${r.channelId}/${r.messageId})`).join('\n\n'))], ephemeral: true });
  }
  if (cmd === 'rrdel') {
    const num = interaction.options.getInteger('number');
    if (num > cfg.reactionRoles.length) return interaction.reply({ content: `No #${num}.`, ephemeral: true });
    const rem = cfg.reactionRoles.splice(num - 1, 1)[0];
    setGuild(guild.id, { reactionRoles: cfg.reactionRoles });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription(`Removed #${num}: ${disp(rem.emoji)} → <@&${rem.roleId}>`)], ephemeral: true });
  }

  // ── Ghost ping ──
  if (cmd === 'ghost') {
    const u = setGuild(guild.id, { ghost: !cfg.ghost });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(u.ghost ? 0x57F287 : 0xFEE75C).setDescription(`Ghost ping detector: **${u.ghost ? 'ON' : 'OFF'}**`)], ephemeral: true });
  }
  if (cmd === 'ghostlog') {
    const ch = interaction.options.getChannel('channel');
    setGuild(guild.id, { ghostLog: ch.id });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Ghost ping alerts → ${ch}`)], ephemeral: true });
  }

  // ── Leaderboard ──
  if (cmd === 'top') {
    const counts = Object.entries(cfg.pingCounts).sort(([, a], [, b]) => b - a).slice(0, 10);
    if (!counts.length) return interaction.reply({ content: 'No pings tracked yet.' });
    const medals = ['🥇', '🥈', '🥉'];
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFFD700).setTitle('📊 Ping Leaderboard').setDescription(counts.map(([id, n], i) => `${medals[i] || `**${i + 1}.**`} <@${id}> — **${n}** pings`).join('\n')).setTimestamp()] });
  }
  if (cmd === 'count') {
    const user = interaction.options.getUser('user') || interaction.user;
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setDescription(`${user} has been pinged **${cfg.pingCounts[user.id] || 0} times**.`)] });
  }
  if (cmd === 'milestone') {
    const ch = interaction.options.getChannel('channel');
    setGuild(guild.id, { milestoneLog: ch.id });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Milestone announcements → ${ch}`)], ephemeral: true });
  }
  if (cmd === 'resetcount') {
    const user = interaction.options.getUser('user');
    cfg.pingCounts[user.id] = 0;
    setGuild(guild.id, { pingCounts: cfg.pingCounts });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription(`Ping count reset for ${user}.`)], ephemeral: true });
  }

  // ── Cooldown ──
  if (cmd === 'cooldown') {
    const user = interaction.options.getUser('user');
    const sec = interaction.options.getInteger('seconds');
    cfg.cooldowns[user.id] = sec;
    setGuild(guild.id, { cooldowns: cfg.cooldowns });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Cooldown for ${user}: **${sec}s** between reactions.`)], ephemeral: true });
  }
  if (cmd === 'nocooldown') {
    const user = interaction.options.getUser('user');
    delete cfg.cooldowns[user.id];
    delete cfg.lastPing[user.id];
    setGuild(guild.id, { cooldowns: cfg.cooldowns, lastPing: cfg.lastPing });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setDescription(`Cooldown removed for ${user}.`)], ephemeral: true });
  }
  if (cmd === 'cooldowns') {
    const entries = Object.entries(cfg.cooldowns);
    if (!entries.length) return interaction.reply({ content: 'No cooldowns set.', ephemeral: true });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Cooldowns').setDescription(entries.map(([id, s], i) => `${i + 1}. <@${id}> — **${s}s**`).join('\n'))], ephemeral: true });
  }

  // ── Shield ──
  if (cmd === 'shield') {
    const user = interaction.options.getUser('user');
    const list = new Set(cfg.shields);
    list.add(user.id);
    setGuild(guild.id, { shields: [...list] });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`🛡️ ${user} is now protected.`)], ephemeral: true });
  }
  if (cmd === 'unshield') {
    const user = interaction.options.getUser('user');
    setGuild(guild.id, { shields: cfg.shields.filter(id => id !== user.id) });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setDescription(`Shield removed from ${user}.`)], ephemeral: true });
  }
  if (cmd === 'shields') {
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Shielded Users').setDescription(cfg.shields.length ? cfg.shields.map((id, i) => `${i + 1}. <@${id}>`).join('\n') : 'None.')], ephemeral: true });
  }
  if (cmd === 'shieldlog') {
    const ch = interaction.options.getChannel('channel');
    setGuild(guild.id, { shieldLog: ch.id });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Shield alerts → ${ch}`)], ephemeral: true });
  }

  // ── Block ──
  if (cmd === 'block') {
    const user = interaction.options.getUser('user');
    const list = new Set(cfg.blocked);
    list.add(user.id);
    setGuild(guild.id, { blocked: [...list] });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription(`🚫 ${user} is now blocked. Bot will not react to any pings sent by them.`)], ephemeral: true });
  }
  if (cmd === 'unblock') {
    const user = interaction.options.getUser('user');
    setGuild(guild.id, { blocked: cfg.blocked.filter(id => id !== user.id) });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`${user} unblocked.`)], ephemeral: true });
  }
  if (cmd === 'blocked') {
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Blocked Users').setDescription(cfg.blocked.length ? cfg.blocked.map((id, i) => `${i + 1}. <@${id}>`).join('\n') : 'None.')], ephemeral: true });
  }

  // ── Hours ──
  if (cmd === 'hours') {
    const start = interaction.options.getInteger('start');
    const end = interaction.options.getInteger('end');
    setGuild(guild.id, { hoursStart: start, hoursEnd: end });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`Bot will only auto-react between **${start}:00 – ${end}:00 UTC**.\nUse \`/nohours\` to remove this restriction.`)], ephemeral: true });
  }
  if (cmd === 'nohours') {
    setGuild(guild.id, { hoursStart: null, hoursEnd: null });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setDescription('Time restriction removed. Bot reacts 24/7.')], ephemeral: true });
  }

  // ── Rain ──
  if (cmd === 'rain') {
    const emoji = one(interaction.options.getString('emoji'));
    const count = interaction.options.getInteger('count');
    if (!emoji) return interaction.reply({ content: 'No valid emoji.', ephemeral: true });
    await interaction.reply({ content: `🌧️ Reacting to the last **${count}** messages...`, ephemeral: true });
    try {
      const messages = await interaction.channel.messages.fetch({ limit: count + 1 });
      const targets = [...messages.values()].filter(m => !m.author.bot).slice(0, count);
      for (const msg of targets) {
        await msg.react(emoji).catch(() => {});
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (e) {
      await interaction.editReply('Failed to fetch messages. Make sure I have Read Message History permission.').catch(() => {});
    }
  }
});

// ── Auto-react on ping ────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const cfg = getGuild(message.guild.id);
  if (!cfg.on) return;
  if (!inHours(cfg)) return;
  if (cfg.blocked.includes(message.author.id)) return;

  // Auto mood — any message, no ping needed
  if (cfg.automood) {
    const mood = moodMatch(cfg.moods, message.content);
    if (mood) {
      for (const e of mood) await message.react(e).catch(() => {});
      return;
    }
  }

  const mentionedIds = [...message.mentions.users.keys()];
  const hasRolePing = message.mentions.roles.size > 0 || message.mentions.everyone;
  if (!mentionedIds.length && !hasRolePing) return;

  for (const userId of mentionedIds) {
    if (!canReact(cfg, userId)) continue;
    let memberRoles = null;
    try {
      const member = await message.guild.members.fetch(userId);
      memberRoles = [...member.roles.cache.keys()];
    } catch {}
    const emojis = pickEmojis(cfg, userId, memberRoles, message.content);
    if (emojis.length) {
      for (const e of emojis) await message.react(e).catch(() => {});
      stampCooldown(cfg, message.guild.id, userId);
    }
    await trackPing(cfg, message.guild.id, message.guild, userId);
    if (cfg.shields.includes(userId)) {
      const ch = cfg.shieldLog ? message.guild.channels.cache.get(cfg.shieldLog) : message.channel;
      if (ch) await ch.send({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('🛡️ Shield Alert').setDescription(`${message.author} pinged <@${userId}> who is a protected user.`).setTimestamp()] }).catch(() => {});
    }
  }

  if (!mentionedIds.length && hasRolePing && cfg.defaultEmojis.length) {
    const pool = cfg.defaultEmojis;
    const emojis = cfg.random ? [pool[Math.floor(Math.random() * pool.length)]] : pool;
    for (const e of emojis) await message.react(e).catch(() => {});
  }
});

// ── Ghost ping ────────────────────────────────────────────────────────────────
client.on('messageDelete', async (message) => {
  if (!message.guild || message.author?.bot) return;
  const cfg = getGuild(message.guild.id);
  if (!cfg.ghost) return;
  if (!message.mentions?.users?.size && !message.mentions?.roles?.size) return;
  const ch = cfg.ghostLog ? message.guild.channels.cache.get(cfg.ghostLog) : message.channel;
  if (!ch) return;
  const pinged = message.mentions.users.map(u => `${u}`).join(', ') || 'a role';
  await ch.send({ embeds: [new EmbedBuilder().setColor(0xFF6B6B).setTitle('👻 Ghost Ping — Deleted').setDescription(`**${message.author?.tag}** deleted a ping to ${pinged}.`).addFields({ name: 'Message', value: message.content ? `"${message.content.slice(0, 300)}"` : '*(empty)*' }).setTimestamp()] }).catch(() => {});
});
client.on('messageUpdate', async (old, nw) => {
  if (!old.guild || old.author?.bot) return;
  const cfg = getGuild(old.guild.id);
  if (!cfg.ghost) return;
  const had = old.mentions?.users?.size > 0 || old.mentions?.roles?.size > 0;
  const has = nw.mentions?.users?.size > 0 || nw.mentions?.roles?.size > 0;
  if (!had || has) return;
  const ch = cfg.ghostLog ? old.guild.channels.cache.get(cfg.ghostLog) : old.channel;
  if (!ch) return;
  const pinged = old.mentions.users.map(u => `${u}`).join(', ') || 'a role';
  await ch.send({ embeds: [new EmbedBuilder().setColor(0xFF6B6B).setTitle('👻 Ghost Ping — Edited').setDescription(`**${old.author?.tag}** edited out a ping to ${pinged}.`).addFields({ name: 'Before', value: old.content?.slice(0, 200) || '*(unknown)*' }, { name: 'After', value: nw.content?.slice(0, 200) || '*(empty)*' }).setTimestamp()] }).catch(() => {});
});

// ── Reaction roles ────────────────────────────────────────────────────────────
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
  const guild = reaction.message.guild;
  if (!guild) return;
  const cfg = getGuild(guild.id);
  const match = cfg.reactionRoles.find(r => r.messageId === reaction.message.id && r.emoji === ekey(reaction.emoji));
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
  const match = cfg.reactionRoles.find(r => r.messageId === reaction.message.id && r.emoji === ekey(reaction.emoji));
  if (!match) return;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (member) await member.roles.remove(match.roleId).catch(() => {});
});

client.login(process.env.DISCORD_TOKEN);
