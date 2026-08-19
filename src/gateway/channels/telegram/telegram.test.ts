import { describe, expect, test } from 'bun:test';
import {
  isChatAllowed,
  isUserAllowed,
  normalizeAllowedChats,
  normalizeAllowedUserIds,
} from './access.js';
import { escapeTelegramHtml, markdownToTelegramHtml } from './format.js';
import { DAILY_CAP_REPLY, handleTelegramUpdates, type TelegramMonitorParams } from './monitor.js';
import { sendTelegramReply } from './outbound.js';
import { nextOffset, pollTelegramUpdates } from './poller.js';
import { createDailyRunCounter } from './rate-limit.js';
import { splitTelegramMessage, TELEGRAM_MAX_MESSAGE_CHARS } from './split.js';
import type {
  TelegramApi,
  TelegramInboundMessage,
  TelegramMessage,
  TelegramUpdate,
} from './types.js';

// --- helpers -------------------------------------------------------------

type SentMessage = { chatId: number; text: string; threadId?: number; parseMode?: 'HTML' };

function makeMockApi(overrides: Partial<TelegramApi> = {}): TelegramApi & { sent: SentMessage[] } {
  const sent: SentMessage[] = [];
  return {
    sent,
    getMe: async () => ({ id: 1, username: 'mock_bot' }),
    getUpdates: async () => [],
    sendMessage: async ({ chatId, text, threadId, parseMode }) => {
      sent.push({ chatId, text, threadId, parseMode });
    },
    sendChatAction: async () => {},
    ...overrides,
  };
}

function textUpdate(params: {
  updateId: number;
  userId?: number;
  chatId?: number;
  chatType?: TelegramMessage['chat']['type'];
  text?: string;
  threadId?: number;
}): TelegramUpdate {
  return {
    update_id: params.updateId,
    message: {
      message_id: params.updateId * 10,
      from: params.userId !== undefined ? { id: params.userId } : undefined,
      chat: { id: params.chatId ?? 100, type: params.chatType ?? 'private' },
      text: params.text ?? 'hello',
      ...(params.threadId !== undefined ? { message_thread_id: params.threadId } : {}),
    },
  };
}

function makeMonitorParams(overrides: Partial<TelegramMonitorParams>): TelegramMonitorParams {
  return {
    api: makeMockApi(),
    accountId: 'default',
    abortSignal: new AbortController().signal,
    allowedUserIds: [42],
    allowedChats: [],
    runCounter: createDailyRunCounter({ maxRunsPerDay: 10 }),
    onMessage: async () => {},
    ...overrides,
  };
}

// --- message splitting at 4096 -------------------------------------------

describe('splitTelegramMessage', () => {
  test('text at exactly the limit stays one chunk', () => {
    const text = 'a'.repeat(TELEGRAM_MAX_MESSAGE_CHARS);
    expect(splitTelegramMessage(text)).toEqual([text]);
  });

  test('unbroken text over the limit is hard-cut into <=4096 chunks', () => {
    const text = 'a'.repeat(TELEGRAM_MAX_MESSAGE_CHARS + 904);
    const chunks = splitTelegramMessage(text);
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.length).toBe(TELEGRAM_MAX_MESSAGE_CHARS);
    expect(chunks[1]!.length).toBe(904);
    expect(chunks.join('')).toBe(text);
  });

  test('prefers a newline boundary inside the window', () => {
    const chunks = splitTelegramMessage('alpha\nbeta gamma', 10);
    expect(chunks).toEqual(['alpha', 'beta gamma']);
  });

  test('falls back to a space boundary when no newline fits', () => {
    const chunks = splitTelegramMessage('alpha beta', 7);
    expect(chunks).toEqual(['alpha', 'beta']);
  });

  test('every chunk of a long mixed text fits the limit', () => {
    const text = Array.from({ length: 300 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n');
    const chunks = splitTelegramMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_CHARS);
    }
    expect(chunks.join('\n')).toBe(text);
  });
});

// --- markdown-ish -> Telegram HTML ----------------------------------------

