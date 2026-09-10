import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import WelcomeScreen from '../screens/WelcomeScreen';
import AppTabs from './AppTabs';
import ClientAppTabs from './ClientAppTabs';
import ClientOnboardingNavigator from './ClientOnboardingNavigator';
import ClientMyBookingsScreen from '../screens/client/ClientMyBookingsScreen';
import PlanSelectionScreen from '../screens/coach/PlanSelectionScreen';
import PaymentConfirmScreen from '../screens/coach/PaymentConfirmScreen';
import ClientPaymentDashboardScreen from '../screens/coach/ClientPaymentDashboardScreen';
import AssignWorkoutScreen from '../screens/coach/AssignWorkoutScreen';
import { FIRST_LOGIN_KEY } from '../config/constants';
import { colors, typography } from '../theme/theme';

/**
 * RootNavigator — auth gate AND role router for the entire app.
 *
 * Decision tree:
 *   isLoading              → SplashSpinner (AsyncStorage hydration in progress)
 *   token === null         → AuthStack   → WelcomeScreen / Login / Register
 *   role === 'coach'       → CoachStack  → AppTabs (+ modal coach screens)
 *   role === 'client'
 *     isFirstLogin = true  → ClientOnboardingNavigator (Success → Welcome)
 *     isFirstLogin = false → ClientAppTabs
 *   fallback               → AuthStack
 */

type AuthStackParamList = {
    Welcome:  undefined;
    Login:    undefined;
    Register: undefined;
};

const AuthStack   = createNativeStackNavigator<AuthStackParamList>();
const CoachStack  = createNativeStackNavigator();
const ClientStack = createNativeStackNavigator();

/**
 * ClientNavigator — wraps ClientAppTabs in a stack so screens like
 * ClientMyBookingsScreen can be pushed as card screens from within the
 * Book tab without modifying the tab navigator itself.
 */
function ClientNavigator() {
    return (
        <ClientStack.Navigator
            screenOptions={{
                headerStyle:         { backgroundColor: colors.surface },
                headerTintColor:     colors.textPrimary,
                headerTitleStyle:    { ...typography.h3 },
                headerShadowVisible: false,
            }}
        >
            <ClientStack.Screen
                name="ClientTabs"
                component={ClientAppTabs}
                options={{ headerShown: false }}
            />
            <ClientStack.Screen
                name="ClientMyBookings"
                component={ClientMyBookingsScreen}
                options={{ title: 'My Bookings', presentation: 'card' }}
            />
        </ClientStack.Navigator>
    );
}

function CoachNavigator() {
    return (
        <CoachStack.Navigator
            screenOptions={{
                headerStyle:      { backgroundColor: colors.surface },
                headerTintColor:  colors.textPrimary,
                headerTitleStyle: { ...typography.h3 },
                headerShadowVisible: false,
            }}
        >
            <CoachStack.Screen
                name="MainTabs"
                component={AppTabs}
                options={{ headerShown: false }}
            />
            <CoachStack.Screen
                name="PlanSelection"
                component={PlanSelectionScreen}
                options={{ title: 'Assign Package', presentation: 'card' }}
            />
            <CoachStack.Screen
                name="PaymentConfirm"
                component={PaymentConfirmScreen}
                options={{ title: 'Confirm Payment', presentation: 'card' }}
            />
            <CoachStack.Screen
                name="ClientPayments"
                component={ClientPaymentDashboardScreen}
                options={{ title: 'Client Details', headerBackTitle: 'Back', presentation: 'card' }}
            />
            <CoachStack.Screen
                name="AssignWorkout"
                component={AssignWorkoutScreen}
                options={{ title: 'Assign Workout', presentation: 'card' }}
            />
        </CoachStack.Navigator>
    );
}

