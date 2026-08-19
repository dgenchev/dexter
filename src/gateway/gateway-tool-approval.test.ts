import { describe, expect, test } from 'bun:test';
import { createGatewayToolApproval } from './agent-runner.js';
import { parseRule, type RuleSet } from '../permissions/rules.js';

const rules = (parts: { allow?: string[]; ask?: string[]; deny?: string[] }): RuleSet => ({
  allow: (parts.allow ?? []).map((s) => parseRule(s)!).filter(Boolean),
  ask: (parts.ask ?? []).map((s) => parseRule(s)!).filter(Boolean),
  deny: (parts.deny ?? []).map((s) => parseRule(s)!).filter(Boolean),
  defaultBashDecision: 'ask',
});

// The desk's read-only script layer, as it appears in .dexter/settings.json.
const DESK_RULES = rules({
  allow: [
    'Bash(python3 scripts/lookup-holding.py:*)',
    'Bash(python3 scripts/company-snapshot.py:*)',
    'Bash(python3 scripts/yahoo-quote.py:*)',
    'Bash(python3 scripts/beta.py:*)',
  ],
});

describe('createGatewayToolApproval — non-interactive, deny-by-default', () => {
  test('allows a bash command matched by a settings allow rule', async () => {
    const approve = createGatewayToolApproval(DESK_RULES);
    const decision = await approve({
      tool: 'bash',
      args: { command: 'python3 scripts/lookup-holding.py ADBE' },
      command: 'python3 scripts/lookup-holding.py ADBE',
    });
    expect(decision).toBe('allow-once');
  });

  test('denies a destructive command', async () => {
    const approve = createGatewayToolApproval(DESK_RULES);
    expect(await approve({ tool: 'bash', args: {}, command: 'rm -rf /' })).toBe('deny');
  });

  test('denies any unmatched command, even a benign read-only one', async () => {
    const approve = createGatewayToolApproval(DESK_RULES);
    expect(await approve({ tool: 'bash', args: {}, command: 'git status' })).toBe('deny');
    expect(await approve({ tool: 'bash', args: {}, command: 'ls -la' })).toBe('deny');
  });

  test('a deny rule beats an allow rule', async () => {
    const both = rules({
      allow: ['Bash(python3 scripts/lookup-holding.py:*)'],
      deny: ['Bash(python3:*)'],
    });
    const approve = createGatewayToolApproval(both);
    expect(
      await approve({ tool: 'bash', args: {}, command: 'python3 scripts/lookup-holding.py ADBE' }),
    ).toBe('deny');
  });

  test('falls back to args.command when the request carries no command field', async () => {
    const approve = createGatewayToolApproval(DESK_RULES);
    expect(
      await approve({ tool: 'bash', args: { command: 'python3 scripts/beta.py --flag NL --list' } }),
    ).toBe('allow-once');
  });

  test('denies empty or missing commands', async () => {
    const approve = createGatewayToolApproval(DESK_RULES);
    expect(await approve({ tool: 'bash', args: {} })).toBe('deny');
    expect(await approve({ tool: 'bash', args: {}, command: '   ' })).toBe('deny');
  });

  test('write tools are approved only under investigations/', async () => {
    // The story protocol must write its story over a chat channel; the book,
    // doctrine and scripts stay mechanically unwritable. Both KSPI runs on
    // 2026-08-19 died silently at the story write_file before this.
    const approve = createGatewayToolApproval(DESK_RULES);
    expect(
      await approve({ tool: 'write_file', args: { path: 'investigations/KSPI/2026-08-19-worth.md' } }),
    ).toBe('allow-once');
    expect(
      await approve({ tool: 'edit_file', args: { path: 'investigations/KSPI/2026-08-19-worth.md' } }),
    ).toBe('allow-once');
  });

  test('write tools outside the morgue are denied', async () => {
    const approve = createGatewayToolApproval(DESK_RULES);
    expect(await approve({ tool: 'write_file', args: { path: 'config/portfolio.json' } })).toBe('deny');
    expect(await approve({ tool: 'edit_file', args: { path: '.dexter/RULES.md' } })).toBe('deny');
    expect(await approve({ tool: 'write_file', args: { path: 'x.md' } })).toBe('deny');
    expect(
      await approve({ tool: 'write_file', args: { path: 'investigations/../config/portfolio.json' } }),
    ).toBe('deny');
    expect(await approve({ tool: 'write_file', args: {} })).toBe('deny');
  });

  test('other non-bash tools stay denied', async () => {
    const approve = createGatewayToolApproval(DESK_RULES);
    expect(await approve({ tool: 'some_future_tool', args: {} })).toBe('deny');
  });
});