describe('markdownToTelegramHtml', () => {
  test('escapes & < > everywhere', () => {
    expect(escapeTelegramHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
    expect(markdownToTelegramHtml('cash & debt: 1 < 2 > 0')).toBe(
      'cash &amp; debt: 1 &lt; 2 &gt; 0',
    );
  });

  test('**bold** becomes <b>', () => {
    expect(markdownToTelegramHtml('a **fat** margin')).toBe('a <b>fat</b> margin');
  });

  test('*italic* and _italic_ become <i>', () => {
    expect(markdownToTelegramHtml('so *slanted* text')).toBe('so <i>slanted</i> text');
    expect(markdownToTelegramHtml('so _slanted_ text')).toBe('so <i>slanted</i> text');
  });

  test('underscores inside identifiers and URL paths stay literal', () => {
    expect(markdownToTelegramHtml('call thesis_status now')).toBe('call thesis_status now');
    expect(markdownToTelegramHtml('https://x.com/a_b_c page')).toBe('https://x.com/a_b_c page');
  });

  test('backtick spans become <code> with escaped, unformatted contents', () => {
    expect(markdownToTelegramHtml('run `a < b && **c**` now')).toBe(
      'run <code>a &lt; b &amp;&amp; **c**</code> now',
    );
  });

  test('triple-backtick blocks become <pre> with escaped contents', () => {
    expect(markdownToTelegramHtml('see:\n```js\nif (a < b) run();\n```\ndone')).toBe(
      'see:\n<pre>if (a &lt; b) run();</pre>\ndone',
    );
  });

  test('[text](url) becomes an anchor with escaped href', () => {
    expect(markdownToTelegramHtml('see [IR](https://x.com/ir?a=1&b=2)')).toBe(
      'see <a href="https://x.com/ir?a=1&amp;b=2">IR</a>',
    );
  });

  test('headings, tables, and lists are left as plain text', () => {
    const text = '# Verdict\n- one\n- two\n| a | b |';
    expect(markdownToTelegramHtml(text)).toBe(text);
  });

  test('unbalanced markdown falls back to literal text, never an unclosed tag', () => {
    expect(markdownToTelegramHtml('**dangling bold')).toBe('**dangling bold');
    expect(markdownToTelegramHtml('a * b * spaced stars')).toBe('a * b * spaced stars');
    expect(markdownToTelegramHtml('```\nunclosed fence')).toBe('```\nunclosed fence');
    expect(markdownToTelegramHtml('`unclosed span')).toBe('`unclosed span');
  });
});

// --- allowlist filtering ---------------------------------------------------

describe('telegram allowlists', () => {
  test('normalizeAllowedUserIds keeps numeric ids, coerces digit strings, drops junk', () => {
    expect(normalizeAllowedUserIds([42, '43', 'nope', null, 42, 3.5])).toEqual([42, 43]);
    expect(normalizeAllowedUserIds('not-a-list')).toEqual([]);
  });

  test('empty allowlist admits no one', () => {
    expect(isUserAllowed(42, [])).toBe(false);
    expect(isUserAllowed(undefined, [42])).toBe(false);
    expect(isUserAllowed(42, [42])).toBe(true);
  });

  test('private chats pass the chat filter; groups need a configured entry', () => {
    expect(isChatAllowed({ chatId: 5, chatType: 'private' }, [])).toBe(true);
    expect(isChatAllowed({ chatId: -100, chatType: 'supergroup' }, [])).toBe(false);
    const allowed = normalizeAllowedChats([{ chatId: -100, threadId: 7 }, { chatId: -200 }]);
    expect(isChatAllowed({ chatId: -100, chatType: 'supergroup', threadId: 7 }, allowed)).toBe(true);
    expect(isChatAllowed({ chatId: -100, chatType: 'supergroup', threadId: 8 }, allowed)).toBe(false);
    expect(isChatAllowed({ chatId: -200, chatType: 'group', threadId: 9 }, allowed)).toBe(true);
  });

  test('monitor ignores unlisted senders silently and logs them', async () => {
    const api = makeMockApi();
    const dispatched: TelegramInboundMessage[] = [];
    const logs: string[] = [];
    const params = makeMonitorParams({
      api,
      allowedUserIds: [42],
      onMessage: async (msg) => {
        dispatched.push(msg);
      },
      log: (msg) => logs.push(msg),
    });

    await handleTelegramUpdates(params, [
      textUpdate({ updateId: 1, userId: 999, text: 'intruder' }),
      textUpdate({ updateId: 2, userId: 42, text: 'operator' }),
    ]);

    expect(dispatched.length).toBe(1);
    expect(dispatched[0]!.body).toBe('operator');
    expect(api.sent.length).toBe(0); // silent: no reply to the intruder
    expect(logs.some((l) => l.includes('unlisted user 999'))).toBe(true);
  });

  test('monitor ignores group messages unless the chat is configured', async () => {
    const dispatched: TelegramInboundMessage[] = [];
    const params = makeMonitorParams({
      allowedUserIds: [42],
      allowedChats: [{ chatId: -500, threadId: 3 }],
      onMessage: async (msg) => {
        dispatched.push(msg);
      },
    });

    await handleTelegramUpdates(params, [
      textUpdate({ updateId: 1, userId: 42, chatId: -777, chatType: 'supergroup', threadId: 3 }),
      textUpdate({ updateId: 2, userId: 42, chatId: -500, chatType: 'supergroup', threadId: 4 }),
      textUpdate({ updateId: 3, userId: 42, chatId: -500, chatType: 'supergroup', threadId: 3 }),
    ]);

    expect(dispatched.length).toBe(1);
    expect(dispatched[0]!.chatId).toBe(-500);
    expect(dispatched[0]!.threadId).toBe(3);
  });
});

// --- daily-cap counter and reset -------------------------------------------

describe('daily run cap', () => {
  test('allows up to the cap and then refuses', () => {
    const counter = createDailyRunCounter({ maxRunsPerDay: 2, now: () => Date.parse('2026-08-19T10:00:00Z') });
    expect(counter.tryConsume()).toBe(true);
    expect(counter.tryConsume()).toBe(true);
    expect(counter.tryConsume()).toBe(false);
    expect(counter.used()).toBe(2);
  });

  test('resets when the UTC day rolls over', () => {
    let now = Date.parse('2026-08-19T23:59:00Z');
    const counter = createDailyRunCounter({ maxRunsPerDay: 1, now: () => now });
    expect(counter.tryConsume()).toBe(true);
    expect(counter.tryConsume()).toBe(false);
    now = Date.parse('2026-08-20T00:01:00Z');
    expect(counter.used()).toBe(0);
    expect(counter.tryConsume()).toBe(true);
  });

  test('over the cap the sender is told instead of getting a run', async () => {
    const api = makeMockApi();
    const dispatched: TelegramInboundMessage[] = [];
    const params = makeMonitorParams({
      api,
      runCounter: createDailyRunCounter({ maxRunsPerDay: 1 }),
      onMessage: async (msg) => {
        dispatched.push(msg);
      },
    });

    await handleTelegramUpdates(params, [
      textUpdate({ updateId: 1, userId: 42, text: 'first' }),
      textUpdate({ updateId: 2, userId: 42, text: 'second' }),
    ]);

    expect(dispatched.length).toBe(1);
    expect(dispatched[0]!.body).toBe('first');
    expect(api.sent.length).toBe(1);
    expect(api.sent[0]!.text).toBe(DAILY_CAP_REPLY);
  });
});

// --- offset advancement ------------------------------------------------------

describe('getUpdates offset', () => {
  test('nextOffset moves one past the highest update_id and never regresses', () => {
    expect(nextOffset([], undefined)).toBeUndefined();
    expect(nextOffset([], 7)).toBe(7);
    expect(nextOffset([{ update_id: 3 }, { update_id: 9 }, { update_id: 5 }], undefined)).toBe(10);
    expect(nextOffset([{ update_id: 2 }], 7)).toBe(7);
  });

  test('poll loop advances the offset across batches and survives errors', async () => {
    const controller = new AbortController();
    const seenOffsets: Array<number | undefined> = [];
    const logs: string[] = [];
    let call = 0;

    const api = {
      getUpdates: async ({ offset }: { offset?: number }) => {
        call += 1;
        seenOffsets.push(offset);
        if (call === 1) return [textUpdate({ updateId: 1, userId: 42 }), textUpdate({ updateId: 2, userId: 42 })];
        if (call === 2) throw new Error('transient network failure');
        if (call === 3) return [textUpdate({ updateId: 5, userId: 42 })];
        controller.abort();
        return [];
      },
    };

    const handled: number[] = [];
    await pollTelegramUpdates({
      api,
      abortSignal: controller.signal,
      onUpdates: async (updates) => {
        handled.push(...updates.map((u) => u.update_id));
      },
      log: (msg) => logs.push(msg),
      sleep: async () => {},
    });

    expect(seenOffsets).toEqual([undefined, 3, 3, 6]);
    expect(handled).toEqual([1, 2, 5]);
    expect(logs.some((l) => l.includes('transient network failure'))).toBe(true);
  });

  test('a throwing message handler does not stop or replay the loop', async () => {
    const controller = new AbortController();
    let call = 0;
    const seenOffsets: Array<number | undefined> = [];
    const api = {
      getUpdates: async ({ offset }: { offset?: number }) => {
        call += 1;
        seenOffsets.push(offset);
        if (call === 1) return [textUpdate({ updateId: 11, userId: 42 })];
        controller.abort();
        return [];
      },
    };

    await pollTelegramUpdates({
      api,
      abortSignal: controller.signal,
      onUpdates: async () => {
        throw new Error('handler blew up');
      },
      sleep: async () => {},
    });

    // Offset advanced before the handler failed, so update 11 is not replayed.
    expect(seenOffsets).toEqual([undefined, 12]);
  });
});

// --- thread-id passthrough ----------------------------------------------------

describe('forum-topic thread passthrough', () => {
  test('replies carry message_thread_id on every chunk', async () => {
    const api = makeMockApi();
    const longText = 'x'.repeat(TELEGRAM_MAX_MESSAGE_CHARS + 1);
    await sendTelegramReply(api, { chatId: -500, text: longText, threadId: 77 });
    expect(api.sent.length).toBe(2);
    for (const sent of api.sent) {
      expect(sent.chatId).toBe(-500);
      expect(sent.threadId).toBe(77);
      expect(sent.text.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_CHARS);
    }
  });

  test('inbound reply() built by the monitor targets the same chat and topic', async () => {
    const api = makeMockApi();
    let inbound: TelegramInboundMessage | undefined;
    const params = makeMonitorParams({
      api,
      allowedChats: [{ chatId: -500 }],
      onMessage: async (msg) => {
        inbound = msg;
      },
    });

    await handleTelegramUpdates(params, [
      textUpdate({ updateId: 1, userId: 42, chatId: -500, chatType: 'supergroup', threadId: 12 }),
    ]);

    expect(inbound).toBeDefined();
    await inbound!.reply('answer');
    expect(api.sent).toEqual([{ chatId: -500, text: 'answer', threadId: 12, parseMode: 'HTML' }]);
  });

  test('markdown replies are converted and sent with parse_mode HTML', async () => {
    const api = makeMockApi();
    await sendTelegramReply(api, { chatId: 9, text: '**MoS** is *thin* at `-4%`' });
    expect(api.sent).toEqual([
      {
        chatId: 9,
        text: '<b>MoS</b> is <i>thin</i> at <code>-4%</code>',
        threadId: undefined,
        parseMode: 'HTML',
      },
    ]);
  });

  test('a chunk Telegram rejects with parse_mode is retried once as plain text and logged', async () => {
    const attempts: Array<SentMessage & { parseMode?: 'HTML' }> = [];
    const logs: string[] = [];
    const api: Pick<TelegramApi, 'sendMessage'> = {
      sendMessage: async ({ chatId, text, threadId, parseMode }) => {
        attempts.push({ chatId, text, threadId, parseMode });
        if (parseMode !== undefined) {
          throw new Error("telegram sendMessage failed: Bad Request: can't parse entities");
        }
      },
    };

    await sendTelegramReply(api, {
      chatId: 5,
      text: '**bold** & broken',
      log: (msg) => logs.push(msg),
    });

    expect(attempts.length).toBe(2);
    expect(attempts[0]!.parseMode).toBe('HTML');
    expect(attempts[1]!.parseMode).toBeUndefined();
    expect(attempts[1]!.text).toBe('**bold** & broken'); // original plain chunk, undamaged
    expect(logs.some((l) => l.includes('retrying chunk as plain text'))).toBe(true);
  });

  test('a chunk whose conversion outgrows 4096 chars is sent plain and logged', async () => {
    const api = makeMockApi();
    const logs: string[] = [];
    // 5000 ampersands: split -> [4096, 904]; each escapes to 5x its length.
    const text = '&'.repeat(5000);
    await sendTelegramReply(api, { chatId: 3, text, log: (msg) => logs.push(msg) });

    expect(api.sent.length).toBe(2);
    for (const sent of api.sent) {
      expect(sent.parseMode).toBeUndefined();
      expect(sent.text.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_CHARS);
      expect(sent.text).not.toContain('&amp;');
    }
    expect(api.sent.map((s) => s.text).join('')).toBe(text);
    expect(logs.filter((l) => l.includes('sending plain text')).length).toBe(2);
  });

  test('splitting happens before conversion; a severed pair renders literally, never as an unclosed tag', async () => {
    const api = makeMockApi();
    // First line fills the window so the split lands between the ** markers.
    const text = `${'x'.repeat(4090)}\n**start ${'y'.repeat(4090)} end**`;
    await sendTelegramReply(api, { chatId: 4, text });

    expect(api.sent.length).toBeGreaterThan(1);
    for (const sent of api.sent) {
      expect(sent.text.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_CHARS);
      expect(sent.text).not.toContain('<b>'); // the pair was severed: no bold anywhere
    }
    // The markers survive as literal text instead of vanishing into bad HTML.
    expect(api.sent.map((s) => s.text).join('\n')).toContain('**start');
  });

  test('direct-chat replies carry no thread id', async () => {
    const api = makeMockApi();
    let inbound: TelegramInboundMessage | undefined;
    const params = makeMonitorParams({
      api,
      onMessage: async (msg) => {
        inbound = msg;
      },
    });

    await handleTelegramUpdates(params, [textUpdate({ updateId: 1, userId: 42 })]);
    await inbound!.reply('answer');
    expect(api.sent).toEqual([
      { chatId: 100, text: 'answer', threadId: undefined, parseMode: 'HTML' },
    ]);
  });
});
