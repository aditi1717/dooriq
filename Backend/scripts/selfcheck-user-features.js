/**
 * Self-check for the pure logic behind the user-account endpoints.
 *
 * Covers the two places a silent mistake would be expensive: the cashback
 * amount (real money) and the chat thread key (a wrong one splits a
 * conversation in two). Everything else in these modules is a database round
 * trip, which belongs in an integration test, not here.
 *
 * Run: node scripts/selfcheck-user-features.js
 */
import assert from 'node:assert/strict';
import { calculateCashback } from '../src/modules/food/user/services/userCashback.service.js';
import { conversationKey } from '../src/modules/food/chat/services/chat.service.js';

const on = { isEnabled: true, cashbackType: 'percentage', cashbackValue: 10, minOrderValue: 200, maxCashback: 50 };

// Disabled, or below the minimum, pays nothing.
assert.equal(calculateCashback({ ...on, isEnabled: false }, 500), 0);
assert.equal(calculateCashback(on, 199), 0);
assert.equal(calculateCashback(null, 500), 0);

// Percentage, and the cap that stops a large order paying out unbounded.
assert.equal(calculateCashback(on, 300), 30);
assert.equal(calculateCashback(on, 1000), 50);
assert.equal(calculateCashback({ ...on, maxCashback: 0 }, 1000), 100, 'maxCashback 0 means uncapped');

// Flat cashback ignores order size once the minimum is met.
assert.equal(calculateCashback({ ...on, cashbackType: 'flat', cashbackValue: 25 }, 1000), 25);

// Non-numeric totals must not produce NaN credits.
assert.equal(calculateCashback(on, undefined), 0);
assert.equal(calculateCashback(on, -100), 0);

const user = { role: 'USER', id: 'u1' };
const rider = { role: 'DELIVERY_PARTNER', id: 'd1' };

// Whoever sends first, both sides address the same thread.
assert.equal(conversationKey(user, rider, 'o1'), conversationKey(rider, user, 'o1'));

// A thread is per order, so two orders with the same rider stay separate.
assert.notEqual(conversationKey(user, rider, 'o1'), conversationKey(user, rider, 'o2'));

// Support has no peer id — every admin shares one desk-side thread per user.
const admin = { role: 'ADMIN', id: '' };
assert.equal(conversationKey(user, admin, ''), conversationKey(user, { role: 'ADMIN', id: 'anyone' }, ''));

// ...but two different users never collide on it.
assert.notEqual(conversationKey(user, admin, ''), conversationKey({ role: 'USER', id: 'u2' }, admin, ''));

console.log('selfcheck-user-features: all assertions passed');
