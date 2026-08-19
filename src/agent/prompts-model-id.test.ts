import { describe, expect, test } from 'bun:test';
import { buildSystemPrompt } from './prompts.js';

describe('system prompt states the model id', () => {
  test('the configured model appears verbatim', () => {
    // A run wrote `author_model: gpt-5.2-codex` into a story while
    // deepseek-v4-flash was configured. Self-reported identity is a guess;
    // the harness knows the answer and never said it.
    const prompt = buildSystemPrompt('openrouter:deepseek/deepseek-v4-flash-0731');
    expect(prompt).toContain('openrouter:deepseek/deepseek-v4-flash-0731');
    expect(prompt).toContain('Your model id:');
  });

  test('it tracks whatever model is passed, so /model switches follow', () => {
    const prompt = buildSystemPrompt('openrouter:openai/gpt-5.6-sol');
    expect(prompt).toContain('Your model id: openrouter:openai/gpt-5.6-sol');
    expect(prompt).not.toContain('deepseek');
  });
});
