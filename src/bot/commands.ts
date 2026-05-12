import {
  sendMessage,
  getChatAdministrators,
  kickChatMember,
  answerCallbackQuery,
  editMessageText,
  deleteMessage,
  callTelegram,
} from "../telegram/api";
import {
  getGroupConfig,
  upsertGroupConfig,
  toggleGroup,
  toggleAutoScan,
  toggleNotify,
  getGroupStats,
  getRecentRemovals,
  savePendingScan,
  getPendingScan,
  deletePendingScan,
} from "../db/queries";
import { sweepGroup, buildSweepReport, escapeHtml } from "./sweeper";
import type { TelegramMessage, TelegramCallbackQuery } from "../telegram/types";
import type { Env } from "../index";

// ── Permission guards ─────────────────────────────────────────────────────────

async function isUserAdmin(
  token: string,
  chatId: number,
  userId: number
): Promise<boolean> {
  const admins = await getChatAdministrators(token, chatId);
  if (!admins.ok || !admins.result) return false;
  return admins.result.some(
    (a) =>
      a.user.id === userId &&
      ["administrator", "creator"].includes(a.status)
  );
}

function isGroupChat(type: string): boolean {
  return type === "group" || type === "supergroup";
}

// ── /start ────────────────────────────────────────────────────────────────────

export async function handleStart(msg: TelegramMessage, env: Env) {
  const isGroup = isGroupChat(msg.chat.type);

  if (!isGroup) {
    await sendMessage(
      env.BOT_TOKEN,
      msg.chat.id,
      `👻 <b>GhostSweeper Bot</b>\n\n` +
        `I remove deleted Telegram accounts from your groups automatically.\n\n` +
        `<b>How to use:</b>\n` +
        `1. Add me to your group\n` +
        `2. Make me an <b>Admin</b> with <i>Remove Members</i> permission\n` +
        `3. Use /sweep to scan & clean\n\n` +
        `<b>Commands (in group):</b>\n` +
        `/sweep — Scan & remove deleted accounts\n` +
        `/settings — Bot configuration\n` +
        `/stats — View removal statistics\n` +
        `/help — Show help\n\n` +
        `🔒 Only group admins can use these commands.`
    );
    return;
  }

  if (!msg.from) return;
  const isAdmin = await isUserAdmin(env.BOT_TOKEN, msg.chat.id, msg.from.id);
  if (!isAdmin) {
    await sendMessage(
      env.BOT_TOKEN,
      msg.chat.id,
      "🚫 Only group admins can use this bot."
    );
    return;
  }

  const cfg = await getGroupConfig(env.DB, msg.chat.id);
  if (!cfg) {
    await upsertGroupConfig(
      env.DB,
      msg.chat.id,
      msg.chat.title ?? "Unknown",
      msg.from.id
    );
  }

  await sendMessage(
    env.BOT_TOKEN,
    msg.chat.id,
    `👻 <b>GhostSweeper is ready!</b>\n\n` +
      `I'll help keep this group clean from deleted accounts.\n\n` +
      `Use /sweep to run a full scan, or /settings to configure me.\n\n` +
      `💡 <i>Passive mode is active — I'll silently remove any deleted account that sends a message.</i>`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🧹 Run Sweep Now", callback_data: "sweep_confirm" }],
          [{ text: "⚙️ Settings", callback_data: "open_settings" }],
        ],
      },
    }
  );
}

// ── /help ─────────────────────────────────────────────────────────────────────

