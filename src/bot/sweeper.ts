import {
  callTelegram,
  getChatAdministrators,
  getChatMemberCount,
  kickChatMember,
  sendMessage,
} from "../telegram/api";
import { logRemoval, incrementStats, setBotAdmin } from "../db/queries";
import type { Env } from "../index";

// A "deleted account" in Telegram has first_name === "" (empty string)
// and the user object has no username or last_name.
export function isDeletedAccount(user: {
  first_name: string;
  last_name?: string;
  username?: string;
  is_bot: boolean;
}): boolean {
  return (
    !user.is_bot &&
    (user.first_name === "" ||
      user.first_name === null ||
      user.first_name === undefined ||
      String(user.first_name).trim() === "")
  );
}

// Fetch all members of a supergroup by iterating chat member IDs
// Telegram doesn't expose a getMembers API for regular use, so we use
// getChatAdministrators to get admin list, then check join updates from DB.
// For a full sweep, we rely on the member list stored during join events.
export async function sweepGroup(
  token: string,
  db: D1Database,
  chatId: number,
  chatTitle: string,
  memberIds: number[],
  reportChatId?: number
): Promise<{ removed: number; checked: number; errors: number }> {
  let removed = 0;
  let errors = 0;
  const checked = memberIds.length;

  // Check bot admin status
  const admins = await getChatAdministrators(token, chatId);
  if (!admins.ok || !admins.result) {
    return { removed: 0, checked: 0, errors: 1 };
  }

  const botInfo = await callTelegram<{ id: number }>(token, "getMe", {});
  const botId = botInfo.result?.id;
  const botAdmin = admins.result.find(
    (a) => a.user.id === botId && a.status === "administrator"
  );

  await setBotAdmin(db, chatId, !!botAdmin);

  if (!botAdmin) {
    if (reportChatId) {
      await sendMessage(
        token,
        reportChatId,
        "⚠️ <b>Not enough permissions.</b>\nPlease promote me to admin with <i>Remove Members</i> permission."
      );
    }
    return { removed: 0, checked: 0, errors: 1 };
  }

  const BATCH = 8; // Telegram rate: ~30 requests/sec conservative
  for (let i = 0; i < memberIds.length; i += BATCH) {
    const batch = memberIds.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (userId) => {
        try {
          const member = await callTelegram<{
            status: string;
            user: {
              id: number;
              is_bot: boolean;
              first_name: string;
              username?: string;
            };
          }>(token, "getChatMember", { chat_id: chatId, user_id: userId });

          if (!member.ok || !member.result) return false;

          const { status, user } = member.result;

          // Skip if already left/kicked/banned
          if (["left", "kicked", "banned"].includes(status)) return false;

          if (isDeletedAccount(user)) {
            const kicked = await kickChatMember(token, chatId, userId);
            if (kicked.ok) {
              await logRemoval(db, chatId, userId, "deleted_account");
              return true;
            }
          }
          return false;
        } catch {
          errors++;
          return false;
        }
      })
    );
    removed += results.filter(Boolean).length;

    // Small pause between batches to respect rate limits
    if (i + BATCH < memberIds.length) {
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  await incrementStats(db, chatId, chatTitle, removed);
  return { removed, checked, errors };
}

// Check a single user when they send a message (passive sweep)
export async function passiveCheck(
  token: string,
  db: D1Database,
  chatId: number,
  chatTitle: string,
  user: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  }
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

// Format sweep result message
export function buildSweepReport(
  chatTitle: string,
  result: { removed: number; checked: number; errors: number },
  durationMs: number
): string {
  const dur = (durationMs / 1000).toFixed(1);
  const ghost = result.removed === 1 ? "ghost" : "ghosts";

  let msg = `🧹 <b>Sweep Complete!</b>\n\n`;
  msg += `📍 <b>Group:</b> ${escapeHtml(chatTitle)}\n`;
  msg += `👥 <b>Members checked:</b> ${result.checked}\n`;
  msg += `👻 <b>Deleted accounts removed:</b> ${result.removed}\n`;
  if (result.errors > 0) {
    msg += `⚠️ <b>Errors:</b> ${result.errors}\n`;
  }
  msg += `⏱ <b>Duration:</b> ${dur}s\n\n`;

  if (result.removed === 0) {
    msg += `✅ Your group is clean! No ${ghost} found.`;
  } else {
    msg += `🫧 Removed <b>${result.removed}</b> ${ghost} from your group.\nYour community is cleaner now! 🌟`;
  }

  return msg;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
