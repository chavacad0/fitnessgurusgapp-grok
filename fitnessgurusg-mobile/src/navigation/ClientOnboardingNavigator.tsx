import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ClientSuccessScreen from '../screens/client/ClientSuccessScreen';
import ClientWelcomeScreen from '../screens/client/ClientWelcomeScreen';
import { FIRST_LOGIN_KEY } from '../config/constants';
import { colors } from '../theme/theme';

/**
 * ClientOnboardingNavigator — shown ONCE after a client first registers.
 *
 * Flow:
 *   ClientSuccess → ClientWelcome → ClientReady
 *
 * ClientReady is a dummy screen that immediately calls onComplete().
 * The reason for ClientReady (instead of calling onComplete in ClientWelcome):
 *   Navigation animations. If we call onComplete() in ClientWelcome,
 *   the navigator unmounts mid-animation → visual glitch. A dummy screen
 *   guarantees the Welcome → Ready transition completes before the parent
 *   re-renders to show ClientAppTabs.
 *
 * What triggers this navigator:
 *   RegisterScreen writes FIRST_LOGIN_KEY = 'true' after a successful
 *   registration. RootNavigator reads this key and renders this navigator
 *   instead of ClientAppTabs when the key is set.
 *
 * What dismisses this navigator:
 *   ClientWelcomeScreen clears FIRST_LOGIN_KEY then navigates to ClientReady.
 *   ClientReady immediately calls onComplete(), which tells RootNavigator to
 *   switch to ClientAppTabs (by re-reading AsyncStorage).
 *
 * Returning users:
 *   FIRST_LOGIN_KEY is not set → this navigator never renders → user goes
 *   directly to ClientAppTabs on every subsequent login.
 */

export type ClientOnboardingStackParams = {
    ClientSuccess: undefined;
    ClientWelcome: undefined;
    ClientReady:   undefined;
};

const Stack = createNativeStackNavigator<ClientOnboardingStackParams>();

type Props = {
    onComplete: () => void;
};

/** Dummy screen — exists only to trigger onComplete after animation settles. */
function ClientReadyScreen({ onComplete }: { onComplete: () => void }) {
    useEffect(() => {
        // Small delay ensures the navigation animation completes before
        // RootNavigator unmounts this entire navigator.
        const t = setTimeout(onComplete, 80);
        return () => clearTimeout(t);
    }, []);

    return (
        <View style={s.readySplash}>
            <ActivityIndicator size="small" color={colors.accent} />
        </View>
    );
}

export default function ClientOnboardingNavigator({ onComplete }: Props) {
    return (
        <Stack.Navigator
            screenOptions={{
                headerShown:  false,
                animation:    'slide_from_right',
                // No gestures — we don't want the user to swipe back past Success
                gestureEnabled: false,
            }}
            initialRouteName="ClientSuccess"
        >
            <Stack.Screen name="ClientSuccess" component={ClientSuccessScreen} />
            <Stack.Screen name="ClientWelcome" component={ClientWelcomeScreen} />
            <Stack.Screen
                name="ClientReady"
                children={() => <ClientReadyScreen onComplete={onComplete} />}
            />
        </Stack.Navigator>
    );
}

const s = StyleSheet.create({
    readySplash: {
        flex:            1,
        alignItems:      'center',
        justifyContent:  'center',
        backgroundColor: colors.background,
    },
});