export default function RootNavigator() {
    const { token, role, isLoading } = useAuth();

    /**
     * isFirstLogin:
     *   null  = still reading AsyncStorage (shows existing splash)
     *   true  = new client, show onboarding
     *   false = returning client, show ClientAppTabs
     */
    const [isFirstLogin, setIsFirstLogin] = useState<boolean | null>(null);

    // Read the FIRST_LOGIN_KEY whenever a client authenticates (or re-authenticates).
    useEffect(() => {
        if (role !== 'client' || !token) {
            setIsFirstLogin(null); // reset when not a client
            return;
        }
        AsyncStorage.getItem(FIRST_LOGIN_KEY).then(val => {
            const firstLogin = val === 'true';
            setIsFirstLogin(firstLogin);
            console.log('[ROOT] client first-login flag:', firstLogin);
        }).catch(err => {
            // AsyncStorage failure or corruption → safe default: skip onboarding.
            // Without this, isFirstLogin stays null and the client sees an
            // infinite spinner with no recovery path.
            console.warn('[ROOT] Failed to read FIRST_LOGIN_KEY — defaulting to false:', err);
            setIsFirstLogin(false);
        });
    }, [role, token]);

    // ── Routing log ────────────────────────────────────────────────────────────

    const destination =
        !token           ? 'AuthStack (no token)'
        : role === 'coach'  ? 'CoachNavigator'
        : role === 'client' && isFirstLogin === true  ? 'ClientOnboarding'
        : role === 'client' && isFirstLogin === false ? 'ClientAppTabs'
        : role === 'client' ? 'ClientAppTabs (first-login pending read)'
        : `AuthStack-fallback (unknown role: ${role})`;

    console.log(
        '[ROOT ⑪] render — isLoading:', isLoading,
        '| token:', token ? `SET (${token.length} chars)` : 'null',
        '| role:', role ?? 'null',
        '| firstLogin:', isFirstLogin,
        '| → ', destination,
    );

    // ── Loading states ─────────────────────────────────────────────────────────

    if (isLoading) {
        return (
            <View style={styles.splash}>
                <ActivityIndicator size="large" color={colors.accent} />
            </View>
        );
    }

    // While we're still reading the FIRST_LOGIN_KEY for an authenticated client,
    // show the same spinner rather than a flash of ClientAppTabs.
    if (token && role === 'client' && isFirstLogin === null) {
        return (
            <View style={styles.splash}>
                <ActivityIndicator size="large" color={colors.accent} />
            </View>
        );
    }

    return (
        <NavigationContainer>
            {!token ? (
                // ── Unauthenticated ──────────────────────────────────────────────
                <AuthStack.Navigator screenOptions={{ headerShown: false }}>
                    <AuthStack.Screen name="Welcome"  component={WelcomeScreen}  />
                    <AuthStack.Screen name="Login"    component={LoginScreen}    />
                    <AuthStack.Screen name="Register" component={RegisterScreen} />
                </AuthStack.Navigator>

            ) : role === 'coach' ? (
                // ── Coach: tabs + coach modal screens ────────────────────────────
                <CoachNavigator />

            ) : role === 'client' && isFirstLogin === true ? (
                // ── New client: onboarding flow (shown exactly once) ─────────────
                //
                // ClientOnboardingNavigator renders:
                //   ClientSuccess → ClientWelcome → (clears flag) → onComplete()
                //
                // onComplete sets isFirstLogin to false, RootNavigator re-renders,
                // and the client lands in ClientAppTabs cleanly.
                //
                // NavigationContainer nesting:
                //   We pass the onComplete callback. The navigator handles its own
                //   internal Stack — it is NOT nested inside NavigationContainer
                //   (doing so causes "Another navigator is already registered" error).
                <ClientOnboardingNavigator
                    onComplete={() => setIsFirstLogin(false)}
                />

            ) : role === 'client' ? (
                // ── Returning client: tabs + My Bookings stack ───────────────────────────
                <ClientNavigator />


            ) : (
                // ── Safety fallback ───────────────────────────────────────────────
                <AuthStack.Navigator screenOptions={{ headerShown: false }}>
                    <AuthStack.Screen name="Welcome"  component={WelcomeScreen}  />
                    <AuthStack.Screen name="Login"    component={LoginScreen}    />
                    <AuthStack.Screen name="Register" component={RegisterScreen} />
                </AuthStack.Navigator>
            )}
        </NavigationContainer>
    );
}

const styles = StyleSheet.create({
    splash: {
        flex:            1,
        justifyContent:  'center',
        alignItems:      'center',
        backgroundColor: colors.background,
    },
});
