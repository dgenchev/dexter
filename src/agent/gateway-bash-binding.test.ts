import { describe, expect, test } from 'bun:test';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { Agent } from './agent.js';
import type { ApprovalDecision } from './types.js';

// bash is only registered on non-Windows platforms; these tests assert channel
// gating, which presupposes the tool exists at all.
const itUnix = process.platform === 'win32' ? test.skip : test;

const approval = async (): Promise<ApprovalDecision> => 'deny';

/** Bound tool names of an agent (tools is private; tests peek deliberately). */
function boundTools(agent: Agent): string[] {
  return (agent as unknown as { tools: StructuredToolInterface[] }).tools.map((t) => t.name);
}

/** systemPromptOverride keeps Agent.create off the soul/rules/memory files. */
async function create(config: {
  channel?: string;
  requestToolApproval?: typeof approval;
}): Promise<Agent> {
  return Agent.create({ ...config, systemPromptOverride: 'test prompt', memoryEnabled: false });
}

describe('channel gating of interactive and approval-gated tools', () => {
  itUnix('non-CLI channel with an approval callback binds bash but never ask_user_question', async () => {
    const agent = await create({ channel: 'telegram', requestToolApproval: approval });
    const names = boundTools(agent);
    expect(names).toContain('bash');
    expect(names).not.toContain('ask_user_question');
  });

  itUnix('non-CLI channel without a callback drops bash (executor would deny-and-end the turn)', async () => {
    const agent = await create({ channel: 'telegram' });
    const names = boundTools(agent);
    expect(names).not.toContain('bash');
    expect(names).not.toContain('ask_user_question');
  });

  itUnix('cli channel binds both, with or without a callback', async () => {
    for (const requestToolApproval of [approval, undefined]) {
      const agent = await create({ channel: 'cli', requestToolApproval });
      const names = boundTools(agent);
      expect(names).toContain('bash');
      expect(names).toContain('ask_user_question');
    }
  });

  itUnix('no channel means CLI: both tools stay bound', async () => {
    const agent = await create({});
    const names = boundTools(agent);
    expect(names).toContain('bash');
    expect(names).toContain('ask_user_question');
  });
});
