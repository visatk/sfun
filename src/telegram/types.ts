export interface TelegramUser {
  id: number; is_bot: boolean; first_name: string; last_name?: string; username?: string;
}

export interface TelegramChat {
  id: number; type: "private" | "group" | "supergroup" | "channel"; title?: string; username?: string;
}

export interface TelegramMessage {
  message_id: number; from?: TelegramUser; chat: TelegramChat; date: number; text?: string;
  new_chat_members?: TelegramUser[]; left_chat_member?: TelegramUser; reply_to_message?: TelegramMessage;
}

export interface TelegramCallbackQuery {
  id: string; from: TelegramUser; message?: TelegramMessage; data?: string;
}

export interface TelegramChatMemberUpdated {
  chat: TelegramChat; from: TelegramUser; date: number;
  old_chat_member: { status: string; user: TelegramUser }; new_chat_member: { status: string; user: TelegramUser };
}

export interface TelegramUpdate {
  update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery;
  my_chat_member?: TelegramChatMemberUpdated; chat_member?: TelegramChatMemberUpdated;
}
