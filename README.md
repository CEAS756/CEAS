# 🤖 CEAS REACTION Bot

A Discord bot that auto-reacts when someone gets pinged — fully configurable **inside Discord** with no coding needed.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔔 **Auto-react on ping** | Reacts with emojis whenever someone is @mentioned |
| 🎛️ **`/panel`** | Control panel — all settings in one place |
| 📄 **`/settings`** | View current configuration |
| 🔔 **`/setreactions`** | Change reaction emojis without touching code |
| 🔁 **`/togglereactions`** | Enable/disable auto-reactions |
| 👋 **`/setwelcome`** | Set a welcome channel |
| ✏️ **`/setwelcomemsg`** | Customize welcome message |
| 📋 **`/setlog`** | Set a log channel for bot actions |
| ⚙️ **`/setprefix`** | Change command prefix |
| 🏓 **`/ping`** | Bot latency |
| 👤 **`/userinfo`** | Member info |
| 🏠 **`/serverinfo`** | Server stats |
| 🖼️ **`/avatar`** | User avatar |
| 💬 **`/say`** | Bot sends a message |
| 🗑️ **`/clear`** | Delete messages |

> **All config commands require the "Manage Server" permission — regular members can't change settings.**

---

## 🚀 Setup

### Step 1 — Create Your Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → name it `CEAS REACTION`
3. Go to **General Information** → copy your **Application ID** (you'll need this)
4. Go to the **Bot** tab → click **Reset Token** → copy your **Bot Token**
5. Under **Privileged Gateway Intents**, enable:
   - ✅ **Server Members Intent**
   - ✅ **Message Content Intent**
6. Go to **OAuth2 → URL Generator**
   - Scopes: ✅ `bot` ✅ `applications.commands`
   - Bot Permissions: `Send Messages`, `Read Messages`, `Add Reactions`, `Manage Messages`, `Read Message History`
7. Open the generated URL → invite the bot to your server

---

### Option A — Run Locally

```bash
# 1. Extract this ZIP and open the folder
cd ceas-reaction-bot

# 2. Install dependencies
npm install

# 3. Set up your config
cp .env.example .env
# Open .env and fill in DISCORD_TOKEN and CLIENT_ID

# 4. Start the bot
npm start
```

---

### Option B — Deploy on Railway (free, always online)

1. Push this folder to a **GitHub repository**
2. Go to [railway.app](https://railway.app) → sign in with GitHub
3. Click **New Project → Deploy from GitHub repo** → select your repo
4. Go to the **Variables** tab and add:
   - `DISCORD_TOKEN` → your bot token
   - `CLIENT_ID` → your Application ID
   - `PREFIX` → `!`
5. Railway deploys automatically — bot is live! ✅

---

## ⚙️ Configuration (inside Discord — no coding!)

Once the bot is online, admins can configure everything with slash commands:

| Command | What it does |
|---|---|
| `/panel` | Opens the full control panel |
| `/setreactions 👀,✅,🔔` | Change ping reaction emojis |
| `/togglereactions` | Turn auto-reactions on/off |
| `/setwelcome #channel` | Set welcome channel |
| `/setwelcomemsg Welcome {user}!` | Customize welcome text |
| `/disablewelcome` | Turn off welcome messages |
| `/setlog #channel` | Set log channel |
| `/setprefix ?` | Change command prefix |
| `/settings` | View all current settings |

**Welcome message placeholders:**
- `{user}` → @mentions the new member
- `{server}` → server name
- `{count}` → current member count

---

## 📁 File Structure

```
ceas-reaction-bot/
├── index.js          # Main bot code
├── settings.json     # Auto-created — stores per-server settings
├── package.json      # Dependencies
├── .env.example      # Config template
├── .env              # Your actual config (never share this!)
├── .gitignore        # Keeps .env and node_modules out of git
├── Procfile          # Railway/Heroku process file
├── railway.json      # Railway deployment config
└── README.md         # This file
```

---

Made with ❤️ using [discord.js v14](https://discord.js.org/)
