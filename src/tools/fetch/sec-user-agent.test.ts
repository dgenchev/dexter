import { afterEach, describe, expect, test } from 'bun:test';
import { getWebFetchUserAgent, isSecEdgarHost } from './utils.js';

// SEC EDGAR's fair-access policy answers undeclared clients with 403; the
// first BABA run lost its 20-F thread to exactly that.

const DEFAULT_UA = 'Dexter-User (dexter-ts; +https://github.com/)';
const savedEnv = process.env.SEC_EDGAR_USER_AGENT;

afterEach(() => {
  if (savedEnv === undefined) {
    delete process.env.SEC_EDGAR_USER_AGENT;
  } else {
    process.env.SEC_EDGAR_USER_AGENT = savedEnv;
  }
});

describe('isSecEdgarHost', () => {
  test('matches sec.gov and its subdomains only', () => {
    expect(isSecEdgarHost('https://www.sec.gov/Archives/edgar/data/1577552/x.htm')).toBe(true);
    expect(isSecEdgarHost('https://sec.gov/')).toBe(true);
    expect(isSecEdgarHost('https://efts.sec.gov/LATEST/search-index?q=x')).toBe(true);
    expect(isSecEdgarHost('https://notsec.gov/')).toBe(false);
    expect(isSecEdgarHost('https://sec.gov.evil.example/')).toBe(false);
    expect(isSecEdgarHost('https://example.com/www.sec.gov')).toBe(false);
    expect(isSecEdgarHost('not a url')).toBe(false);
  });
});

describe('getWebFetchUserAgent', () => {
  test('declared identity is used for sec.gov when configured', () => {
    process.env.SEC_EDGAR_USER_AGENT = 'Example Desk research@example.com';
    expect(getWebFetchUserAgent('https://www.sec.gov/Archives/edgar/x.htm')).toBe(
      'Example Desk research@example.com',
    );
  });

  test('other hosts keep the default UA even when configured', () => {
    process.env.SEC_EDGAR_USER_AGENT = 'Example Desk research@example.com';
    expect(getWebFetchUserAgent('https://example.com/page')).toBe(DEFAULT_UA);
  });

  test('sec.gov falls back to the default UA when unset or blank', () => {
    delete process.env.SEC_EDGAR_USER_AGENT;
    expect(getWebFetchUserAgent('https://www.sec.gov/x')).toBe(DEFAULT_UA);
    process.env.SEC_EDGAR_USER_AGENT = '   ';
    expect(getWebFetchUserAgent('https://www.sec.gov/x')).toBe(DEFAULT_UA);
  });

  test('no url argument keeps the default UA', () => {
    process.env.SEC_EDGAR_USER_AGENT = 'Example Desk research@example.com';
    expect(getWebFetchUserAgent()).toBe(DEFAULT_UA);
  });
});