export async function handleHelp(msg: TelegramMessage, env: Env) {
  await sendMessage(
    env.BOT_TOKEN,
    msg.chat.id,
    `<b>👻 GhostSweeper — Help</b>\n\n` +
      `<b>Commands:</b>\n` +
      `/start — Initialise bot in this group\n` +
      `/sweep — Scan all known members & remove deleted accounts\n` +
      `/settings — Toggle auto-scan, notifications, etc.\n` +
      `/stats — Show removal statistics for this group\n` +
      `/help — Show this message\n\n` +
      `<b>How it works:</b>\n` +
      `• <b>Passive:</b> Every message sent is silently checked. If the sender is a deleted account, they're removed instantly.\n` +
      `• <b>Active sweep:</b> /sweep checks every tracked member.\n\n` +
      `<b>Requirements:</b>\n` +
      `• Bot must be Admin with "Remove Members" permission.\n` +
      `• Only group admins can run sweeps.\n\n` +
      `<b>Privacy:</b>\n` +
      `Only user IDs and chat IDs are stored — no messages, no names.`
  );
}

// ── /sweep ────────────────────────────────────────────────────────────────────

export async function handleSweep(msg: TelegramMessage, env: Env) {
  if (!isGroupChat(msg.chat.type)) {
    await sendMessage(env.BOT_TOKEN, msg.chat.id, "❌ This command works in groups only.");
    return;
  }
  if (!msg.from) return;

  const isAdmin = await isUserAdmin(env.BOT_TOKEN, msg.chat.id, msg.from.id);
  if (!isAdmin) {
    await sendMessage(env.BOT_TOKEN, msg.chat.id, "🚫 Only group admins can run a sweep.");
    return;
  }

  const cfg = await getGroupConfig(env.DB, msg.chat.id);
  if (!cfg || !cfg.enabled) {
    await sendMessage(
      env.BOT_TOKEN,
      msg.chat.id,
      "⚠️ Bot is disabled for this group. Use /settings to enable it."
    );
    return;
  }

  // Confirm before sweep
  await sendMessage(
    env.BOT_TOKEN,
    msg.chat.id,
    `🔍 <b>Ready to sweep!</b>\n\nThis will check all tracked members and remove any deleted accounts.\n\n<i>Note: Only members who have sent at least one message since the bot was added are tracked.</i>`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Yes, sweep now!", callback_data: "sweep_confirm" },
            { text: "❌ Cancel", callback_data: "sweep_cancel" },
          ],
        ],
      },
    }
  );
}

// ── /settings ─────────────────────────────────────────────────────────────────

export async function handleSettings(msg: TelegramMessage, env: Env) {
  if (!isGroupChat(msg.chat.type)) {
    await sendMessage(env.BOT_TOKEN, msg.chat.id, "❌ Settings are only available in groups.");
    return;
  }
  if (!msg.from) return;

  const isAdmin = await isUserAdmin(env.BOT_TOKEN, msg.chat.id, msg.from.id);
  if (!isAdmin) {
    await sendMessage(env.BOT_TOKEN, msg.chat.id, "🚫 Only group admins can access settings.");
    return;
  }

  await sendSettingsMenu(env.BOT_TOKEN, env.DB, msg.chat.id, msg.chat.id);
}

async function sendSettingsMenu(
  token: string,
  db: D1Database,
  chatId: number,
  targetChatId: number,
  messageId?: number
) {
  const cfg = await getGroupConfig(db, chatId);
  const enabled = cfg?.enabled ?? 0;
  const autoScan = cfg?.auto_scan ?? 1;
  const notify = cfg?.notify_channel ?? 1;

  const text =
    `⚙️ <b>GhostSweeper Settings</b>\n\n` +
    `Configure how GhostSweeper works in this group.`;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: enabled ? "✅ Bot Enabled" : "❌ Bot Disabled",
          callback_data: `toggle_enabled_${enabled ? "off" : "on"}`,
        },
      ],
      [
        {
          text: autoScan ? "🔄 Passive Check: ON" : "⏸ Passive Check: OFF",
          callback_data: `toggle_passive_${autoScan ? "off" : "on"}`,
        },
      ],
      [
        {
          text: notify ? "🔔 Notify on Remove: ON" : "🔕 Notify on Remove: OFF",
          callback_data: `toggle_notify_${notify ? "off" : "on"}`,
        },
      ],
      [
        { text: "🧹 Run Sweep", callback_data: "sweep_confirm" },
        { text: "📊 Stats", callback_data: "show_stats" },
      ],
      [{ text: "❌ Close", callback_data: "close_menu" }],
    ],
  };

  if (messageId) {
    await editMessageText(token, targetChatId, messageId, text, {
      reply_markup: keyboard,
    });
  } else {
    await sendMessage(token, targetChatId, text, { reply_markup: keyboard });
  }
}

