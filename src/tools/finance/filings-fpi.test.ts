import { describe, expect, test } from 'bun:test';
import {
  EXTRACTABLE_FILING_TYPES,
  FILING_TYPE_FILTERS,
  METADATA_ONLY_NOTE,
  getFilings,
  isExtractableFilingType,
  partitionFilingsByExtractability,
} from './filings.js';

// Foreign private issuers (BABA, SE, ASML, ...) file 20-F/6-K, never
// 10-K/10-Q/8-K. Filtering their filings by 10-K used to be the only option
// and returned a bare 404 that read as "no coverage".

describe('filing type filters', () => {
  test('metadata filter accepts the foreign-private-issuer forms', () => {
    expect(FILING_TYPE_FILTERS).toContain('20-F');
    expect(FILING_TYPE_FILTERS).toContain('6-K');
  });

  test('get_filings schema accepts 20-F/6-K and rejects unknown forms', () => {
    const parsed = getFilings.schema.safeParse({
      ticker: 'BABA',
      filing_type: ['20-F', '6-K'],
      limit: 3,
    });
    expect(parsed.success).toBe(true);

    const rejected = getFilings.schema.safeParse({
      ticker: 'BABA',
      filing_type: ['S-1'],
      limit: 3,
    });
    expect(rejected.success).toBe(false);
  });
});

describe('isExtractableFilingType', () => {
  test('items endpoint forms, including amendments', () => {
    for (const type of EXTRACTABLE_FILING_TYPES) {
      expect(isExtractableFilingType(type)).toBe(true);
    }
    expect(isExtractableFilingType('10-K/A')).toBe(true);
  });

  test('everything else is metadata-only', () => {
    expect(isExtractableFilingType('20-F')).toBe(false);
    expect(isExtractableFilingType('6-K')).toBe(false);
    expect(isExtractableFilingType('4')).toBe(false);
  });
});

describe('partitionFilingsByExtractability', () => {
  const tenK = { filing_type: '10-K', accession_number: 'a' };
  const twentyF = { filing_type: '20-F', accession_number: 'b' };
  const sixK = { filing_type: '6-K', accession_number: 'c' };

  test('splits a mixed filing list by items-endpoint support', () => {
    const { extractable, metadataOnly } = partitionFilingsByExtractability([tenK, twentyF, sixK]);
    expect(extractable).toEqual([tenK]);
    expect(metadataOnly).toEqual([twentyF, sixK]);
  });

  test('a malformed filing lands in metadata-only rather than crashing', () => {
    const { extractable, metadataOnly } = partitionFilingsByExtractability([{}, null]);
    expect(extractable).toEqual([]);
    expect(metadataOnly).toEqual([{}, null]);
  });
});

describe('metadata-only note', () => {
  test('points the model at EDGAR via web_fetch', () => {
    expect(METADATA_ONLY_NOTE).toContain('web_fetch');
    expect(METADATA_ONLY_NOTE).toContain('EDGAR');
  });
});
