import type { TelegramApi, TelegramUpdate } from './types.js';

/**
 * The next `getUpdates` offset: one past the highest update_id seen, so the
 * Bot API marks everything up to it as confirmed and never redelivers it.
 */
export function nextOffset(
  updates: TelegramUpdate[],
  current: number | undefined,
): number | undefined {
  let next = current;
  for (const update of updates) {
    const candidate = update.update_id + 1;
    if (next === undefined || candidate > next) {
      next = candidate;
    }
  }
  return next;
}

export type TelegramPollerParams = {
  api: Pick<TelegramApi, 'getUpdates'>;
  abortSignal: AbortSignal;
  onUpdates: (updates: TelegramUpdate[]) => Promise<void>;
  log?: (msg: string) => void;
  /** Bot API long-poll timeout; default 30 seconds. */
  timeoutSeconds?: number;
  /** Pause after a transient error before retrying; default 3000 ms. */
  errorDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  initialOffset?: number;
};

/**
 * Long-poll `getUpdates` until aborted. Transient errors (network drops,
 * Bot API 5xx, handler failures) are logged and retried after a short
 * delay — the loop never throws, so the gateway never crashes over them.
 */
export async function pollTelegramUpdates(params: TelegramPollerParams): Promise<void> {
  const log = params.log ?? (() => {});
  const timeoutSeconds = params.timeoutSeconds ?? 30;
  const errorDelayMs = params.errorDelayMs ?? 3000;
  const sleep =
    params.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let offset = params.initialOffset;

  while (!params.abortSignal.aborted) {
    try {
      const updates = await params.api.getUpdates({
        offset,
        timeoutSeconds,
        signal: params.abortSignal,
      });
      // Advance before handling: a failing handler must not replay updates.
      offset = nextOffset(updates, offset);
      if (updates.length > 0) {
        await params.onUpdates(updates);
      }
    } catch (err) {
      if (params.abortSignal.aborted) {
        break;
      }
      const msg = err instanceof Error ? err.message : String(err);
      log(`[telegram] poll error (will retry): ${msg}`);
      await sleep(errorDelayMs);
    }
  }
}
