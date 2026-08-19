export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramChatType = 'private' | 'group' | 'supergroup' | 'channel';

export type TelegramChat = {
  id: number;
  type: TelegramChatType;
  title?: string;
  username?: string;
};

export type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date?: number;
  text?: string;
  message_thread_id?: number;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

/** One entry of the optional settings key `telegramAllowedChats`. */
export type TelegramAllowedChat = {
  chatId: number;
  threadId?: number;
};

export type TelegramApi = {
  getMe: (signal?: AbortSignal) => Promise<TelegramUser>;
  getUpdates: (params: {
    offset?: number;
    timeoutSeconds: number;
    signal?: AbortSignal;
  }) => Promise<TelegramUpdate[]>;
  sendMessage: (params: {
    chatId: number;
    text: string;
    threadId?: number;
    /** Set to 'HTML' when `text` is Telegram HTML; omit for plain text. */
    parseMode?: 'HTML';
    signal?: AbortSignal;
  }) => Promise<void>;
  sendChatAction: (params: {
    chatId: number;
    action: string;
    threadId?: number;
    signal?: AbortSignal;
  }) => Promise<void>;
};

export type TelegramInboundMessage = {
  accountId: string;
  chatId: number;
  chatType: TelegramChatType;
  senderId: number;
  senderName?: string;
  /** Forum-topic thread id; passed through on every reply when present. */
  threadId?: number;
  body: string;
  timestamp?: number;
  /** Reply into the same chat (and topic), splitting texts over 4096 chars. */
  reply: (text: string) => Promise<void>;
  /** Best-effort typing indicator; never throws. */
  sendTyping: () => Promise<void>;
};

export type TelegramAccountConfig = {
  accountId: string;
  enabled: boolean;
};
