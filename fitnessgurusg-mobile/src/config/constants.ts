/**
 * App-wide constants — single source of truth for shared values.
 *
 * Import from here rather than defining locally in each file.
 * This prevents silent mismatches (e.g. AUTH_TOKEN_KEY defined differently
 * in AuthContext and apiClient would break login silently).
 */

// ─── AsyncStorage Keys ────────────────────────────────────────────────────────

/**
 * The AsyncStorage key used to store the JWT auth token.
 * Must match in AuthContext.tsx and apiClient.ts — import from here, do not redefine.
 */
export const AUTH_TOKEN_KEY = 'authToken';

/**
 * The AsyncStorage key used to store the serialised AuthUser object.
 * Set during login, cleared on logout.
 */
export const AUTH_USER_KEY = 'authUser';

/**
 * Set to 'true' immediately after a NEW client self-registers.
 * RootNavigator reads this to show the onboarding flow (SuccessScreen →
 * WelcomeScreen) exactly once. Cleared when the client taps through
 * the onboarding and reaches ClientAppTabs for the first time.
 */
export const FIRST_LOGIN_KEY = 'clientFirstLogin';

