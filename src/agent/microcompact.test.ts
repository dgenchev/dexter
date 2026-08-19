import { describe, expect, test } from 'bun:test';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { MC_CLEARED_MESSAGE, microcompactMessages } from './microcompact.js';

function toolMsg(name: string, chars: number, id: string): ToolMessage {
  return new ToolMessage({ content: 'x'.repeat(chars), tool_call_id: id, name });
}

/** n compactable results of the given size, enough to fire the count trigger. */
function conversation(count: number, chars: number, name = 'read_file'): ToolMessage[] {
  return Array.from({ length: count }, (_, i) => toolMsg(name, chars, `call_${i}`));
}

describe('microcompact size floor', () => {
  test('keeps small results when only the count trigger fired', () => {
    // A pinned doctrine table is ~2KB. Clearing it saves almost nothing and
    // costs the model a whole round to read again — which is how a valuation
    // run spent 6 of 10 rounds re-reading the same two files.
    const messages = [new AIMessage('go'), ...conversation(12, 500)];
    const result = microcompactMessages(messages);

    expect(result.cleared).toBe(0);
    expect(result.trigger).toBeNull();
    for (const msg of result.messages.slice(1)) {
      expect((msg as ToolMessage).content).not.toBe(MC_CLEARED_MESSAGE);
    }
  });

  test('still clears large results on the count trigger', () => {
    const messages = [new AIMessage('go'), ...conversation(12, 8_000)];
    const result = microcompactMessages(messages);

    expect(result.trigger).toBe('count');
    expect(result.cleared).toBeGreaterThan(0);
  });

  test('clears a mix down to the large ones only', () => {
    const messages = [
      new AIMessage('go'),
      ...conversation(6, 400),
      ...conversation(6, 9_000),
    ];
    const result = microcompactMessages(messages);

    const cleared = result.messages.filter(
      (m) => m instanceof ToolMessage && m.content === MC_CLEARED_MESSAGE,
    );
    expect(cleared.length).toBe(result.cleared);
    // Every surviving result is either recent or small; no big one lingers
    // outside the keep window while a small one was dropped.
    expect(result.cleared).toBeLessThan(12);
    expect(result.cleared).toBeGreaterThan(0);
  });

  test('token trigger still clears regardless of individual size', () => {
    // Few-but-huge: under the count threshold, over the token threshold.
    const messages = [new AIMessage('go'), ...conversation(6, 60_000)];
    const result = microcompactMessages(messages);

    expect(result.trigger).toBe('token');
    expect(result.cleared).toBeGreaterThan(0);
  });

  test('bash results are never compactable', () => {
    const messages = [new AIMessage('go'), ...conversation(12, 9_000, 'bash')];
    const result = microcompactMessages(messages);

    expect(result.cleared).toBe(0);
  });
});
