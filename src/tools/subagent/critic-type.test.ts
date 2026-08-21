import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SUBAGENT_TYPE,
  SUBAGENT_TYPES,
  SUBAGENT_TYPE_NAMES,
  resolveSubagentTools,
} from './types.js';
import { formatSubagentResult, resolveSpawnModel } from './spawn-subagent.js';

describe('critic subagent type', () => {
  test('is registered and selectable', () => {
    expect(SUBAGENT_TYPES.critic).toBeDefined();
    expect(SUBAGENT_TYPE_NAMES).toContain('critic');
    expect(DEFAULT_SUBAGENT_TYPE).not.toBe('critic');
  });

  test('is read-only: never bash, never spawn', () => {
    const tools = resolveSubagentTools('critic');
    expect(tools).toContain('read_file');
    expect(tools).toContain('read_filings');
    expect(tools).not.toContain('bash');
    expect(tools).not.toContain('spawn_subagent');
    expect(tools).not.toContain('write_file');
    expect(tools).not.toContain('edit_file');
  });

  test('whenToUse gates on a story already written to disk', () => {
    // A registered type's whenToUse is an instruction: on 2026-08-17 a model
    // spawned critics unprompted before it had a draft. The gate must name
    // the precondition.
    const when = SUBAGENT_TYPES.critic.whenToUse;
    expect(when).toContain('critic: pending');
    expect(when.toLowerCase()).toContain('never before');
  });

  test('system prompt carries the format the lint parses', () => {
    // Subagents never see project skills, so the attack format must live here.
    const prompt = SUBAGENT_TYPES.critic.systemPrompt;
    expect(prompt).toContain('[severity: fatal | serious | nit]');
    expect(prompt).toContain('Claim attacked');
    expect(prompt).toContain('Disposition: unanswered');
    expect(prompt).toContain('read_file');
    expect(prompt.toLowerCase()).toContain('venue: non-us');
    expect(prompt.toLowerCase()).toContain('never output buy, sell, or hold');
  });

  test('iteration budget matches the other worker types', () => {
    expect(SUBAGENT_TYPES.critic.maxIterations).toBe(8);
  });

  test('attacks the Jenga scorecard when present', () => {
    // The scorecard is authored by a subagent the parent chose; the critic is
    // the independent reader that keeps its scores honest.
    const prompt = SUBAGENT_TYPES.critic.systemPrompt;
    expect(prompt).toContain('Jenga scorecard');
    expect(prompt).toContain('UNSOURCED');
    expect(prompt.toLowerCase()).toContain('carried');
  });
});

describe('scorer subagent type', () => {
  test('is registered and selectable, and not the default', () => {
    expect(SUBAGENT_TYPES.scorer).toBeDefined();
    expect(SUBAGENT_TYPE_NAMES).toContain('scorer');
    expect(DEFAULT_SUBAGENT_TYPE).not.toBe('scorer');
  });

  test('is read-only: never bash, never spawn, never write', () => {
    const tools = resolveSubagentTools('scorer');
    expect(tools).toContain('read_file');
    expect(tools).not.toContain('bash');
    expect(tools).not.toContain('spawn_subagent');
    expect(tools).not.toContain('write_file');
    expect(tools).not.toContain('edit_file');
  });

  test('whenToUse gates on a story already on disk, before the critic', () => {
    // Same lesson as the critic gate: a registered type's whenToUse is an
    // instruction, and the ordering (score, then critic) is what lets the
    // critic attack the scored story.
    const when = SUBAGENT_TYPES.scorer.whenToUse;
    expect(when).toContain('jenga: pending');
    expect(when.toLowerCase()).toContain('never before');
    expect(when.toLowerCase()).toContain('before the critic');
  });

  test('system prompt carries the block format the lint parses', () => {
    // Subagents never see project skills, so the block contract must live here.
    const prompt = SUBAGENT_TYPES.scorer.systemPrompt;
    expect(prompt).toContain('<!-- gd:jenga-block v1 -->');
    expect(prompt).toContain('<!-- /gd:jenga-block -->');
    expect(prompt).toContain('| Category | Score /10 | Evidence | Source |');
    expect(prompt).toContain('brain/jenga-checklist.md');
    expect(prompt).toContain('UNSOURCED');
    // The bucket/moat label was retired 2026-08-21: the total travels with its
    // evidence gap and the reader draws the conclusion.
    expect(prompt).not.toContain('| Bucket |');
    expect(prompt.toLowerCase()).not.toContain('moderate moat');
    expect(prompt).toContain('verbatim');
    expect(prompt.toLowerCase()).toContain('venue: non-us');
  });

  test('states the valuation firewall and the no-recommendation law', () => {
    const prompt = SUBAGENT_TYPES.scorer.systemPrompt;
    expect(prompt.toLowerCase()).toContain('never feed a valuation');
    expect(prompt.toLowerCase()).toContain('buy');
  });

  test('iteration budget matches the other worker types', () => {
    expect(SUBAGENT_TYPES.scorer.maxIterations).toBe(8);
  });
});

describe('resolveSpawnModel', () => {
  test('parent model when nothing else is given', () => {
    expect(resolveSpawnModel('openrouter:openai/gpt-5.6-terra')).toBe(
      'openrouter:openai/gpt-5.6-terra',
    );
  });

  test('spawn input beats the parent', () => {
    expect(resolveSpawnModel('parent-model', 'openrouter:openai/gpt-5.6-sol')).toBe(
      'openrouter:openai/gpt-5.6-sol',
    );
  });

  test('configured criticModel beats the spawn input', () => {
    // Harness-controlled beats model-chosen: the critic model is an operator
    // setting, not something the parent picks for its own adversary.
    expect(
      resolveSpawnModel('parent-model', 'model-chosen', 'openrouter:openai/gpt-5.6-sol'),
    ).toBe('openrouter:openai/gpt-5.6-sol');
  });

  test('blank values fall through', () => {
    expect(resolveSpawnModel('parent-model', '   ', '')).toBe('parent-model');
    expect(resolveSpawnModel('parent-model', undefined, '  ')).toBe('parent-model');
  });
});

describe('formatSubagentResult', () => {
  test('names the resolved model so the parent copies, not guesses', () => {
    // critic_model must be harness-known. A run once wrote author_model
    // gpt-5.2-codex while deepseek was configured; self-reported identity
    // is a guess, and this payload is what removes the guessing.
    const out = formatSubagentResult('attack list here', 'critic', 'openrouter:openai/gpt-5.6-sol');
    expect(out).toContain('attack list here');
    expect(out).toContain('model: openrouter:openai/gpt-5.6-sol');
  });

  test('includes token usage when known', () => {
    const out = formatSubagentResult('answer', 'critic', 'm', { totalTokens: 1234 } as never);
    expect(out).toContain('1234 tokens');
    expect(out).toContain('model: m');
  });
});
