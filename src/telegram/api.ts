const BASE = "https://api.telegram.org/bot";

export async function callTelegram<T = unknown>(
  token: string,
  method: string,
  body: Record<string, unknown> = {}
): Promise<{ ok: boolean; result?: T; description?: string }> {
  const res = await fetch(`${BASE}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ ok: boolean; result?: T; description?: string }>;
}

export async function sendMessage(
  token: string,
  chatId: number | string,
  text: string,
  extra: Record<string, unknown> = {}
) {
  return callTelegram(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

export async function getChatMember(
  token: string,
  chatId: number | string,
  userId: number
) {
  return callTelegram<{
    status: string;
    user: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
  }>(token, "getChatMember", { chat_id: chatId, user_id: userId });
}

export async function getChatAdministrators(
  token: string,
  chatId: number | string
) {
  return callTelegram<
    Array<{
      status: string;
      user: { id: number; is_bot: boolean; first_name: string; username?: string };
    }>
  >(token, "getChatAdministrators", { chat_id: chatId });
}

export async function kickChatMember(
  token: string,
  chatId: number | string,
  userId: number
) {
  // unbanChatMember right after ban = kick (no blacklist)
  const ban = await callTelegram(token, "banChatMember", {
    chat_id: chatId,
    user_id: userId,
    revoke_messages: false,
  });
  if (ban.ok) {
    await callTelegram(token, "unbanChatMember", {
      chat_id: chatId,
      user_id: userId,
      only_if_banned: true,
    });
  }
  return ban;
}

export async function getChat(token: string, chatId: number | string) {
  return callTelegram<{
    id: number;
    title?: string;
    username?: string;
    type: string;
    member_count?: number;
  }>("", "getChat", {}); // unused, kept for future
}

export async function getChatMemberCount(
  token: string,
  chatId: number | string
) {
  return callTelegram<number>(token, "getChatMemberCount", { chat_id: chatId });
}

export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
  showAlert = false
) {
  return callTelegram(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });
}

export async function editMessageText(
  token: string,
  chatId: number | string,
  messageId: number,
  text: string,
  extra: Record<string, unknown> = {}
) {
  return callTelegram(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

export async function deleteMessage(
  token: string,
  chatId: number | string,
  messageId: number
) {
  return callTelegram(token, "deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
}

export async function getBotInfo(token: string) {
  return callTelegram<{ id: number; username: string; first_name: string }>(
    token,
    "getMe",
    {}
  );
}
