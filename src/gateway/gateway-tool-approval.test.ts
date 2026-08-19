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

  test('denies non-bash tools (write_file/edit_file keep the no-callback behavior)', async () => {
    const approve = createGatewayToolApproval(DESK_RULES);
    expect(await approve({ tool: 'write_file', args: { path: 'x.md' } })).toBe('deny');
    expect(await approve({ tool: 'edit_file', args: { path: 'x.md' } })).toBe('deny');
  });
});
