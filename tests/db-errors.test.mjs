import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDatabaseError } from '../lib/db.js';

test('database network failures return an actionable message and service-unavailable status', () => {
  for (const message of ['TypeError: fetch failed', 'fetch failed', 'Failed to fetch']) {
    assert.throws(() => checkDatabaseError({ message }), error => {
      assert.equal(error.status, 503);
      assert.match(error.message, /SUPABASE_URL/);
      assert.match(error.message, /프로젝트 실행 상태/);
      return true;
    });
  }
});

test('database errors preserve query errors and accept successful results', () => {
  assert.doesNotThrow(() => checkDatabaseError(null));
  assert.throws(() => checkDatabaseError({ message: 'Invalid API key' }), error => {
    assert.equal(error.message, 'Invalid API key');
    assert.equal(error.status, undefined);
    return true;
  });
});
