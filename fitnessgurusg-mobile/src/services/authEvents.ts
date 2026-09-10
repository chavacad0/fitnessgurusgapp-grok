/**
 * ─── Auth Event Bus ──────────────────────────────────────────────────────────
 *
 * Lightweight publish/subscribe bridge between the API layer (plain module)
 * and the React auth context (React hooks).
 *
 * WHY:
 *   apiClient.ts cannot use React hooks (useAuth, useContext) because it is
 *   a plain TypeScript module, not a React component. But when the API
 *   layer detects a 401 (expired/invalid JWT), it needs to trigger a logout.
 *
 * HOW:
 *   1. apiClient.ts calls `authEvents.emit('session-expired')` on 401.
 *   2. AuthContext.tsx subscribes via `authEvents.on('session-expired', logout)`.
 *   3. logout() clears AsyncStorage + state → RootNavigator shows LoginScreen.
 *
 * This avoids:
 *   - Every screen needing its own try/catch 401 handling.
 *   - Passing React context through non-React code.
 *   - Global mutable state or singletons holding React refs.
 */

type AuthEventType = 'session-expired';
type AuthEventListener = () => void;

class AuthEventBus {
    private listeners: Map<AuthEventType, Set<AuthEventListener>> = new Map();

    on(event: AuthEventType, listener: AuthEventListener): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(listener);

        // Return unsubscribe function for useEffect cleanup
        return () => {
            this.listeners.get(event)?.delete(listener);
        };
    }

    emit(event: AuthEventType): void {
        const eventListeners = this.listeners.get(event);
        if (eventListeners) {
            eventListeners.forEach(listener => {
                try {
                    listener();
                } catch (err) {
                    console.error(`[AuthEventBus] listener error for "${event}":`, err);
                }
            });
        }
    }
}

/** Singleton — shared between apiClient.ts and AuthContext.tsx */
export const authEvents = new AuthEventBus();
