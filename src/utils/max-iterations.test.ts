import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { dexterPath } from './paths.js';
import { resolveMaxIterations } from './config.js';

const SETTINGS = dexterPath('settings.json');
const BACKUP = `${SETTINGS}.max-iterations-test-backup`;

function withSettings(body: unknown | null, run: () => void): void {
  const had = existsSync(SETTINGS);
  if (had) renameSync(SETTINGS, BACKUP);
  try {
    if (body !== null) {
      mkdirSync(dirname(SETTINGS), { recursive: true });
      writeFileSync(SETTINGS, JSON.stringify(body));
    }
    run();
  } finally {
    if (existsSync(SETTINGS)) rmSync(SETTINGS);
    if (had) renameSync(BACKUP, SETTINGS);
  }
}

afterEach(() => {
  delete process.env.DEXTER_MAX_ITERATIONS;
});

describe('resolveMaxIterations', () => {
  test('falls back to the caller default when nothing is configured', () => {
    withSettings({}, () => {
      expect(resolveMaxIterations(10)).toBe(10);
      expect(resolveMaxIterations(6, 'cronMaxIterations')).toBe(6);
    });
  });

  test('reads settings.json', () => {
    withSettings({ maxIterations: 20, cronMaxIterations: 12 }, () => {
      expect(resolveMaxIterations(10)).toBe(20);
      expect(resolveMaxIterations(6, 'cronMaxIterations')).toBe(12);
    });
  });

  test('cron and cli caps are independent', () => {
    withSettings({ maxIterations: 20 }, () => {
      expect(resolveMaxIterations(10)).toBe(20);
      // cron must not inherit the interactive cap: it runs unattended
      expect(resolveMaxIterations(6, 'cronMaxIterations')).toBe(6);
    });
  });

  test('env overrides settings', () => {
    withSettings({ maxIterations: 20 }, () => {
      process.env.DEXTER_MAX_ITERATIONS = '33';
      expect(resolveMaxIterations(10)).toBe(33);
    });
  });

  test('junk values fall through to the default rather than zeroing the loop', () => {
    withSettings({ maxIterations: 0 }, () => {
      expect(resolveMaxIterations(10)).toBe(10);
    });
    withSettings({ maxIterations: -5 }, () => {
      expect(resolveMaxIterations(10)).toBe(10);
    });
    withSettings({}, () => {
      process.env.DEXTER_MAX_ITERATIONS = 'not-a-number';
      expect(resolveMaxIterations(10)).toBe(10);
    });
  });
});
