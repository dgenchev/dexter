import { DynamicStructuredTool } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import type { TokenUsage } from '../../agent/types.js';
import {
  SUBAGENT_TYPES,
  SUBAGENT_TYPE_NAMES,
  DEFAULT_SUBAGENT_TYPE,
  resolveSubagentTools,
} from './types.js';
import { encodeSubagentProgress } from './progress.js';
import { getSetting } from '../../utils/config.js';

// Rough categories so the activity line can roll up trailing operations the way
// a human would summarize them ("Searched 3×, read 2 sources").
const SEARCH_TOOLS = new Set(['web_search', 'x_search', 'stock_screener']);
const READ_TOOLS = new Set(['read_filings', 'read_file', 'web_fetch']);

function activityText(searchCount: number, readCount: number, lastTool: string): string {
  if (searchCount + readCount >= 2) {
    const parts: string[] = [];
    if (searchCount > 0) parts.push(`Searched ${searchCount}×`);
    if (readCount > 0) parts.push(`read ${readCount} source${readCount === 1 ? '' : 's'}`);
    return parts.join(', ');
  }
  if (lastTool) return `Ran ${lastTool}`;
  return 'Initializing…';
}

/**
 * Rich description for the spawn_subagent tool, injected into the leader's
 * system prompt to guide when and how to delegate.
 */
export const SPAWN_SUBAGENT_DESCRIPTION = `
Delegate a focused, self-contained sub-task to an isolated subagent that runs its own agent loop and returns a single final answer.

## When to Use

- A sub-task is substantial enough that its intermediate tool output would clutter your own context (deep research on one topic, analysis of one company).
- You have multiple INDEPENDENT sub-tasks: emit several spawn_subagent calls in a SINGLE turn and they run in parallel.

## When NOT to Use

- Trivial single-tool lookups you can do directly.
- Sub-tasks that depend on each other's output (run those yourself, or chain across turns).

## How It Works

The subagent runs in isolation — it cannot see this conversation and cannot delegate further. Put everything it needs into \`task\` (and optional \`context\`). It returns one complete answer that you then synthesize.

## Subagent Types

${Object.entries(SUBAGENT_TYPES)
  .map(([key, cfg]) => `- ${key}: ${cfg.whenToUse}`)
  .join('\n')}
`;

const SpawnSubagentInputSchema = z.object({
  description: z
    .string()
    .describe('A short 3-5 word summary of the sub-task, shown in the UI (e.g. "Analyze NVDA moat").'),
  task: z
    .string()
    .describe('The self-contained instruction for the subagent. Include all needed specifics.'),
  subagent_type: z
    .enum(SUBAGENT_TYPE_NAMES)
    .optional()
    .describe(`Which subagent type to use. Defaults to "${DEFAULT_SUBAGENT_TYPE}".`),
  context: z
    .string()
    .optional()
    .describe('Optional background the subagent needs but cannot see from the conversation.'),
  model: z
    .string()
    .optional()
    .describe(
      'Optional model override, openrouter:-prefixed. For subagent_type "critic" the operator\'s ' +
      'criticModel setting wins over this value.',
    ),
});

/**
 * Build the spawn_subagent tool, bound to the given model. Mirrors the other
 * model-bound tool factories in the registry.
 */
/**
 * Which model a spawn runs on. Configured beats requested beats parent:
 * the critic's model is an operator setting (criticModel in settings.json),
 * not something the parent picks for its own adversary. All values must be
 * provider-prefixed (e.g. "openrouter:openai/gpt-5.6-sol") — a bare
 * "openai/..." routes to a direct provider whose key may be absent, which is
 * what actually killed both 2026-08-17 spawn attempts.
 */
export function resolveSpawnModel(parentModel: string, requested?: string, configured?: string): string {
  const pick = (v?: string) => (v && v.trim() ? v.trim() : undefined);
  return pick(configured) ?? pick(requested) ?? parentModel;
}

/**
 * The tool result names the model that actually ran, so an orchestrator
 * recording critic_model copies it verbatim instead of guessing — the same
 * fix author_model needed (a run once reported gpt-5.2-codex while deepseek
 * was configured).
 */
export function formatSubagentResult(
  answer: string,
  typeKey: string,
  resolvedModel: string,
  usage?: TokenUsage,
): string {
  const stats = usage ? ` · ${usage.totalTokens} tokens` : '';
  return `${answer}\n\n_[subagent ${typeKey} · model: ${resolvedModel}${stats}]_`;
}

export function createSpawnSubagent(model: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'spawn_subagent',
    description: 'Delegate a focused sub-task to an isolated subagent (see system prompt for details).',
    schema: SpawnSubagentInputSchema,
    func: async (input, _runManager, config?: RunnableConfig) => {
      const onProgress = config?.metadata?.onProgress as ((msg: string) => void) | undefined;
      const signal = config?.signal as AbortSignal | undefined;

      const typeKey = input.subagent_type ?? DEFAULT_SUBAGENT_TYPE;
      const typeCfg = SUBAGENT_TYPES[typeKey] ?? SUBAGENT_TYPES[DEFAULT_SUBAGENT_TYPE];
      const toolAllowlist = resolveSubagentTools(typeKey);

      // Lazy import to break the registry → spawn-subagent → agent → registry cycle.
      // By first invocation all modules are fully loaded.
      const { Agent } = await import('../../agent/agent.js');

      const configuredCriticModel =
        typeKey === 'critic' ? getSetting<string | undefined>('criticModel', undefined) : undefined;
      const resolvedModel = resolveSpawnModel(model, input.model, configuredCriticModel);

      const subagent = await Agent.create({
        model: resolvedModel,
        maxIterations: typeCfg.maxIterations,
        signal,
        memoryEnabled: false,
        toolAllowlist,
        systemPromptOverride: typeCfg.systemPrompt,
        agentLabel: typeKey,
        // Read-only subagents: no approval plumbing needed in v1.
      });

      const query = input.context
        ? `${input.context}\n\n---\n\nTask: ${input.task}`
        : input.task;

      let answer = '';
      let usage: TokenUsage | undefined;

      // Per-agent live stats shipped to the UI row via the progress channel.
      let toolUseCount = 0;
      let streamedChars = 0;
      let lastTool = '';
      let searchCount = 0;
      let readCount = 0;

      const emit = (done = false) => {
        const tokens = usage?.totalTokens ?? (streamedChars > 0 ? Math.round(streamedChars / 4) : null);
        onProgress?.(
          encodeSubagentProgress({
            toolUseCount,
            tokens,
            activity: done ? 'Done' : activityText(searchCount, readCount, lastTool),
            done,
          }),
        );
      };

      emit();
      for await (const ev of subagent.run(query)) {
        switch (ev.type) {
          case 'tool_start':
            toolUseCount++;
            lastTool = ev.tool;
            if (SEARCH_TOOLS.has(ev.tool)) searchCount++;
            else if (READ_TOOLS.has(ev.tool)) readCount++;
            emit();
            break;
          case 'tool_error':
            lastTool = ev.tool;
            emit();
            break;
          case 'stream_progress':
            // Accumulate for the live token estimate; don't emit per chunk
            // (that would flood the parent with progress events).
            streamedChars += ev.charDelta;
            break;
          case 'done':
            answer = ev.answer;
            usage = ev.tokenUsage;
            break;
          default:
            // Swallow thinking/compaction/etc. — only the answer is returned.
            break;
        }
      }
      emit(true);

      if (!answer) {
        return `Subagent (${typeKey}, model: ${resolvedModel}) finished without producing an answer.`;
      }
      return formatSubagentResult(answer, typeKey, resolvedModel, usage);
    },
  });
}
