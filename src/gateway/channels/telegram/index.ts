/**
 * Telegram channel plugin.
 *
 * Transport: Bot API long polling (getUpdates, 30s timeout) — no webhooks,
 * no browser session, no reconnect machinery. Replies go back into the same
 * chat via sendMessage, split over the 4096-char limit, with forum-topic
 * message_thread_id passed through. The model's markdown-ish output is
 * converted per chunk to Telegram HTML (parse_mode: 'HTML'), falling back to
 * plain text for any chunk Telegram rejects or that outgrows the limit when
 * converted.
 *
 * Access: TELEGRAM_BOT_TOKEN from the environment enables the channel;
 * settings.json supplies telegramAllowedUserIds (required for anyone to get
 * an answer), telegramMaxRunsPerDay (default 10), and the optional
 * telegramAllowedChats for group-topic use.
 */
export * from './types.js';
export { createTelegramApi, type FetchLike } from './api.js';
export { splitTelegramMessage, TELEGRAM_MAX_MESSAGE_CHARS } from './split.js';
export { escapeTelegramHtml, markdownToTelegramHtml } from './format.js';
export {
  isChatAllowed,
  isUserAllowed,
  normalizeAllowedChats,
  normalizeAllowedUserIds,
} from './access.js';
export {
  createDailyRunCounter,
  DEFAULT_TELEGRAM_MAX_RUNS_PER_DAY,
  type DailyRunCounter,
} from './rate-limit.js';
export { nextOffset, pollTelegramUpdates } from './poller.js';
export { sendTelegramReply } from './outbound.js';
export { DAILY_CAP_REPLY, handleTelegramUpdates, monitorTelegramChannel } from './monitor.js';
export { handleTelegramInbound } from './dispatch.js';
export {
  createTelegramPlugin,
  getTelegramBotToken,
  resolveTelegramMaxRunsPerDay,
  TELEGRAM_TOKEN_ENV,
} from './plugin.js';
export { maybeCreateTelegramManager } from './register.js';