// ── /stats ────────────────────────────────────────────────────────────────────

export async function handleStats(msg: TelegramMessage, env: Env) {
  if (!isGroupChat(msg.chat.type)) {
    await sendMessage(env.BOT_TOKEN, msg.chat.id, "❌ Stats are only available in groups.");
    return;
  }

  const stats = await getGroupStats(env.DB, msg.chat.id);
  const recent = await getRecentRemovals(env.DB, msg.chat.id, 5);

  let text = `📊 <b>GhostSweeper Stats</b>\n<i>${escapeHtml(msg.chat.title ?? "This Group")}</i>\n\n`;

  if (!stats) {
    text += "No sweeps run yet. Use /sweep to start!";
  } else {
    text += `👻 <b>Total removed:</b> ${stats.total_removed}\n`;
    text += `🔍 <b>Total scans:</b> ${stats.total_scans}\n`;
    text += `🕐 <b>Last scan:</b> ${stats.last_scan_at ?? "Never"}\n`;

    if (recent.results && recent.results.length > 0) {
      text += `\n<b>Recent removals:</b>\n`;
      for (const r of recent.results) {
        text += `• User <code>${r.user_id}</code> — ${r.removed_at}\n`;
      }
    }
  }

  await sendMessage(env.BOT_TOKEN, msg.chat.id, text);
}

// ── Callback Query Handler ────────────────────────────────────────────────────

