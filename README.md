# 🤖 CEAS REACTION Bot

Auto-reacts when someone gets pinged. Choose exactly WHO gets reactions, with any emoji including custom and Nitro animated ones.

---

## ✨ Features

| Command | What it does |
|---|---|
| `/panel` | Full control panel overview |
| `/settings` | View current config |
| `/setreactions` | Set reaction emojis (standard, custom, Nitro) |
| `/togglereactions` | Turn auto-reactions on/off |
| `/addtarget @user` | Only react when THIS person is pinged |
| `/removetarget @user` | Remove from target list |
| `/targets` | View target list |
| `/cleartargets` | React to all pings again |
| `/ping` | Bot latency |
| `/help` | All commands |

> **Config commands require "Manage Server" permission.**

---

## 🎨 Custom & Nitro Emojis in /setreactions

You can use **any emoji type**:

| Type | How to input |
|---|---|
| Standard emoji | Just paste it: `👀 ✅ 🔥` |
| Custom server emoji | Type `<:name:ID>` e.g. `<:pogchamp:123456789>` |
| Animated / Nitro emoji | Type `<a:name:ID>` e.g. `<a:dance:987654321>` |

**How to get a custom emoji ID on Discord:**
1. Type `\:emojiname:` in any chat
2. Discord shows the raw ID like `<:name:123456789>`
3. Copy that and paste it into `/setreactions`

> Note: The bot can only react with custom emojis from servers it is in, or animated emojis if it has Nitro. For server emojis, invite the bot to the server that has those emojis.

---

## 🎯 Targeting — React to specific people only

By default the bot reacts to **all pings**. Use `/addtarget` to restrict it:

- `/addtarget @John` → only react when John is pinged
- `/addtarget @Sarah` → also react when Sarah is pinged
- `/removetarget @John` → remove John
- `/cleartargets` → go back to reacting to everyone

---

## 🚀 Setup

### Step 1 — Create Your Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → name it `CEAS REACTION`
3. **General Information** → copy your **Application ID**
4. **Bot** tab → **Reset Token** → copy your **Bot Token**
5. Enable under **Privileged Gateway Intents**:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
6. **OAuth2 → URL Generator**
   - Scopes: ✅ `bot` ✅ `applications.commands`
   - Permissions: `Send Messages`, `Read Messages`, `Add Reactions`, `Read Message History`
7. Open generated URL → invite bot to your server

---

### Option A — Run Locally

```bash
cd ceas-reaction-bot
npm install
cp .env.example .env
# Edit .env — add DISCORD_TOKEN and CLIENT_ID
npm start
```

### Option B — Railway (free, always online)

1. Upload folder to a GitHub repo
2. [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add Variables:
   - `DISCORD_TOKEN` → your bot token
   - `CLIENT_ID` → your Application ID
4. Deploy — done ✅

---

## 📁 Files

```
index.js        — Bot code
settings.json   — Auto-created, stores per-server settings
package.json    — Dependencies
.env.example    — Config template (rename to .env locally)
railway.json    — Railway config
Procfile        — Process file
```
