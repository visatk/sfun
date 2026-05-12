import {
  handleStart,
  handleHelp,
  handleSweep,
  handleSettings,
  handleStats,
  handleCallbackQuery,
  trackMember,
} from "./commands";
import { passiveCheck } from "./sweeper";
import { getGroupConfig, upsertGroupConfig } from "../db/queries";
import { sendMessage } from "../telegram/api";
import type { TelegramUpdate } from "../telegram/types";
import type { Env } from "../index";

export async function handleUpdate(update: TelegramUpdate, env: Env) {
  try {
    // ── Callback queries ──────────────────────────────────────────────────
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, env);
      return;
    }

    // ── Bot added to / removed from group ─────────────────────────────────
    if (update.my_chat_member) {
      const { chat, new_chat_member, from } = update.my_chat_member;
      const isGroup = chat.type === "group" || chat.type === "supergroup";

      if (isGroup && new_chat_member.status === "administrator") {
        // Bot promoted to admin
        await upsertGroupConfig(env.DB, chat.id, chat.title ?? "Unknown", from.id);
        await sendMessage(
          env.BOT_TOKEN,
          chat.id,
          `👻 <b>GhostSweeper activated!</b>\n\n` +
            `I'm now set up as admin and ready to keep this group clean.\n\n` +
            `• Passive mode is <b>ON</b> — deleted accounts will be removed as they interact.\n` +
            `• Use /sweep for a full group scan.\n` +
            `• Use /settings to configure me.`
        );
      } else if (
        isGroup &&
        ["member", "restricted"].includes(new_chat_member.status)
      ) {
        // Bot added but not admin yet
        await upsertGroupConfig(env.DB, chat.id, chat.title ?? "Unknown", from.id);
        await sendMessage(
          env.BOT_TOKEN,
          chat.id,
          `👋 <b>GhostSweeper here!</b>\n\n` +
            `To remove deleted accounts, I need to be promoted to <b>Admin</b> with the <i>"Remove Members"</i> permission.\n\n` +
            `Once promoted, use /sweep or /start to get going!`
        );
      } else if (
        isGroup &&
        ["left", "kicked"].includes(new_chat_member.status)
      ) {
        // Bot removed - clean up
        await env.DB.prepare(
          "UPDATE group_config SET enabled = 0 WHERE chat_id = ?"
        )
          .bind(chat.id)
          .run();
      }
      return;
    }

    // ── Messages ──────────────────────────────────────────────────────────
    if (!update.message) return;
    const msg = update.message;
    const text = msg.text ?? "";
    const from = msg.from;
    const chat = msg.chat;
    const isGroup = chat.type === "group" || chat.type === "supergroup";

    // ── Command routing ───────────────────────────────────────────────────
    if (text.startsWith("/start")) {
      await handleStart(msg, env);
      return;
    }
    if (text.startsWith("/help")) {
      await handleHelp(msg, env);
      return;
    }
    if (text.startsWith("/sweep")) {
      await handleSweep(msg, env);
      return;
    }
    if (text.startsWith("/settings")) {
      await handleSettings(msg, env);
      return;
    }
    if (text.startsWith("/stats")) {
      await handleStats(msg, env);
      return;
    }

    // ── Passive scanning in groups ────────────────────────────────────────
    if (isGroup && from && !from.is_bot) {
      const cfg = await getGroupConfig(env.DB, chat.id);

      // Auto-register group if not yet known
      if (!cfg) {
        await upsertGroupConfig(env.DB, chat.id, chat.title ?? "Unknown", from.id);
      }

      // Track member for future sweeps
      await trackMember(env.DB, chat.id, from.id);

      // Passive check: quietly remove if deleted account
      const isEnabled = cfg?.enabled ?? 1;
      const autoScan = cfg?.auto_scan ?? 1;

      if (isEnabled && autoScan) {
        const wasRemoved = await passiveCheck(
          env.BOT_TOKEN,
          env.DB,
          chat.id,
          chat.title ?? "Unknown",
          from
        );

        if (wasRemoved && (cfg?.notify_channel ?? 1)) {
          await sendMessage(
            env.BOT_TOKEN,
            chat.id,
            `🫧 Removed 1 deleted account. Group is cleaner! 👻`
          );
        }
      }
    }
  } catch (err) {
    console.error("[GhostSweeper] Error handling update:", err);
  }
}
