import {
  callTelegram,
  getChatAdministrators,
  kickChatMember,
  sendMessage,
} from "../telegram/api";
import { logRemovalsBatch, logRemoval, incrementStats, setBotAdmin } from "../db/queries";

export function isDeletedAccount(user: { first_name: string; is_bot: boolean }): boolean {
  return (
    !user.is_bot &&
    (!user.first_name || String(user.first_name).trim() === "")
  );
}

export async function sweepGroup(
  token: string, db: D1Database, chatId: number, chatTitle: string, memberIds: number[], reportChatId?: number
): Promise<{ removed: number; checked: number; errors: number }> {
  let errors = 0;
  const checked = memberIds.length;
  const removedIds: number[] = [];

  const admins = await getChatAdministrators(token, chatId);
  if (!admins.ok || !admins.result) return { removed: 0, checked: 0, errors: 1 };

  const botInfo = await callTelegram<{ id: number }>(token, "getMe", {});
  const botAdmin = admins.result.find((a) => a.user.id === botInfo.result?.id && a.status === "administrator");

  await setBotAdmin(db, chatId, !!botAdmin);

  if (!botAdmin) {
    if (reportChatId) {
      await sendMessage(token, reportChatId, "⚠️ <b>Not enough permissions.</b>\nPlease promote me to admin with <i>Remove Members</i> permission.");
    }
    return { removed: 0, checked: 0, errors: 1 };
  }

  const BATCH = 8;
  for (let i = 0; i < memberIds.length; i += BATCH) {
    const batch = memberIds.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (userId) => {
        try {
          const member = await callTelegram<{ status: string; user: { id: number; is_bot: boolean; first_name: string } }>(
            token, "getChatMember", { chat_id: chatId, user_id: userId }
          );

          if (!member.ok || !member.result) return;
          if (["left", "kicked", "banned"].includes(member.result.status)) return;

          if (isDeletedAccount(member.result.user)) {
            const kicked = await kickChatMember(token, chatId, userId);
            if (kicked.ok) removedIds.push(userId);
          }
        } catch {
          errors++;
        }
      })
    );

    if (i + BATCH < memberIds.length) await new Promise((r) => setTimeout(r, 350));
  }

  if (removedIds.length > 0) {
    await logRemovalsBatch(db, chatId, removedIds, "deleted_account");
  }
  await incrementStats(db, chatId, chatTitle, removedIds.length);

  return { removed: removedIds.length, checked, errors };
}

export async function passiveCheck(
  token: string, db: D1Database, chatId: number, chatTitle: string, user: { id: number; is_bot: boolean; first_name: string }
): Promise<boolean> {
  if (isDeletedAccount(user)) {
    const kicked = await kickChatMember(token, chatId, user.id);
    if (kicked.ok) {
      await logRemoval(db, chatId, user.id, "passive_check");
      await incrementStats(db, chatId, chatTitle, 1);
      return true;
    }
  }
  return false;
}

export function buildSweepReport(chatTitle: string, result: { removed: number; checked: number; errors: number }, durationMs: number): string {
  const dur = (durationMs / 1000).toFixed(1);
  const ghost = result.removed === 1 ? "ghost" : "ghosts";

  let msg = `🧹 <b>Sweep Complete!</b>\n\n`;
  msg += `📍 <b>Group:</b> ${escapeHtml(chatTitle)}\n`;
  msg += `👥 <b>Members checked:</b> ${result.checked}\n`;
  msg += `👻 <b>Deleted accounts removed:</b> ${result.removed}\n`;
  if (result.errors > 0) msg += `⚠️ <b>Errors:</b> ${result.errors}\n`;
  msg += `⏱ <b>Duration:</b> ${dur}s\n\n`;

  if (result.removed === 0) {
    msg += `✅ Your group is clean! No ${ghost} found.`;
  } else {
    msg += `🫧 Removed <b>${result.removed}</b> ${ghost} from your group.\nYour community is cleaner now! 🌟`;
  }

  return msg;
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
