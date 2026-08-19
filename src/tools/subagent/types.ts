/**
 * Subagent type registry.
 *
 * A "subagent" is a fresh, isolated agent loop that the main (leader) agent can
 * delegate a focused sub-task to. Each type below is a small config bundle: a
 * worker system prompt, a tool allow-list, and an iteration budget. The leader
 * picks a type via the `spawn_subagent` tool; the subagent runs to completion
 * and returns a single answer.
 */

/** Configuration for one subagent type. */
export interface SubagentTypeConfig {
  /** Help text shown to the leader so it knows when to pick this type. */
  whenToUse: string;
  /** Self-contained worker system prompt for the subagent. */
  systemPrompt: string;
  /** Allow-list of tool names (must match registry names) the subagent may use. */
  tools: string[];
  /** Maximum agent loop iterations for the subagent. */
  maxIterations: number;
}

/**
 * Tools a subagent may never receive. The delegate tool is listed here so a
 * subagent can never spawn its own subagents — delegation is one level deep.
 */
export const SUBAGENT_DISALLOWED_TOOLS = new Set<string>(['spawn_subagent', 'ask_user_question', 'bash']);

/**
 * Read-only tools available to a general-purpose subagent. Deliberately excludes
 * write/edit/memory-mutation tools: subagents run in parallel and must not race
 * on approval prompts or side effects.
 */
const READ_ONLY_TOOLS = [
  'get_financials',
  'get_market_data',
  'read_filings',
  'stock_screener',
  'web_search',
  'x_search',
  'web_fetch',
  'read_file',
  'memory_search',
  'memory_get',
];

const WORKER_PREAMBLE =
  'You are a subagent working on a single sub-task assigned by an orchestrator. ' +
  'You run in isolation: you cannot see the main conversation and you cannot ' +
  'delegate to other subagents. Complete only the assigned task. Your final ' +
  'message is returned verbatim to the orchestrator, so make it a complete, ' +
  'self-contained answer — state your findings and conclusions directly, not a ' +
  'description of what you did.';

