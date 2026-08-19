import { appendFileSync } from 'node:fs';
import { dexterPath } from '../../../utils/paths.js';
import { getSetting, resolveMaxIterations } from '../../../utils/config.js';
import type { GatewayConfig } from '../../config.js';
import { enqueueForSession, isSessionRunning, runAgentForMessage } from '../../agent-runner.js';
import { resolveRoute } from '../../routing/resolve-route.js';
import { resolveSessionStorePath, upsertSessionMeta } from '../../sessions/store.js';
import type { TelegramInboundMessage } from './types.js';

const LOG_PATH = dexterPath('gateway-debug.log');
function debugLog(msg: string): void {
  try {
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // logging must never take the channel down
  }
}

const TYPING_INTERVAL_MS = 5000;

/**
 * Turn an allowlisted Telegram message into an agent run and send the answer
 * back into the same chat (and forum topic). Mirrors the WhatsApp inbound
 * flow: route, persist session meta, enqueue when a run is in flight, keep a
 * typing indicator alive while the agent works.
 */
export async function handleTelegramInbound(
  cfg: GatewayConfig,
  inbound: TelegramInboundMessage,
): Promise<void> {
  const isGroup = inbound.chatType !== 'private';
  const peerId =
    inbound.threadId !== undefined ? `${inbound.chatId}#${inbound.threadId}` : String(inbound.chatId);

  const route = resolveRoute({
    cfg,
    channel: 'telegram',
    accountId: inbound.accountId,
    peer: { kind: isGroup ? 'group' : 'direct', id: peerId },
  });

  const storePath = resolveSessionStorePath(route.agentId);
  upsertSessionMeta({
    storePath,
    sessionKey: route.sessionKey,
    channel: 'telegram',
    to: peerId,
    accountId: route.accountId,
    agentId: route.agentId,
  });

  const model = getSetting('modelId', 'gpt-5.6-sol') as string;
  const modelProvider = getSetting('provider', 'openai') as string;

  if (isSessionRunning(route.sessionKey)) {
    debugLog(`[telegram] agent busy for session=${route.sessionKey}, enqueueing`);
    enqueueForSession(route.sessionKey, model, inbound.body);
    return;
  }

  let typingTimer: ReturnType<typeof setInterval> | undefined;
  try {
    await inbound.sendTyping();
    typingTimer = setInterval(() => {
      void inbound.sendTyping();
    }, TYPING_INTERVAL_MS);

    const resolvedCap = resolveMaxIterations(10);
    debugLog(`[telegram] running agent for session=${route.sessionKey} maxIterations=${resolvedCap}`);
    // A denied tool call ends a run with an empty answer (agent.ts). Record
    // every denial so the failure notice can name its killer instead of
    // guessing between the cap and an empty completion.
    const deniedCalls: string[] = [];
    const startedAt = Date.now();
    const answer = await runAgentForMessage({
      sessionKey: route.sessionKey,
      query: inbound.body,
      model,
      modelProvider,
      channel: 'telegram',
      // Same cap resolution as the CLI: settings maxIterations (20 here) over
      // the upstream default. A full story protocol measures ~14 rounds; the
      // agent-runner fallback of 10 caps it mid-review.
      maxIterations: resolvedCap,
      onEvent: async (ev) => {
        if (ev.type === 'tool_denied') {
          const what =
            ev.tool === 'bash'
              ? String((ev.args as Record<string, unknown> | undefined)?.command ?? '')
              : `${ev.tool} ${JSON.stringify(ev.args ?? {}).slice(0, 80)}`;
          deniedCalls.push(what.slice(0, 120));
          debugLog(`[telegram] tool_denied ${ev.tool}: ${what.slice(0, 200)}`);
        }
      },
    });
    const durationMs = Date.now() - startedAt;

    clearInterval(typingTimer);
    typingTimer = undefined;

    if (answer.trim()) {
      await inbound.reply(answer.trim());
      console.log(`Sent Telegram reply (${answer.length} chars, ${durationMs}ms)`);
      debugLog(`[telegram] reply sent length=${answer.length}`);
    } else {
      // A user-initiated message always gets a reply — a silent failure reads
      // as "still running" forever. Empty usually means the round cap bit or
      // the model returned an empty completion; say so instead of guessing.
      console.log(`Agent returned empty response (${durationMs}ms)`);
      debugLog('[telegram] empty answer, sending failure notice');
      const cause = deniedCalls.length
        ? `A denied tool call ends the run: ${deniedCalls.join('; ')}`
        : `Likely the round cap or an empty model reply`;
      await inbound.reply(
        `⚠️ The run finished after ${Math.round(durationMs / 1000)}s with no answer ` +
        `(up to ${resolvedCap} rounds). ${cause} — ` +
        `nothing was written on faith. Try again, or check the desk logs.`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`Telegram handler error: ${msg}`);
    debugLog(`[telegram] ERROR: ${msg}`);
    try {
      await inbound.reply(`⚠️ Run failed: ${msg.slice(0, 300)}`);
    } catch {
      debugLog('[telegram] failed to deliver the failure notice');
    }
  } finally {
    if (typingTimer) {
      clearInterval(typingTimer);
    }
  }
}
