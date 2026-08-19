import type { TelegramApi, TelegramUpdate, TelegramUser } from './types.js';

/**
 * Minimal fetch shape so tests can inject a mock without touching the network.
 */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const DEFAULT_BASE_URL = 'https://api.telegram.org';

type Envelope<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export function createTelegramApi(params: {
  token: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}): TelegramApi {
  const fetchImpl = params.fetchImpl ?? (fetch as unknown as FetchLike);
  const base = `${params.baseUrl ?? DEFAULT_BASE_URL}/bot${params.token}`;

  const call = async <T>(
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> => {
    const res = await fetchImpl(`${base}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const payload = (await res.json()) as Envelope<T>;
    if (!res.ok || !payload.ok) {
      throw new Error(`telegram ${method} failed: ${payload.description ?? `http ${res.status}`}`);
    }
    return payload.result as T;
  };

  return {
    getMe: (signal) => call<TelegramUser>('getMe', {}, signal),
    getUpdates: ({ offset, timeoutSeconds, signal }) =>
      call<TelegramUpdate[]>(
        'getUpdates',
        {
          ...(offset !== undefined ? { offset } : {}),
          timeout: timeoutSeconds,
          allowed_updates: ['message'],
        },
        signal,
      ),
    sendMessage: async ({ chatId, text, threadId, parseMode, signal }) => {
      await call<unknown>(
        'sendMessage',
        {
          chat_id: chatId,
          text,
          ...(parseMode !== undefined ? { parse_mode: parseMode } : {}),
          ...(threadId !== undefined ? { message_thread_id: threadId } : {}),
        },
        signal,
      );
    },
    sendChatAction: async ({ chatId, action, threadId, signal }) => {
      await call<unknown>(
        'sendChatAction',
        {
          chat_id: chatId,
          action,
          ...(threadId !== undefined ? { message_thread_id: threadId } : {}),
        },
        signal,
      );
    },
  };
}
