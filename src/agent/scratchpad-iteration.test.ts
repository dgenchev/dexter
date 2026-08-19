import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { Scratchpad } from './scratchpad.js';

describe('scratchpad iteration stamps', () => {
  test('entries record the loop round that produced them', () => {
    const pad = new Scratchpad('iteration stamp test query');

    pad.setIteration(1);
    pad.addToolResult('bash', { command: 'echo one' }, '"one"');
    pad.addThinking('thinking in round one');
    pad.setIteration(2);
    pad.addToolResult('read_file', { path: 'x.md' }, '"content"');

    const lines = readFileSync(pad.getFilepath(), 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    // init is written in the constructor, before any round
    expect(lines[0].type).toBe('init');
    expect(lines[0].iteration).toBeUndefined();

    expect(lines[1].toolName).toBe('bash');
    expect(lines[1].iteration).toBe(1);
    expect(lines[2].type).toBe('thinking');
    expect(lines[2].iteration).toBe(1);
    expect(lines[3].toolName).toBe('read_file');
    expect(lines[3].iteration).toBe(2);
  });
});