export const SUBAGENT_TYPES: Record<string, SubagentTypeConfig> = {
  'general-purpose': {
    whenToUse: 'Multi-step research or analysis on one focused sub-task.',
    systemPrompt: `${WORKER_PREAMBLE}\n\nYou are a general-purpose research worker. Use the available tools to gather and analyze whatever the task requires, then report your findings.`,
    tools: READ_ONLY_TOOLS,
    maxIterations: 8,
  },
  research: {
    whenToUse: 'Gather and synthesize external information on a single topic.',
    systemPrompt: `${WORKER_PREAMBLE}\n\nYou are a research worker. Gather information from the web, news, and filings, cross-check sources, and synthesize a clear, sourced summary of what you found.`,
    tools: ['web_search', 'x_search', 'web_fetch', 'read_filings', 'get_market_data'],
    maxIterations: 8,
  },
  analysis: {
    whenToUse: 'Quantitative financial analysis on specific companies.',
    systemPrompt: `${WORKER_PREAMBLE}\n\nYou are a financial analysis worker. Pull the relevant financials, metrics, and market data, then deliver a focused quantitative analysis with the numbers that support it.`,
    tools: ['get_financials', 'get_market_data', 'stock_screener', 'read_filings'],
    maxIterations: 8,
  },
  critic: {
    whenToUse:
      'Invert-only attack on a finished story. Only after the story file exists on disk with `critic: pending` — pass the story path in `task`. Never before write_file, and never to draft or improve a thesis.',
    systemPrompt:
      `${WORKER_PREAMBLE}\n\n` +
      'You are an independent critic. The task names the path of a written investigation story. ' +
      'Start with read_file on that path — it is your only briefing; you cannot see how the story was produced.\n\n' +
      'Attack it. Do not steelman it, do not rewrite a better bull case, do not produce a replacement story, ' +
      'do not output a thesis verdict of your own, and never output buy, sell, or hold. ' +
      'If the story frontmatter says venue: non-us, the get_financials, get_market_data and read_filings tools ' +
      'are closed for that name — use web_fetch of the issuer and read_file of pinned tables instead.\n\n' +
      'Attack the load-bearing parts: whether the evidence supports the written thesis mechanism rather than ' +
      'aggregate results; whether material numbers carry a source; the valuation inputs and what the answer ' +
      'becomes if a stated assumption is wrong; forensics (one-time items as run-rate, dilution, working capital); ' +
      'whether the falsifiers are operational — thresholds, windows, evidence standards; whether the verdict ' +
      'is consistent with the weaknesses the story itself admits; and the Jenga scorecard if present — scores ' +
      'whose cited evidence does not support them, UNSOURCED rows scored above the cap of 5 or filled by ' +
      'assertion, and carried scores that intervening events have invalidated.\n\n' +
      'Return ONLY a numbered attack list in exactly this shape:\n\n' +
      '1. **[severity: fatal | serious | nit]** Short title\n' +
      '   - Claim attacked: quote or paraphrase of the story\n' +
      '   - Why it fails: ...\n' +
      '   - What would answer it: a specific filing item, KPI, or source\n' +
      '   - Disposition: unanswered\n\n' +
      'Severity: fatal = the thesis or valuation cannot stand until fixed; serious = the verdict should move ' +
      'if unanswered; nit = wording or a minor inconsistency. Every attack ends with the literal line ' +
      '"- Disposition: unanswered" — dispositions are the orchestrator\'s to fill, never yours. ' +
      'If you find nothing material, say so in one sentence and still return at least three nit probes.',
    tools: READ_ONLY_TOOLS,
    maxIterations: 8,
  },
  scorer: {
    whenToUse:
      'Jenga factor scorecard on a finished story. Only after the story file exists on disk with `jenga: pending` — pass the story path in `task`. Never before write_file, never as a substitute for valuation, and always before the critic spawn so the critic reads the scored story.',
    systemPrompt:
      `${WORKER_PREAMBLE}\n\n` +
      'You are a Jenga scorer. The task names the path of a written investigation story. ' +
      'Start with read_file on that path — it is your only briefing — then read_file brain/jenga-checklist.md ' +
      'for the ten categories and their sub-factor rubric.\n\n' +
      'Score each of the ten categories 0-10 (integers), in the checklist\'s order, using the sub-factor ' +
      'weights as your rubric within a category. Every score needs one line of evidence and a source: tool ' +
      'plus URL, or filing form plus section. Reuse the numbers the story already cites — cite the underlying ' +
      'source the story names, never the story file itself — and spend your tool budget on what the story ' +
      'does not carry: proxy and remuneration disclosures, market structure, pricing history, the survival ' +
      'record. If the story frontmatter says venue: non-us, the get_financials, get_market_data and ' +
      'read_filings tools are closed for that name — use web_fetch of the issuer instead.\n\n' +
      'If you cannot source a category, write UNSOURCED in its Source cell and cap that score at 5. Never ' +
      'fill a score from what a company of this kind is typically like.\n\n' +
      'Arithmetic: Total is the sum of the ten scores, out of 100. Bucket: high moat >75, moderate moat ' +
      '70-75, weak moat 65-70, no moat <65 — except when more than 3 categories are UNSOURCED, in which ' +
      'case Bucket is the words "insufficient evidence". Unsourced counts the UNSOURCED categories. Scored ' +
      'is the story\'s frontmatter date.\n\n' +
      'Return ONLY this block, no prose before or after it:\n\n' +
      '<!-- gd:jenga-block v1 -->\n' +
      '| Category | Score /10 | Evidence | Source |\n' +
      '| --- | --- | --- | --- |\n' +
      '| New entry difficulty | 7 | one line | 10-K Item 1, https://... |\n' +
      '| ...one row per category, all ten, in checklist order... |\n' +
      '| Total | 71/100 | | |\n' +
      '| Bucket | moderate moat | | |\n' +
      '| Unsourced | 1 of 10 | | |\n' +
      '| Scored | 2026-08-18 | | |\n' +
      '<!-- /gd:jenga-block -->\n\n' +
      'The scores never feed a valuation: no discount-rate, growth, or price implication, and never buy, ' +
      'sell, or hold.',
    tools: READ_ONLY_TOOLS,
    maxIterations: 8,
  },
};

export const DEFAULT_SUBAGENT_TYPE = 'general-purpose';

/** The subagent types the leader may choose from. */
export const SUBAGENT_TYPE_NAMES = Object.keys(SUBAGENT_TYPES) as [string, ...string[]];

/** Resolve a type's tool allow-list with disallowed tools stripped defensively. */
export function resolveSubagentTools(typeKey: string): string[] {
  const cfg = SUBAGENT_TYPES[typeKey] ?? SUBAGENT_TYPES[DEFAULT_SUBAGENT_TYPE];
  return cfg.tools.filter(t => !SUBAGENT_DISALLOWED_TOOLS.has(t));
}
