/**
 * Convert the model's markdown-ish output to Telegram HTML (parse_mode: 'HTML').
 *
 * Supported translations:
 *   **bold**            -> <b>bold</b>
 *   *italic* / _italic_ -> <i>italic</i>
 *   `span`              -> <code>span</code>
 *   ```block```         -> <pre>block</pre>
 *   [text](url)         -> <a href="url">text</a>
 *
 * Everything Telegram HTML has no equivalent for — headings, tables, lists —
 * is left as plain text; we do not fake them. All literal text is escaped
 * (& < >) BEFORE any tags are emitted, and tag contents are escaped plain
 * text (no nested formatting), so the output can never contain an unclosed
 * or misnested tag. Unbalanced markdown simply fails to match and survives
 * as escaped literal text — safe by construction.
 */

/** Escape the three characters Telegram HTML requires escaping: & < >. */
export function escapeTelegramHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * One alternation, tried in order at each position:
 *   1. `code span`            (no newline, no nested backtick)
 *   2. [text](http(s)-url)    (single line; url stops at whitespace or `)`)
 *   3. **bold**               (single line, no inner asterisk)
 *   4. *italic*               (single line, non-space edges, no inner asterisk)
 *   5. _italic_               (word-boundary guarded so snake_case and
 *                              URL path_segments stay untouched)
 */
const INLINE_RE =
  /`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n\s](?:[^*\n]*[^*\n\s])?)\*|(?<![\w/])_([^_\n\s](?:[^_\n]*[^_\n\s])?)_(?!\w)/g;

/** ```lang\n ... ``` fenced block; the language tag is dropped. */
const FENCE_RE = /```(?:[\w+#.-]*\n)?([\s\S]*?)```/g;

function convertInline(raw: string): string {
  let out = '';
  let last = 0;
  for (const m of raw.matchAll(INLINE_RE)) {
    out += escapeTelegramHtml(raw.slice(last, m.index));
    if (m[1] !== undefined) {
      out += `<code>${escapeTelegramHtml(m[1])}</code>`;
    } else if (m[2] !== undefined) {
      const href = escapeTelegramHtml(m[3]!).replaceAll('"', '&quot;');
      out += `<a href="${href}">${escapeTelegramHtml(m[2])}</a>`;
    } else if (m[4] !== undefined) {
      out += `<b>${escapeTelegramHtml(m[4])}</b>`;
    } else if (m[5] !== undefined) {
      out += `<i>${escapeTelegramHtml(m[5])}</i>`;
    } else if (m[6] !== undefined) {
      out += `<i>${escapeTelegramHtml(m[6])}</i>`;
    }
    last = m.index! + m[0]!.length;
  }
  out += escapeTelegramHtml(raw.slice(last));
  return out;
}

/**
 * Convert one message (or one 4096-char chunk of one) to Telegram HTML.
 * Idempotence is not a goal; safety is: the result contains only balanced
 * <b> <i> <code> <pre> <a> tags with escaped contents.
 */
export function markdownToTelegramHtml(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(FENCE_RE)) {
    out += convertInline(text.slice(last, m.index));
    const body = m[1]!.replace(/^\n/, '').replace(/\n$/, '');
    out += `<pre>${escapeTelegramHtml(body)}</pre>`;
    last = m.index! + m[0]!.length;
  }
  out += convertInline(text.slice(last));
  return out;
}
