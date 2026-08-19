/** Telegram's hard per-message text limit. */
export const TELEGRAM_MAX_MESSAGE_CHARS = 4096;

/**
 * Split a message into chunks that each fit Telegram's 4096-char limit.
 * Prefers breaking at the last newline inside the window, then the last
 * space, and only hard-cuts when a single run has no break points.
 */
export function splitTelegramMessage(
  text: string,
  limit: number = TELEGRAM_MAX_MESSAGE_CHARS,
): string[] {
  if (limit < 1) {
    throw new Error(`invalid split limit: ${limit}`);
  }
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const newlineAt = window.lastIndexOf('\n');
    if (newlineAt > 0) {
      chunks.push(rest.slice(0, newlineAt));
      rest = rest.slice(newlineAt + 1);
      continue;
    }
    const spaceAt = window.lastIndexOf(' ');
    if (spaceAt > 0) {
      chunks.push(rest.slice(0, spaceAt));
      rest = rest.slice(spaceAt + 1);
      continue;
    }
    chunks.push(window);
    rest = rest.slice(limit);
  }
  if (rest.length > 0 || chunks.length === 0) {
    chunks.push(rest);
  }
  return chunks;
}
