import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { apiBaseUrl } from './apiBase.ts';

describe('apiBaseUrl', () => {
  it('is empty when VITE_API_URL is unset, so every request is same-origin', () => {
    assert.equal(apiBaseUrl(undefined), '');
    assert.equal(apiBaseUrl(''), '');
    assert.equal(apiBaseUrl('   '), '');
  });

  it('keeps a dev backend address as given, without a trailing slash', () => {
    assert.equal(apiBaseUrl('http://localhost:3001'), 'http://localhost:3001');
    assert.equal(apiBaseUrl('http://localhost:3001/'), 'http://localhost:3001');
    assert.equal(apiBaseUrl(' https://example.test/ '), 'https://example.test');
  });
});
