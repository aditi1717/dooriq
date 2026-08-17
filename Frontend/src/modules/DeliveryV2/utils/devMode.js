/**
 * Single definition of "proximity rules are relaxed for testing".
 *
 * Two places used to make this decision independently and in OPPOSITE directions:
 * the auto-arrival trigger required `!import.meta.env.DEV` (so it never ran
 * locally), while the proximity gate forced `isWithinRange = true` in DEV (so the
 * manual buttons were always unlocked). The net effect was that the arrival flow
 * behaved differently in development than in production and so was never really
 * exercised before shipping.
 *
 * Now both read this flag, so relaxing the rules relaxes them consistently.
 */
export const isProximityBypassEnabled = () =>
  import.meta.env.VITE_APP_MODE === 'developer' ||
  import.meta.env.VITE_ENABLE_RANGE_BYPASS === 'true' ||
  Boolean(import.meta.env.DEV);
