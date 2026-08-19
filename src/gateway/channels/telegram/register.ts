import type { GatewayConfig } from '../../config.js';
import { createChannelManager, type ChannelManager } from '../manager.js';
import { handleTelegramInbound } from './dispatch.js';
import { createTelegramPlugin, getTelegramBotToken } from './plugin.js';
import type { TelegramAccountConfig } from './types.js';

/**
 * The single hook the gateway bootstrap calls. Returns null when
 * TELEGRAM_BOT_TOKEN is absent, so the channel is off unless the operator
 * has provisioned a token in the environment.
 */
export function maybeCreateTelegramManager(params: {
  loadConfig: () => GatewayConfig;
}): ChannelManager<GatewayConfig, TelegramAccountConfig> | null {
  if (!getTelegramBotToken()) {
    return null;
  }
  const plugin = createTelegramPlugin({
    loadConfig: params.loadConfig,
    onMessage: async (inbound) => {
      await handleTelegramInbound(params.loadConfig(), inbound);
    },
  });
  return createChannelManager({ plugin, loadConfig: params.loadConfig });
}
