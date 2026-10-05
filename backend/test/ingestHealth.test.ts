import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createIngestHealth } from '../src/ingestHealth';

describe('ingest health', () => {
  test('is failing only while the latest outcome is a failure, and forgets it after the window', () => {
    let now = 0;
    const ingest = createIngestHealth(60_000, () => now);
    assert.equal(ingest.failing(), false);
    ingest.failed();
    assert.equal(ingest.failing(), true);
    ingest.succeeded();
    assert.equal(ingest.failing(), false);
    ingest.failed();
    now += 60_000;
    assert.equal(ingest.failing(), true);
    now += 1;
    assert.equal(ingest.failing(), false);
  });
});
