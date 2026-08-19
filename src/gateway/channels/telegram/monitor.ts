import { isChatAllowed, isUserAllowed } from './access.js';
import { sendTelegramReply } from './outbound.js';
import { pollTelegramUpdates } from './poller.js';
import type { DailyRunCounter } from './rate-limit.js';
import type {
  TelegramAllowedChat,
  TelegramApi,
  TelegramInboundMessage,
  TelegramUpdate,
} from './types.js';

export const DAILY_CAP_REPLY = 'daily run cap reached';

export type TelegramMonitorParams = {
  api: TelegramApi;
  accountId: string;
  abortSignal: AbortSignal;
  allowedUserIds: number[];
  allowedChats: TelegramAllowedChat[];
  runCounter: DailyRunCounter;
  onMessage: (msg: TelegramInboundMessage) => Promise<void>;
  log?: (msg: string) => void;
  timeoutSeconds?: number;
  errorDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Filter one batch of updates and dispatch the survivors:
 * - non-text updates are skipped;
 * - senders outside `telegramAllowedUserIds` are ignored silently (logged only);
 * - group/channel chats must match `telegramAllowedChats` (off unless configured);
 * - past the daily run cap the sender gets DAILY_CAP_REPLY instead of a run.
 */
export async function handleTelegramUpdates(
  params: TelegramMonitorParams,
  updates: TelegramUpdate[],
): Promise<void> {
  const log = params.log ?? (() => {});
  for (const update of updates) {
    const message = update.message;
    if (!message) {
      continue;
    }
    const text = message.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      continue;
    }
    const senderId = message.from?.id;
    const chatId = message.chat.id;
    const chatType = message.chat.type;
    const threadId = message.message_thread_id;
    const chatLabel = threadId !== undefined ? `${chatId}#${threadId}` : `${chatId}`;

    if (!isUserAllowed(senderId, params.allowedUserIds)) {
      log(`[telegram] ignoring message from unlisted user ${senderId ?? 'unknown'} in chat ${chatLabel}`);
      continue;
    }
    if (!isChatAllowed({ chatId, chatType, threadId }, params.allowedChats)) {
      log(`[telegram] ignoring message in unlisted chat ${chatLabel}`);
      continue;
    }

    const reply = (replyText: string) =>
      sendTelegramReply(params.api, { chatId, text: replyText, threadId, log });

    if (!params.runCounter.tryConsume()) {
      log(`[telegram] daily run cap reached; not dispatching (chat ${chatLabel})`);
      try {
        await reply(DAILY_CAP_REPLY);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`[telegram] failed to send cap notice: ${msg}`);
      }
      continue;
    }

    const inbound: TelegramInboundMessage = {
      accountId: params.accountId,
      chatId,
      chatType,
      senderId: senderId as number,
      senderName: message.from?.username ?? message.from?.first_name,
      threadId,
      body: text,
      timestamp: message.date !== undefined ? message.date * 1000 : undefined,
      reply,
      sendTyping: async () => {
        try {
          await params.api.sendChatAction({ chatId, action: 'typing', threadId });
        } catch {
          // typing indicator is best-effort
        }
      },
    };

    try {
      await params.onMessage(inbound);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[telegram] message handler error: ${msg}`);
    }
  }
}

/** Long-poll the Bot API and feed each batch through handleTelegramUpdates. */
export async function monitorTelegramChannel(params: TelegramMonitorParams): Promise<void> {
  await pollTelegramUpdates({
    api: params.api,
    abortSignal: params.abortSignal,
    log: params.log,
    timeoutSeconds: params.timeoutSeconds,
    errorDelayMs: params.errorDelayMs,
    sleep: params.sleep,
    onUpdates: (updates) => handleTelegramUpdates(params, updates),
  });
}
