const BASE = "https://api.telegram.org/bot";

export async function callTelegram<T = unknown>(
  token: string, method: string, body: Record<string, unknown> = {}, retries = 2
): Promise<{ ok: boolean; result?: T; description?: string }> {
  try {
    const res = await fetch(`${BASE}${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 429 && retries > 0) {
      const data = await res.json() as { parameters?: { retry_after?: number } };
      const wait = (data.parameters?.retry_after ?? 1) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      return callTelegram(token, method, body, retries - 1);
    }

    return res.json() as Promise<{ ok: boolean; result?: T; description?: string }>;
  } catch (err) {
    return { ok: false, description: err instanceof Error ? err.message : "Network error" };
  }
}

export async function sendMessage(token: string, chatId: number | string, text: string, extra: Record<string, unknown> = {}) {
  return callTelegram(token, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}

export async function getChatMember(token: string, chatId: number | string, userId: number) {
  return callTelegram<{ status: string; user: { id: number; is_bot: boolean; first_name: string; username?: string; }; }>(
    token, "getChatMember", { chat_id: chatId, user_id: userId }
  );
}

export async function getChatAdministrators(token: string, chatId: number | string) {
  return callTelegram<Array<{ status: string; user: { id: number; is_bot: boolean; first_name: string; username?: string }; }>>(
    token, "getChatAdministrators", { chat_id: chatId }
  );
}

export async function kickChatMember(token: string, chatId: number | string, userId: number) {
  const ban = await callTelegram(token, "banChatMember", { chat_id: chatId, user_id: userId, revoke_messages: false });
  if (ban.ok) await callTelegram(token, "unbanChatMember", { chat_id: chatId, user_id: userId, only_if_banned: true });
  return ban;
}

export async function answerCallbackQuery(token: string, callbackQueryId: string, text?: string, showAlert = false) {
  return callTelegram(token, "answerCallbackQuery", { callback_query_id: callbackQueryId, text, show_alert: showAlert });
}

export async function editMessageText(token: string, chatId: number | string, messageId: number, text: string, extra: Record<string, unknown> = {}) {
  return callTelegram(token, "editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", ...extra });
}

export async function deleteMessage(token: string, chatId: number | string, messageId: number) {
  return callTelegram(token, "deleteMessage", { chat_id: chatId, message_id: messageId });
}

export async function getBotInfo(token: string) {
  return callTelegram<{ id: number; username: string; first_name: string }>(token, "getMe", {});
}
