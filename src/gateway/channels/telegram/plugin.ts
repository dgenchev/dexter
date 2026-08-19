import { getSetting } from '../../../utils/config.js';
import type { GatewayConfig } from '../../config.js';
import type { ChannelId, ChannelPlugin } from '../types.js';
import { normalizeAllowedChats, normalizeAllowedUserIds } from './access.js';
import { createTelegramApi } from './api.js';
import { monitorTelegramChannel } from './monitor.js';
import { createDailyRunCounter, DEFAULT_TELEGRAM_MAX_RUNS_PER_DAY } from './rate-limit.js';
import type { TelegramAccountConfig, TelegramInboundMessage } from './types.js';

export const TELEGRAM_TOKEN_ENV = 'TELEGRAM_BOT_TOKEN';

/** The bot token lives in the environment only — never in settings or config files. */
export function getTelegramBotToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env[TELEGRAM_TOKEN_ENV]?.trim();
  return token ? token : undefined;
}

export function resolveTelegramMaxRunsPerDay(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TELEGRAM_MAX_RUNS_PER_DAY;
}

export function createTelegramPlugin(params: {
  loadConfig: () => GatewayConfig;
  onMessage: (msg: TelegramInboundMessage) => Promise<void>;
}): ChannelPlugin<GatewayConfig, TelegramAccountConfig> {
  return {
    // Upstream's ChannelId union only names 'whatsapp'; the rest of the seam is
    // structural, so widen here rather than editing channels/types.ts (keeps
    // this patch disjoint from every other harness patch).
    id: 'telegram' as unknown as ChannelId,
    config: {
      listAccountIds: () => ['default'],
      resolveAccount: (_cfg, accountId) => ({ accountId, enabled: true }),
      isEnabled: () => Boolean(getTelegramBotToken()),
      isConfigured: () => Boolean(getTelegramBotToken()),
    },
    gateway: {
      startAccount: async (ctx) => {
        const token = getTelegramBotToken();
        if (!token) {
          ctx.setStatus({ connected: false, lastError: `${TELEGRAM_TOKEN_ENV} not set` });
          return;
        }
        const api = createTelegramApi({ token });

        const allowedUserIds = normalizeAllowedUserIds(
          getSetting<unknown>('telegramAllowedUserIds', []),
        );
        const allowedChats = normalizeAllowedChats(getSetting<unknown>('telegramAllowedChats', []));
        const maxRunsPerDay = resolveTelegramMaxRunsPerDay(
          getSetting<unknown>('telegramMaxRunsPerDay', DEFAULT_TELEGRAM_MAX_RUNS_PER_DAY),
        );
        const runCounter = createDailyRunCounter({ maxRunsPerDay });

        if (allowedUserIds.length === 0) {
          console.log(
            '[telegram] warning: telegramAllowedUserIds is empty — every inbound message will be ignored',
          );
        }

        try {
          const me = await api.getMe(ctx.abortSignal);
          ctx.setStatus({ connected: true, lastError: null });
          console.log(`[telegram] connected as @${me.username ?? me.id}`);
        } catch (err) {
          if (ctx.abortSignal.aborted) {
            return;
          }
          // The poll loop below retries on its own; report, don't crash.
          const msg = err instanceof Error ? err.message : String(err);
          ctx.setStatus({ connected: false, lastError: msg });
          console.log(`[telegram] getMe failed (poller will keep retrying): ${msg}`);
        }

        await monitorTelegramChannel({
          api,
          accountId: ctx.accountId,
          abortSignal: ctx.abortSignal,
          allowedUserIds,
          allowedChats,
          runCounter,
          onMessage: params.onMessage,
          log: (msg) => console.log(msg),
        });
        ctx.setStatus({ connected: false });
      },
    },
    status: {
      defaultRuntime: {
        accountId: 'default',
        running: false,
        connected: false,
        lastError: null,
      },
    },
  };
}
