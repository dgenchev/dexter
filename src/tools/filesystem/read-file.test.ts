import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFileTool } from './read-file.js';
import { MAX_TOOL_RESULT_CHARS } from '../../utils/tool-result-storage.js';

const TEST_DIR = join(process.cwd(), '.dexter', 'read-file-tests');

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('read_file oversized lines', () => {
  test('automatically switches to resumable byte ranges', async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const path = join(TEST_DIR, 'large-result.json');
    const original = JSON.stringify({
      data: {
        filing: 'AWS '.repeat(30_000),
        marker: 'end-of-result',
      },
    });
    writeFileSync(path, original, 'utf-8');

    const firstRawResult = await readFileTool.invoke({ path, offset: 1, limit: 120 });
    let result = JSON.parse(firstRawResult);
    let reconstructed = result.data.content as string;

    expect(firstRawResult.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
    expect(result.data.truncated).toBe(true);
    expect(result.data.byteRange.start).toBe(0);
    expect(result.data.nextByteOffset).toBeGreaterThan(0);
    expect(result.data.continuation).toContain('byteOffset=');

    while (result.data.truncated) {
      result = JSON.parse(await readFileTool.invoke({
        path,
        byteOffset: result.data.nextByteOffset,
      }));
      reconstructed += result.data.content;
    }

    expect(reconstructed).toBe(original);
    expect(reconstructed).toContain('end-of-result');
  });

  test('keeps byte boundaries valid for multibyte UTF-8 text', async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const path = join(TEST_DIR, 'unicode.json');
    const original = JSON.stringify({ data: '🌕'.repeat(20_000) });
    writeFileSync(path, original, 'utf-8');

    let result = JSON.parse(await readFileTool.invoke({ path }));
    let reconstructed = result.data.content as string;

    while (result.data.truncated) {
      result = JSON.parse(await readFileTool.invoke({
        path,
        byteOffset: result.data.nextByteOffset,
      }));
      reconstructed += result.data.content;
    }

    expect(reconstructed).toBe(original);
    expect(reconstructed).not.toContain('�');
  });

  test('shrinks chunks whose JSON escaping would cross the persistence cap', async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const path = join(TEST_DIR, 'control-characters.txt');
    writeFileSync(path, '\0'.repeat(60_000), 'utf-8');

    const rawResult = await readFileTool.invoke({ path });
    const result = JSON.parse(rawResult);

    expect(rawResult.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
    expect(result.data.truncated).toBe(true);
    expect(result.data.nextByteOffset).toBeLessThan(32 * 1024);
  });
});

describe('read_file byteOffset alongside line-based params', () => {
  test('ignores a zero byteOffset so a line read still works', async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const path = join(TEST_DIR, 'doctrine.md');
    writeFileSync(path, 'alpha\nbravo\ncharlie\n', 'utf-8');

    // Models that fill every optional numeric field send byteOffset: 0 next to
    // offset/limit. A zero byte offset is the start of the file, so it adds
    // nothing to a line read and must not fail the call.
    const raw = await readFileTool.invoke({
      path,
      offset: 1,
      limit: 240,
      byteOffset: 0,
      byteLimit: 32768,
    });
    const result = JSON.parse(raw);
    expect(result.data.content).toContain('alpha');
    expect(result.data.content).toContain('charlie');
  });

  test('still rejects a real byte offset combined with line params, and says how to fix it', async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const path = join(TEST_DIR, 'doctrine.md');
    writeFileSync(path, 'alpha\nbravo\ncharlie\n', 'utf-8');

    expect(
      readFileTool.invoke({ path, offset: 1, limit: 2, byteOffset: 6 }),
    ).rejects.toThrow('omit byteOffset');
  });

  test('byteOffset zero on its own still reads a byte range', async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const path = join(TEST_DIR, 'doctrine.md');
    writeFileSync(path, 'alpha\nbravo\ncharlie\n', 'utf-8');

    const raw = await readFileTool.invoke({ path, byteOffset: 0, byteLimit: 5 });
    const result = JSON.parse(raw);
    expect(JSON.stringify(result)).toContain('alpha');
  });
});
