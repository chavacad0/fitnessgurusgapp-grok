/**
 * ─── API Configuration ────────────────────────────────────────────────────────
 *
 * HOW IT WORKS:
 *  - In DEV  (__DEV__ === true):  reads EXPO_PUBLIC_API_URL from .env
 *  - In PROD (__DEV__ === false): reads EXPO_PUBLIC_API_URL_PROD from .env
 *
 * SETUP INSTRUCTIONS:
 *  1. Copy .env.example → .env  (already done for you)
 *  2. Run `ipconfig getifaddr en0` in your Mac Terminal.
 *  3. Set EXPO_PUBLIC_API_URL=http://<YOUR_IP>:5001  in .env
 *  4. For production, set EXPO_PUBLIC_API_URL_PROD=https://api.yourdomain.com
 *
 * WHY NOT localhost?
 *  - iOS Simulator in an Expo Dev Build resolves "localhost" as the simulator
 *    device itself, NOT your Mac. Expo Go tunnels around this, but Dev Builds
 *    do not. You must use your Mac's real LAN IP (e.g. 192.168.0.129).
 *  - Android Emulator uses the special alias 10.0.2.2 for the host machine.
 *    Your LAN IP also works for Android, so one .env value covers both.
 *
 * UPDATING YOUR IP:
 *  Your Mac's LAN IP can change when you switch WiFi networks.
 *  Run `ipconfig getifaddr en0` and update EXPO_PUBLIC_API_URL in .env,
 *  then rebuild the app (Metro bundler hot-reload is NOT enough for .env changes).
 *
 * DO NOT COMMIT .env — it is git-ignored. Commit .env.example instead.
 */

// ─── Read env vars injected by Expo ──────────────────────────────────────────
// EXPO_PUBLIC_* variables are automatically available via process.env in Expo SDK 49+.
// They are bundled at build time — a rebuild is required after changing .env.

const DEV_API_URL  = process.env.EXPO_PUBLIC_API_URL      ?? '';
const PROD_API_URL = process.env.EXPO_PUBLIC_API_URL_PROD  ?? '';

// ─── Select active URL based on build mode ────────────────────────────────────
const resolvedUrl = __DEV__ ? DEV_API_URL : PROD_API_URL;

// ─── Validation & fallback ────────────────────────────────────────────────────
if (!resolvedUrl) {
    const missingVar = __DEV__ ? 'EXPO_PUBLIC_API_URL' : 'EXPO_PUBLIC_API_URL_PROD';
    console.error(
        `[API CONFIG] ❌ ${missingVar} is not set in .env.\n` +
        `  DEV:  Set EXPO_PUBLIC_API_URL=http://<YOUR_MAC_IP>:5001\n` +
        `  PROD: Set EXPO_PUBLIC_API_URL_PROD=https://api.yourdomain.com\n` +
        `  Then rebuild the app (Metro reload is not enough).`
    );
}

if (__DEV__ && resolvedUrl.includes('localhost')) {
    console.warn(
        '[API CONFIG] ⚠️  localhost detected in DEV API URL.\n' +
        '  iOS Dev Build: "localhost" points to the simulator, NOT your Mac.\n' +
        '  Fix: run `ipconfig getifaddr en0` and update EXPO_PUBLIC_API_URL in .env.'
    );
}

// ─── Exported constants ───────────────────────────────────────────────────────

/** The root URL for all API calls. e.g. http://192.168.0.129:5001 */
export const BASE_URL: string = resolvedUrl;

/** API timeout in milliseconds (used by wrappers, not native fetch itself). */
export const API_TIMEOUT_MS = 15_000;

/** Current build mode — useful for conditional debug logic in screens. */
export const IS_DEV = __DEV__;

// ─── Debug log (stripped in production by the bundler) ───────────────────────
if (__DEV__) {
    console.log(`[API CONFIG] ✅  BASE_URL = ${BASE_URL}`);
}
