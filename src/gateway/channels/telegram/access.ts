import type { TelegramAllowedChat, TelegramChatType } from './types.js';

function coerceId(value: unknown): number | undefined {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value.trim())
        : NaN;
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Settings key `telegramAllowedUserIds`: numeric ids, string digits tolerated. */
export function normalizeAllowedUserIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const ids: number[] = [];
  for (const entry of raw) {
    const id = coerceId(entry);
    if (id !== undefined && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

/** Settings key `telegramAllowedChats`: `{ chatId, threadId? }` objects. */
export function normalizeAllowedChats(raw: unknown): TelegramAllowedChat[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: TelegramAllowedChat[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const rec = entry as Record<string, unknown>;
    const chatId = coerceId(rec.chatId ?? rec.chat_id);
    if (chatId === undefined) {
      continue;
    }
    const threadId = coerceId(rec.threadId ?? rec.thread_id ?? rec.message_thread_id);
    out.push(threadId !== undefined ? { chatId, threadId } : { chatId });
  }
  return out;
}

/** An empty allowlist admits no one — the bot never answers strangers. */
export function isUserAllowed(userId: number | undefined, allowedUserIds: number[]): boolean {
  if (userId === undefined) {
    return false;
  }
  return allowedUserIds.includes(userId);
}

/**
 * Private chats are governed by the user allowlist alone. Group and channel
 * chats are off unless `telegramAllowedChats` lists them; an entry without a
 * threadId admits every topic in that chat, an entry with one admits only
 * that topic.
 */
export function isChatAllowed(
  params: { chatId: number; chatType: TelegramChatType; threadId?: number },
  allowedChats: TelegramAllowedChat[],
): boolean {
  if (params.chatType === 'private') {
    return true;
  }
  return allowedChats.some(
    (entry) =>
      entry.chatId === params.chatId &&
      (entry.threadId === undefined || entry.threadId === params.threadId),
  );
}
