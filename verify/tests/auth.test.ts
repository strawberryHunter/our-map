import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authErrorMessage, checkCredentials } from '../../src/lib/auth';

test('form checks: email shape, password length, matching confirm on sign-up', () => {
  assert.equal(checkCredentials(' mj@example.com ', '12345678', 'signin'), null);
  assert.match(checkCredentials('mj@example', '12345678', 'signin')!, /이메일/);
  assert.match(checkCredentials('mj@example.com', '1234567', 'signin')!, /8자/);
  assert.match(checkCredentials('mj@example.com', '12345678', 'signup', '12345679')!, /확인/);
  assert.equal(checkCredentials('mj@example.com', '12345678', 'signup', '12345678'), null);
});

test('Supabase errors become Korean messages, never raw English', () => {
  assert.match(authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' }), /맞지 않아요/);
  assert.match(authErrorMessage({ code: 'user_already_exists', message: 'User already registered' }), /이미 가입/);
  assert.match(authErrorMessage({ code: 'signup_disabled', message: 'Signups not allowed for this instance' }), /가입이 막혀/);
  assert.match(authErrorMessage({ status: 429, message: 'rate limit' }), /잠시 후/);
  assert.match(authErrorMessage({ message: 'Network request failed' }), /인터넷/);
  assert.match(authErrorMessage(null), /로그인하지 못했어요/);
});
