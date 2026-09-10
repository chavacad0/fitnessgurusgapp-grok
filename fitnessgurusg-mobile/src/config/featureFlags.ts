/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FEATURE FLAGS — FITNESSGURUSG MOBILE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Central place to toggle features on/off during development.
 * All flags default to false until the feature is ready.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * BOOKING_SYSTEM_ENABLED
 *
 * When true:  Coach availability and session booking UI is shown.
 * When false: Booking tab/entry points are hidden; app operates in
 *             check-in + session-tracking mode only.
 *
 * Set to true once GET /api/coach/availability and POST /api/sessions/book
 * backend endpoints are implemented and tested.
 */
export const BOOKING_SYSTEM_ENABLED = false;
