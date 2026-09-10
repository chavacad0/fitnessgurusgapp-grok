/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FEATURE FLAGS — FITNESSGURUSG BACKEND
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Central toggle for features that are gated during development.
 * All flags default to false until backend endpoints are ready.
 */

/**
 * BOOKING_SYSTEM_ENABLED
 *
 * When true:  Booking validation is fully enforced (slot availability,
 *             session balance, expiry checks).
 * When false: Booking routes are still operational — validation is active.
 *             This flag can be used to relax validation during initial testing
 *             if needed. Currently unused — all booking logic is always on.
 */
export const BOOKING_SYSTEM_ENABLED = true;
