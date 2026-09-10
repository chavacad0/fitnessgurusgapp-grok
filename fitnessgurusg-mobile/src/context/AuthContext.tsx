import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthUser, Role } from '../types';
import { AUTH_TOKEN_KEY, AUTH_USER_KEY } from '../config/constants';
import { authEvents } from '../services/authEvents';
import { resetSessionExpiredFlag } from '../services/apiClient';

/**
 * Auth Context — manages JWT token AND user profile state for the entire app.
 *
 * Storage keys:
 *   AUTH_TOKEN_KEY ('authToken') → JWT string
 *   AUTH_USER_KEY  ('authUser')  → JSON-serialised AuthUser (role, name, email…)
 *
 * Navigation contract:
 *   token null + user null   → LoginScreen
 *   role === 'coach'         → AppTabs (Clients / CheckIn / Insights)
 *   role === 'client'        → ClientAppTabs (Home / Progress / Profile)
 *
 * WHY store user in AsyncStorage?
 *   So the correct navigator renders immediately on app restart without
 *   making a network call. The token alone tells us the user is logged
 *   in; the user object tells us WHICH navigator to show.
 *
 * Storage key constants live in config/constants.ts — do not redefine here.
 */

interface AuthContextType {
    token: string | null;
    user:  AuthUser | null;
    role:  Role | null;          // convenience — user?.role
    isLoading: boolean;          // true while AsyncStorage is read on app start
    login: (token: string, user: AuthUser) => Promise<void>;
    logout: () => Promise<void>;
    updateUser: (updated: Partial<AuthUser>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [token, setToken]     = useState<string | null>(null);
    const [user,  setUser]      = useState<AuthUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // ── Hydrate from AsyncStorage on app start ────────────────────────────────
    useEffect(() => {
        const load = async () => {
            try {
                const [storedToken, storedUser] = await AsyncStorage.multiGet([
                    AUTH_TOKEN_KEY,
                    AUTH_USER_KEY,
                ]);
                const tok  = storedToken[1]  ?? null;
                const usr  = storedUser[1]   ? JSON.parse(storedUser[1]) as AuthUser : null;
                setToken(tok);
                setUser(usr);
                console.log('[AuthContext] hydrated — role:', usr?.role ?? 'none', '| token:', tok ? 'SET' : 'null');
            } catch (err) {
                console.error('[AuthContext] Failed to load session:', err);
                setToken(null);
                setUser(null);
            } finally {
                setIsLoading(false);
            }
        };
        load();
    }, []);

    // ── Listen for session-expired events from the API layer ──────────────────
    // This is the GLOBAL 401 handler: when any API call gets a 401,
    // apiClient.ts emits 'session-expired', and we call logout() here.
    // RootNavigator reacts to token=null and shows the LoginScreen.
    const handleSessionExpired = useCallback(async () => {
        console.warn('[AuthContext] session-expired event received — logging out.');
        try {
            await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, AUTH_USER_KEY]);
        } catch (err) {
            console.error('[AuthContext] Failed to clear session on expiry:', err);
        } finally {
            setToken(null);
            setUser(null);
        }
    }, []);

    useEffect(() => {
        const unsubscribe = authEvents.on('session-expired', handleSessionExpired);
        return unsubscribe;
    }, [handleSessionExpired]);

    // ── login ─────────────────────────────────────────────────────────────────
    /**
     * Called after successful login.
     * Saves both the JWT and the user profile to AsyncStorage, then
     * updates state — RootNavigator re-renders automatically.
     */
    const login = async (newToken: string, newUser: AuthUser) => {
        try {
            console.log('[AUTH ⑤] login() called — role being saved:', newUser.role, '| email:', newUser.email);

            // Clear first — eliminates stale-role race condition on fast re-renders.
            await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, AUTH_USER_KEY]);
            console.log('[AUTH ⑥] old session cleared from AsyncStorage');

            await AsyncStorage.multiSet([
                [AUTH_TOKEN_KEY, newToken],
                [AUTH_USER_KEY,  JSON.stringify(newUser)],
            ]);
            console.log('[AUTH ⑦] new session written to AsyncStorage — role:', newUser.role);

            // Verify what was actually written
            const written = await AsyncStorage.getItem(AUTH_USER_KEY);
            const parsed = written ? JSON.parse(written) : null;
            console.log('[AUTH ⑧] READ BACK from AsyncStorage — role:', parsed?.role, '(should be:', newUser.role, ')');

            setToken(newToken);
            setUser(newUser);
            resetSessionExpiredFlag();  // Allow 401 detection for the new session
            console.log('[AUTH ⑨] React state updated — role in state:', newUser.role);
        } catch (err) {
            console.error('[AUTH] Failed to persist session:', err);
            throw new Error('Failed to save login session');
        }
    };

    // ── logout ────────────────────────────────────────────────────────────────
    /**
     * Clears token + user from AsyncStorage and state.
     * RootNavigator reacts and shows LoginScreen automatically.
     */
    const logout = async () => {
        try {
            await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, AUTH_USER_KEY]);
        } catch (err) {
            console.error('[AuthContext] Failed to clear session:', err);
        } finally {
            setToken(null);
            setUser(null);
        }
    };

    // ── updateUser ────────────────────────────────────────────────────────────
    /**
     * Merges a partial update into the stored user profile.
     * Useful for refreshing name, email, or clientId without a full re-login.
     */
    const updateUser = async (updated: Partial<AuthUser>) => {
        if (!user) return;
        const merged = { ...user, ...updated };
        try {
            await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(merged));
            setUser(merged);
        } catch (err) {
            console.error('[AuthContext] Failed to update user:', err);
        }
    };

    // ── Derived convenience values ────────────────────────────────────────────
    const role = user?.role ?? null;

    return (
        <AuthContext.Provider value={{ token, user, role, isLoading, login, logout, updateUser }}>
            {children}
        </AuthContext.Provider>
    );
}

/**
 * Hook to access auth context — throws if used outside AuthProvider.
 */
export function useAuth(): AuthContextType {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return ctx;
}
