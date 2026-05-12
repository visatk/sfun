# 👻 GhostSweeper Bot

> **A professional Telegram bot that automatically removes deleted ("ghost") accounts from your groups.**
> Built on Cloudflare Workers + D1 — zero cold starts, globally distributed, completely free tier eligible.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🧹 **Active Sweep** | `/sweep` scans all tracked members and removes deleted accounts |
| 👁 **Passive Mode** | Every incoming message is silently checked; deleted accounts removed instantly |
| ⚙️ **Settings Panel** | Inline keyboard UI — toggle bot, passive mode, notifications |
| 📊 **Statistics** | Per-group removal counts, scan history, last scan timestamp |
| 🔒 **Admin-only** | All commands restricted to group admins |
| 🌍 **Global Edge** | Cloudflare Workers — ~0ms cold start, 200+ PoPs |
| 🛡 **Webhook Security** | Secret token validation on every request |
| 💾 **D1 Database** | SQLite at the edge — tracks members, config, logs |

---

## 🏗 Architecture

```
Telegram ──webhook──▶ Cloudflare Worker (Hono)
                              │
                    ┌─────────┴──────────┐
                    │   Update Handler   │
                    └────────┬───────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        Commands        Sweeper        D1 Database
      (/sweep etc)   (ghost detect)  (config/logs)
              │              │
              └──────────────┴──▶ Telegram API
```

**Files:**
```
src/
├── index.ts              # Hono app, routes (/webhook, /setup, /stats)
├── bot/
│   ├── handler.ts        # Update router (messages, callbacks, member events)
│   ├── commands.ts       # /start /sweep /settings /stats handlers
│   ├── sweeper.ts        # Core ghost detection & removal logic
│   └── webhook.ts        # Webhook registration helpers
├── telegram/
│   ├── api.ts            # Telegram Bot API wrapper (typed)
│   └── types.ts          # TypeScript interfaces for Telegram objects
└── db/
    └── queries.ts        # All D1 database operations
schema.sql                # D1 table definitions
wrangler.jsonc            # Cloudflare Workers config
```

---

## 🚀 Deployment

### 1. Prerequisites

- [Cloudflare account](https://dash.cloudflare.com) (free)
- [Node.js 18+](https://nodejs.org)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### 2. Install dependencies

```bash
npm install
```

### 3. Create the D1 database

```bash
# Create the D1 database (if it doesn't exist yet)
npx wrangler d1 create bot

# Copy the database_id from the output into wrangler.jsonc

# Initialise tables locally (for dev)
npm run db:init

# Initialise tables on Cloudflare (production)
npm run db:init:remote
```

### 4. Set secrets

```bash
npx wrangler secret put BOT_TOKEN
# Paste your bot token from BotFather

npx wrangler secret put BOT_SECRET
# Paste a random secret string (e.g. openssl rand -hex 32)
```

### 5. Update wrangler.jsonc

Edit `wrangler.jsonc` and set `WEBHOOK_URL`:
```json
"vars": {
  "WEBHOOK_URL": "https://ghostsweeper-bot.YOUR-SUBDOMAIN.workers.dev/webhook"
}
```

### 6. Deploy

```bash
npm run deploy
```

### 7. Register the webhook

Visit in your browser (one time only):
```
https://ghostsweeper-bot.YOUR-SUBDOMAIN.workers.dev/setup?token=YOUR_BOT_SECRET
```

You should see: `{"ok":true,"description":"Webhook set successfully"}`

---

## 🤖 Bot Setup (in Telegram)

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → follow prompts
2. Copy the token → set as `BOT_TOKEN` secret
3. Set bot commands via BotFather → `/setcommands`:
   ```
   start - Initialise GhostSweeper in this group
   sweep - Scan & remove deleted accounts
   settings - Configure GhostSweeper
   stats - View removal statistics
   help - Show help
   ```
4. Add the bot to your group
5. Promote it to **Admin** with **Remove Members** permission
6. Run `/start` → it's live!

---

## 💬 Commands

| Command | Description | Who |
|---|---|---|
| `/start` | Initialise bot, show welcome | Admins |
| `/sweep` | Scan tracked members, remove ghosts | Admins |
| `/settings` | Toggle features via inline keyboard | Admins |
| `/stats` | Show removal counts & last scan | Anyone |
| `/help` | Show help text | Anyone |

---

## 🔍 How Ghost Detection Works

Telegram deleted accounts have a specific signature:
- `first_name` is an **empty string** (`""`)
- No `username` or `last_name`
- `is_bot` is `false`

GhostSweeper checks this on:
1. **Every incoming message** (passive mode) — catches ghosts that are still active in chat
2. **Full sweeps** (`/sweep`) — iterates all tracked user IDs via `getChatMember`

After removal: `banChatMember` → immediately `unbanChatMember` = clean kick with no blacklist entry.

---

## 🛡 Security

- Webhook requests validated with `X-Telegram-Bot-Api-Secret-Token`
- All bot commands restricted to group administrators
- `/setup` and `/stats` admin endpoints require `?token=BOT_SECRET`
- No message content stored — only user IDs, chat IDs, timestamps

---

## 📈 Scaling & Limits

| Metric | Value |
|---|---|
| Requests | 100,000/day free (Workers) |
| D1 reads | 5M/day free |
| D1 writes | 100K/day free |
| Telegram rate | ~30 req/s (batched at 8 concurrent) |
| Cold start | ~0ms (V8 isolates) |

For very large groups (10K+ members), consider processing sweeps in batches across multiple invocations using Cloudflare Queues.

---

## 🧩 Environment Variables

| Variable | Description | How to set |
|---|---|---|
| `BOT_TOKEN` | Telegram bot token | `wrangler secret put BOT_TOKEN` |
| `BOT_SECRET` | Webhook secret token | `wrangler secret put BOT_SECRET` |
| `WEBHOOK_URL` | Full webhook URL | `wrangler.jsonc` vars |
| `DB` | D1 database binding | `wrangler.jsonc` d1_databases |

---

## 📄 License

MIT — free to use, modify, and deploy.