export async function handleCallbackQuery(
  cq: TelegramCallbackQuery,
  env: Env
) {
  const data = cq.data ?? "";
  const chatId = cq.message?.chat.id;
  const messageId = cq.message?.message_id;
  const userId = cq.from.id;

  if (!chatId || !messageId) {
    await answerCallbackQuery(env.BOT_TOKEN, cq.id, "❌ Unknown context");
    return;
  }

  const isAdmin = await isUserAdmin(env.BOT_TOKEN, chatId, userId);
  if (!isAdmin) {
    await answerCallbackQuery(env.BOT_TOKEN, cq.id, "🚫 Admins only!", true);
    return;
  }

  if (data === "sweep_cancel") {
    await editMessageText(env.BOT_TOKEN, chatId, messageId, "❌ Sweep cancelled.");
    await answerCallbackQuery(env.BOT_TOKEN, cq.id, "Cancelled");
    return;
  }

  if (data === "close_menu") {
    await deleteMessage(env.BOT_TOKEN, chatId, messageId);
    await answerCallbackQuery(env.BOT_TOKEN, cq.id);
    return;
  }

  if (data === "open_settings") {
    await answerCallbackQuery(env.BOT_TOKEN, cq.id);
    await sendSettingsMenu(env.BOT_TOKEN, env.DB, chatId, chatId, messageId);
    return;
  }

  if (data === "show_stats") {
    await answerCallbackQuery(env.BOT_TOKEN, cq.id);
    const stats = await getGroupStats(env.DB, chatId);
    let text = `📊 <b>GhostSweeper Stats</b>\n\n`;
    if (!stats) {
      text += "No sweeps yet!";
    } else {
      text += `👻 Total removed: <b>${stats.total_removed}</b>\n`;
      text += `🔍 Total scans: <b>${stats.total_scans}</b>\n`;
      text += `🕐 Last scan: <b>${stats.last_scan_at}</b>`;
    }
    await editMessageText(env.BOT_TOKEN, chatId, messageId, text, {
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: "open_settings" }]],
      },
    });
    return;
  }

  if (data === "sweep_confirm") {
    await answerCallbackQuery(env.BOT_TOKEN, cq.id, "🧹 Starting sweep...");

    const cfg = await getGroupConfig(env.DB, chatId);
    if (!cfg || !cfg.enabled) {
      await editMessageText(
        env.BOT_TOKEN,
        chatId,
        messageId,
        "⚠️ Bot is disabled. Enable it in /settings."
      );
      return;
    }

    // Load pending member IDs
    const pending = await getPendingScan(env.DB, chatId);
    const memberIds: number[] = pending
      ? (JSON.parse(pending.member_ids) as number[])
      : [];

    if (memberIds.length === 0) {
      await editMessageText(
        env.BOT_TOKEN,
        chatId,
        messageId,
        `🤔 <b>No members tracked yet.</b>\n\nI track members as they interact with the group. Give it some time, or wait for members to send messages.\n\n💡 <i>Passive mode is active: any deleted account that sends a message will be removed instantly.</i>`
      );
      return;
    }

    await editMessageText(
      env.BOT_TOKEN,
      chatId,
      messageId,
      `⏳ <b>Sweeping...</b>\n\nChecking ${memberIds.length} members. This may take a moment...`
    );

    const start = Date.now();
    const title = cq.message?.chat.title ?? "Unknown";
    const result = await sweepGroup(
      env.BOT_TOKEN,
      env.DB,
      chatId,
      title,
      memberIds,
      chatId
    );
    const duration = Date.now() - start;

    if (pending) await deletePendingScan(env.DB, pending.scan_id);

    const report = buildSweepReport(title, result, duration);
    await editMessageText(env.BOT_TOKEN, chatId, messageId, report, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔄 Sweep Again", callback_data: "sweep_confirm" }],
          [{ text: "⚙️ Settings", callback_data: "open_settings" }],
        ],
      },
    });
    return;
  }

  // Settings toggles
  if (data.startsWith("toggle_enabled_")) {
    const enable = data.endsWith("on");
    await toggleGroup(env.DB, chatId, enable);
    await answerCallbackQuery(
      env.BOT_TOKEN,
      cq.id,
      enable ? "✅ Bot enabled!" : "⏸ Bot disabled"
    );
    await sendSettingsMenu(env.BOT_TOKEN, env.DB, chatId, chatId, messageId);
    return;
  }

  if (data.startsWith("toggle_passive_")) {
    const enable = data.endsWith("on");
    await toggleAutoScan(env.DB, chatId, enable);
    await answerCallbackQuery(
      env.BOT_TOKEN,
      cq.id,
      enable ? "🔄 Passive check ON" : "⏸ Passive check OFF"
    );
    await sendSettingsMenu(env.BOT_TOKEN, env.DB, chatId, chatId, messageId);
    return;
  }

  if (data.startsWith("toggle_notify_")) {
    const enable = data.endsWith("on");
    await toggleNotify(env.DB, chatId, enable);
    await answerCallbackQuery(
      env.BOT_TOKEN,
      cq.id,
      enable ? "🔔 Notifications ON" : "🔕 Notifications OFF"
    );
    await sendSettingsMenu(env.BOT_TOKEN, env.DB, chatId, chatId, messageId);
    return;
  }

  await answerCallbackQuery(env.BOT_TOKEN, cq.id);
}

// ── Member tracking (passive) ─────────────────────────────────────────────────

export async function trackMember(
  db: D1Database,
  chatId: number,
  userId: number
) {
  // Keep a deduplicated list of seen user IDs per chat
  const pending = await getPendingScan(db, chatId);
  let ids: number[] = pending ? (JSON.parse(pending.member_ids) as number[]) : [];

  if (!ids.includes(userId)) {
    ids.push(userId);
    if (pending) await deletePendingScan(db, pending.scan_id);
    await savePendingScan(db, chatId, ids);
  }
}
