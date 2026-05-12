import {
  sendMessage,
  getChatAdministrators,
  answerCallbackQuery,
  editMessageText,
  deleteMessage,
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
import type { ExecutionContext } from "@cloudflare/workers-types";

// ── Permission guards ─────────────────────────────────────────────────────────

async function isUserAdmin(token: string, chatId: number, userId: number): Promise<boolean> {
  const admins = await getChatAdministrators(token, chatId);
  if (!admins.ok || !admins.result) return false;
  return admins.result.some(
    (a) => a.user.id === userId && ["administrator", "creator"].includes(a.status)
  );
}

function isGroupChat(type: string): boolean {
  return type === "group" || type === "supergroup";
}

// ── Commands ──────────────────────────────────────────────────────────────────

export async function handleStart(msg: TelegramMessage, env: Env) {
  if (!isGroupChat(msg.chat.type)) {
    await sendMessage(
      env.BOT_TOKEN,
      msg.chat.id,
      `👻 <b>GhostSweeper Bot</b>\n\nI remove deleted Telegram accounts from your groups automatically.\n\nAdd me to your group, make me an <b>Admin</b>, and use /sweep.`
    );
    return;
  }

  if (!msg.from) return;
  if (!(await isUserAdmin(env.BOT_TOKEN, msg.chat.id, msg.from.id))) {
    await sendMessage(env.BOT_TOKEN, msg.chat.id, "🚫 Only group admins can use this bot.");
    return;
  }

  const cfg = await getGroupConfig(env.DB, msg.chat.id);
  if (!cfg) await upsertGroupConfig(env.DB, msg.chat.id, msg.chat.title ?? "Unknown", msg.from.id);

  await sendMessage(
    env.BOT_TOKEN,
    msg.chat.id,
    `👻 <b>GhostSweeper is ready!</b>\n\nI'll help keep this group clean from deleted accounts.\n\n💡 <i>Passive mode is active.</i>`,
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

export async function handleHelp(msg: TelegramMessage, env: Env) {
  await sendMessage(
    env.BOT_TOKEN,
    msg.chat.id,
    `<b>👻 GhostSweeper — Help</b>\n\n<b>Commands:</b>\n/start — Initialise bot\n/sweep — Scan & remove deleted accounts\n/settings — Toggle features\n/stats — Show statistics\n/help — Show help`
  );
}

export async function handleSweep(msg: TelegramMessage, env: Env) {
  if (!isGroupChat(msg.chat.type)) return;
  if (!msg.from) return;

  if (!(await isUserAdmin(env.BOT_TOKEN, msg.chat.id, msg.from.id))) {
    await sendMessage(env.BOT_TOKEN, msg.chat.id, "🚫 Only group admins can run a sweep.");
    return;
  }

  const cfg = await getGroupConfig(env.DB, msg.chat.id);
  if (!cfg || !cfg.enabled) {
    await sendMessage(env.BOT_TOKEN, msg.chat.id, "⚠️ Bot is disabled for this group. Use /settings to enable it.");
    return;
  }

  await sendMessage(
    env.BOT_TOKEN,
    msg.chat.id,
    `🔍 <b>Ready to sweep!</b>\n\nThis will check all tracked members and remove any deleted accounts.`,
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

export async function handleSettings(msg: TelegramMessage, env: Env) {
  if (!isGroupChat(msg.chat.type) || !msg.from) return;
  if (!(await isUserAdmin(env.BOT_TOKEN, msg.chat.id, msg.from.id))) return;
  await sendSettingsMenu(env.BOT_TOKEN, env.DB, msg.chat.id, msg.chat.id);
}

export async function handleStats(msg: TelegramMessage, env: Env) {
  if (!isGroupChat(msg.chat.type)) return;

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
      for (const r of recent.results) text += `• User <code>${r.user_id}</code> — ${r.removed_at}\n`;
    }
  }

  await sendMessage(env.BOT_TOKEN, msg.chat.id, text);
}

// ── Menu Helpers ──────────────────────────────────────────────────────────────

async function sendSettingsMenu(token: string, db: D1Database, chatId: number, targetChatId: number, messageId?: number) {
  const cfg = await getGroupConfig(db, chatId);
  const enabled = cfg?.enabled ?? 0;
  const autoScan = cfg?.auto_scan ?? 1;
  const notify = cfg?.notify_channel ?? 1;

  const text = `⚙️ <b>GhostSweeper Settings</b>\n\nConfigure how GhostSweeper works in this group.`;
  const keyboard = {
    inline_keyboard: [
      [{ text: enabled ? "✅ Bot Enabled" : "❌ Bot Disabled", callback_data: `toggle_enabled_${enabled ? "off" : "on"}` }],
      [{ text: autoScan ? "🔄 Passive Check: ON" : "⏸ Passive Check: OFF", callback_data: `toggle_passive_${autoScan ? "off" : "on"}` }],
      [{ text: notify ? "🔔 Notify on Remove: ON" : "🔕 Notify on Remove: OFF", callback_data: `toggle_notify_${notify ? "off" : "on"}` }],
      [
        { text: "🧹 Run Sweep", callback_data: "sweep_confirm" },
        { text: "📊 Stats", callback_data: "show_stats" },
      ],
      [{ text: "❌ Close", callback_data: "close_menu" }],
    ],
  };

  if (messageId) {
    await editMessageText(token, targetChatId, messageId, text, { reply_markup: keyboard });
  } else {
    await sendMessage(token, targetChatId, text, { reply_markup: keyboard });
  }
}

// ── Callback Query (Async execution via ctx.waitUntil) ────────────────────────

export async function handleCallbackQuery(cq: TelegramCallbackQuery, env: Env, ctx: ExecutionContext) {
  const data = cq.data ?? "";
  const chatId = cq.message?.chat.id;
  const messageId = cq.message?.message_id;
  const userId = cq.from.id;

  if (!chatId || !messageId) {
    await answerCallbackQuery(env.BOT_TOKEN, cq.id, "❌ Unknown context");
    return;
  }

  if (!(await isUserAdmin(env.BOT_TOKEN, chatId, userId))) {
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
    if (!stats) text += "No sweeps yet!";
    else {
      text += `👻 Total removed: <b>${stats.total_removed}</b>\n🔍 Total scans: <b>${stats.total_scans}</b>\n🕐 Last scan: <b>${stats.last_scan_at}</b>`;
    }
    await editMessageText(env.BOT_TOKEN, chatId, messageId, text, {
      reply_markup: { inline_keyboard: [[{ text: "⬅️ Back", callback_data: "open_settings" }]] },
    });
    return;
  }

  if (data === "sweep_confirm") {
    await answerCallbackQuery(env.BOT_TOKEN, cq.id, "🧹 Initializing edge sweep...");

    const cfg = await getGroupConfig(env.DB, chatId);
    if (!cfg || !cfg.enabled) {
      await editMessageText(env.BOT_TOKEN, chatId, messageId, "⚠️ Bot is disabled. Enable it in /settings.");
      return;
    }

    const pending = await getPendingScan(env.DB, chatId);
    const memberIds: number[] = pending ? (JSON.parse(pending.member_ids) as number[]) : [];

    if (memberIds.length === 0) {
      await editMessageText(
        env.BOT_TOKEN, chatId, messageId,
        `🤔 <b>No members tracked yet.</b>\n\nI track members as they interact. Passive mode is active in the meantime.`
      );
      return;
    }

    await editMessageText(
      env.BOT_TOKEN, chatId, messageId,
      `⏳ <b>Sweeping in background...</b>\n\nChecking ${memberIds.length} members. This may take a moment. You can safely close this menu.`
    );

    // Context execution offload
    ctx.waitUntil(
      (async () => {
        const start = Date.now();
        const title = cq.message?.chat.title ?? "Unknown";
        
        const result = await sweepGroup(env.BOT_TOKEN, env.DB, chatId, title, memberIds, chatId);
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
      })()
    );
    return;
  }

  // Toggles
  if (data.startsWith("toggle_enabled_")) {
    const enable = data.endsWith("on");
    await toggleGroup(env.DB, chatId, enable);
    await answerCallbackQuery(env.BOT_TOKEN, cq.id, enable ? "✅ Bot enabled!" : "⏸ Bot disabled");
    await sendSettingsMenu(env.BOT_TOKEN, env.DB, chatId, chatId, messageId);
    return;
  }

  if (data.startsWith("toggle_passive_")) {
    const enable = data.endsWith("on");
    await toggleAutoScan(env.DB, chatId, enable);
    await answerCallbackQuery(env.BOT_TOKEN, cq.id, enable ? "🔄 Passive check ON" : "⏸ Passive check OFF");
    await sendSettingsMenu(env.BOT_TOKEN, env.DB, chatId, chatId, messageId);
    return;
  }

  if (data.startsWith("toggle_notify_")) {
    const enable = data.endsWith("on");
    await toggleNotify(env.DB, chatId, enable);
    await answerCallbackQuery(env.BOT_TOKEN, cq.id, enable ? "🔔 Notifications ON" : "🔕 Notifications OFF");
    await sendSettingsMenu(env.BOT_TOKEN, env.DB, chatId, chatId, messageId);
    return;
  }

  await answerCallbackQuery(env.BOT_TOKEN, cq.id);
}

// ── Tracking ──────────────────────────────────────────────────────────────────

export async function trackMember(db: D1Database, chatId: number, userId: number) {
  const pending = await getPendingScan(db, chatId);
  let ids: number[] = pending ? (JSON.parse(pending.member_ids) as number[]) : [];

  if (!ids.includes(userId)) {
    ids.push(userId);
    if (pending) await deletePendingScan(db, pending.scan_id);
    await savePendingScan(db, chatId, ids);
  }
}
