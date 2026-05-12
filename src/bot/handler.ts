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
import type { ExecutionContext } from "@cloudflare/workers-types";

export async function handleUpdate(update: TelegramUpdate, env: Env, ctx: ExecutionContext) {
  try {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, env, ctx);
      return;
    }

    if (update.my_chat_member) {
      const { chat, new_chat_member, from } = update.my_chat_member;
      const isGroup = chat.type === "group" || chat.type === "supergroup";

      if (isGroup && new_chat_member.status === "administrator") {
        await upsertGroupConfig(env.DB, chat.id, chat.title ?? "Unknown", from.id);
        await sendMessage(
          env.BOT_TOKEN,
          chat.id,
          `👻 <b>GhostSweeper activated!</b>\n\nI'm now set up as admin. Passive mode is <b>ON</b>. Use /sweep for a full group scan.`
        );
      } else if (isGroup && ["member", "restricted"].includes(new_chat_member.status)) {
        await upsertGroupConfig(env.DB, chat.id, chat.title ?? "Unknown", from.id);
        await sendMessage(
          env.BOT_TOKEN,
          chat.id,
          `👋 To remove deleted accounts, I need to be promoted to <b>Admin</b> with the <i>"Remove Members"</i> permission.`
        );
      } else if (isGroup && ["left", "kicked"].includes(new_chat_member.status)) {
        await env.DB.prepare("UPDATE group_config SET enabled = 0 WHERE chat_id = ?").bind(chat.id).run();
      }
      return;
    }

    if (!update.message) return;
    const msg = update.message;
    const text = msg.text ?? "";
    const from = msg.from;
    const chat = msg.chat;
    const isGroup = chat.type === "group" || chat.type === "supergroup";

    if (text.startsWith("/start")) return handleStart(msg, env);
    if (text.startsWith("/help")) return handleHelp(msg, env);
    if (text.startsWith("/sweep")) return handleSweep(msg, env);
    if (text.startsWith("/settings")) return handleSettings(msg, env);
    if (text.startsWith("/stats")) return handleStats(msg, env);

    if (isGroup && from && !from.is_bot) {
      ctx.waitUntil(
        (async () => {
          const cfg = await getGroupConfig(env.DB, chat.id) ?? 
                      await upsertGroupConfig(env.DB, chat.id, chat.title ?? "Unknown", from.id);
                      
          await trackMember(env.DB, chat.id, from.id);

          const isEnabled = cfg?.enabled ?? 1;
          const autoScan = cfg?.auto_scan ?? 1;

          if (isEnabled && autoScan) {
            const wasRemoved = await passiveCheck(env.BOT_TOKEN, env.DB, chat.id, chat.title ?? "Unknown", from);
            if (wasRemoved && (cfg?.notify_channel ?? 1)) {
              await sendMessage(env.BOT_TOKEN, chat.id, `🫧 Silently removed 1 deleted account. 👻`);
            }
          }
        })()
      );
    }
  } catch (err) {
    console.error("[GhostSweeper] Error handling update:", err);
  }
}
