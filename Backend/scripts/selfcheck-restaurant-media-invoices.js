import assert from 'node:assert/strict';
import { buildSubscriptionInvoices } from '../src/modules/food/restaurant/services/subscriptionHistory.service.js';
import { sameImage } from '../src/modules/food/restaurant/services/restaurantMedia.service.js';

// --- subscription invoice roll-up -------------------------------------------
const ev = (createdAt, eventType, amount, dueAfter, plan = 'gold') => ({
    createdAt: new Date(createdAt), eventType, amount, dueAfter, plan
});

const { invoices } = buildSubscriptionInvoices([
    // September: charged 1000, paid 400 -> partially settled, 600 outstanding
    ev('2026-09-20T06:00:00Z', 'subscription_payment', 400, 600),
    ev('2026-09-01T06:00:00Z', 'subscription_renewal_due_added', 1000, 1000),
    // August: charged 1000, auto-deducted in full -> settled
    ev('2026-08-15T06:00:00Z', 'subscription_auto_deduct', 1000, 0),
    ev('2026-08-01T06:00:00Z', 'subscription_renewal_due_added', 1000, 1000),
    // July: charge only, nothing paid -> pending
    ev('2026-07-01T06:00:00Z', 'subscription_renewal_due_added', 500, 500),
]);

assert.deepEqual(invoices.map((i) => i._id), ['2026-09', '2026-08', '2026-07'], 'newest month first');

const [sep, aug, jul] = invoices;
assert.deepEqual(
    { total: sep.totalAmount, paid: sep.paidAmount, out: sep.outstandingAmount, status: sep.status },
    { total: 1000, paid: 400, out: 600, status: 'partially_settled' }
);
assert.deepEqual(
    { total: aug.totalAmount, paid: aug.paidAmount, out: aug.outstandingAmount, status: aug.status },
    { total: 1000, paid: 1000, out: 0, status: 'settled' }
);
assert.equal(jul.status, 'pending');
assert.equal(sep.planName, 'gold');
assert.match(sep.billingMonthLabel, /September 2026/);

// A payment-only month (and the legacy fallback event) still bills a real
// figure rather than zero: paid + still-outstanding.
const legacy = buildSubscriptionInvoices([
    ev('2026-06-10T06:00:00Z', 'subscription_payment', 700, 300),
]).invoices[0];
assert.equal(legacy.totalAmount, 1000);
assert.equal(legacy.status, 'partially_settled');

// Month boundaries are bucketed in IST, not UTC: 2026-05-31T20:00Z is
// 2026-06-01 01:30 IST and belongs to June.
assert.equal(buildSubscriptionInvoices([ev('2026-05-31T20:00:00Z', 'subscription_payment', 1, 0)]).invoices[0]._id, '2026-06');

assert.deepEqual(buildSubscriptionInvoices([]).invoices, []);

// --- gallery image matching --------------------------------------------------
assert.ok(sameImage('/uploads/img_a.webp', '/uploads/img_a.webp'));
assert.ok(sameImage('/uploads/img_a.webp', 'https://dooriq.in/uploads/img_a.webp'), 'absolute URL matches stored relative path');
assert.ok(sameImage('/uploads/img_a.webp', 'https://dooriq.in/uploads/img_a.webp?v=2'), 'query string ignored');
assert.ok(!sameImage('/uploads/img_a.webp', '/uploads/img_b.webp'));
assert.ok(!sameImage('', '/uploads/img_a.webp'), 'empty target never matches');

console.log('selfcheck-restaurant-media-invoices: OK');
