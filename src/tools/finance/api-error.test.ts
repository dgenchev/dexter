import { describe, expect, test } from 'bun:test';
import { formatFdHttpError } from './api.js';

describe('formatFdHttpError', () => {
  test('includes JSON message', () => {
    const text = formatFdHttpError(400, 'Bad Request', '{"error":"Invalid TICKER","message":"Please provide a valid TICKER."}');
    expect(text).toContain('400');
    expect(text).toContain('Invalid TICKER');
  });
});
