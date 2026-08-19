import { markdownToTelegramHtml } from './format.js';
import { splitTelegramMessage, TELEGRAM_MAX_MESSAGE_CHARS } from './split.js';
import type { TelegramApi } from './types.js';

/**
 * Send a reply into the originating chat, passing the forum-topic thread id
 * through on every chunk when present, and splitting texts that exceed
 * Telegram's 4096-char message limit.
 *
 * Formatting: the PLAIN text is split first at the existing boundaries, then
 * each chunk is converted to Telegram HTML independently and sent with
 * parse_mode: 'HTML'. A marker pair severed by a chunk boundary simply fails
 * to match in either chunk and renders as literal text — the converter never
 * emits an unclosed tag, so no chunk can carry a dangling entity across the
 * split. Two fallbacks keep delivery ahead of prettiness:
 *   - a chunk whose HTML conversion exceeds 4096 chars (escaping and tags add
 *     length) is sent as the original plain chunk without parse_mode;
 *   - a sendMessage error with parse_mode set (Telegram 400s on entities it
 *     dislikes) retries that chunk once as plain text without parse_mode.
 * Both fallbacks are logged.
 */
export async function sendTelegramReply(
  api: Pick<TelegramApi, 'sendMessage'>,
  params: { chatId: number; text: string; threadId?: number; log?: (msg: string) => void },
): Promise<void> {
  const log = params.log ?? (() => {});
  const text = params.text.trim();
  if (!text) {
    return;
  }
  for (const chunk of splitTelegramMessage(text)) {
    const html = markdownToTelegramHtml(chunk);
    if (html.length > TELEGRAM_MAX_MESSAGE_CHARS) {
      log(
        `[telegram] converted chunk is ${html.length} chars (> ${TELEGRAM_MAX_MESSAGE_CHARS}); sending plain text`,
      );
      await api.sendMessage({ chatId: params.chatId, text: chunk, threadId: params.threadId });
      continue;
    }
    try {
      await api.sendMessage({
        chatId: params.chatId,
        text: html,
        threadId: params.threadId,
        parseMode: 'HTML',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[telegram] HTML send failed (${msg}); retrying chunk as plain text`);
      await api.sendMessage({ chatId: params.chatId, text: chunk, threadId: params.threadId });
    }
  }
}
