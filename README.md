# Mochi: a cute all-in-one Discord bot

217 commands: moderation, tickets, giveaways, invite tracker, automod and anti-nuke, roles and role panels,
logs, highlights, config, utility and misc. Works with slash commands (`/ticket new`) and a prefix (`.ticket new`).

## 1. Discord Developer Portal (one time)
1. Create an application, add a Bot, copy the **token**. Copy the **Application ID** too.
2. Bot tab > **Privileged Gateway Intents**: switch on **Server Members Intent** and **Message Content Intent**.

## 2. Install and run (Termux Debian)
```
apt update && apt install -y nodejs npm build-essential python3
npm install
cp .env.example .env        # fill TOKEN and CLIENT_ID, and GUILD_ID for instant slash commands
npm run validate            # checks the command list against Discord's limits
npm run deploy              # registers slash commands
npm start
```
- With `GUILD_ID` set, slash commands appear instantly in that server.
  `npm run deploy:global` registers them everywhere (can take a few minutes).
- Invite the bot with `/invite` (it includes the `applications.commands` scope). Without that scope slash commands never show up.

## 3. First steps in your server (admins)
| Command | What it does |
|---|---|
| `/ticket setup` | Creates the support role, private category, log channel and the Create ticket button |
| `/log setup` | Creates a private log channel and turns every log on |
| `/automod setup` | Turns on spam, repeat, invite, mention, caps, zalgo, ghost ping and raid protection |
| `/log modlog` | Posts every ban, kick, warning and timeout as a numbered case |
| `/config welcome` | Greets new members |
| `/help` | Menu of everything |

## How it is organised
Related commands are grouped (Discord allows only 100 top-level commands): `/ticket ...`, `/giveaway ...`,
`/invites ...`, `/automod ...`, `/role ...`, `/log ...`, `/config ...`. Popular ones stay top-level: `/ban`, `/kick`,
`/timeout`, `/warn`, `/purge`, `/avatar`, `/userinfo`, `/poll`, `/afk` and more.

## Code map
- `src/commands/*.js`: one file per category. Each command is written once and works as slash and prefix.
- `src/core/`: database, message design (`ui.js`), permissions, scheduler, automod engine, invite tracker, giveaway engine.
- `src/events/`: Discord events. `src/components/`: buttons, menus and modals.
- Message look and colours: `src/core/ui.js` and `src/config.js`.

## Notes
- Needs Node 18 or newer.
- `/weather`, `/define`, `/github`, `/translate`, `/qr` use free public web services and need internet access.
- The bot role must sit **above** the roles it manages (Server Settings > Roles).
