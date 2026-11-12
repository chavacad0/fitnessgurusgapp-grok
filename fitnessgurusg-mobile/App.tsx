import React from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';
import { AppFontProvider } from './src/theme/fonts';

// 🔥 DEBUG — confirms JS bundle is executing (remove after blank-screen is fixed)
console.log('🚀 App.tsx is executing — bundle loaded successfully');

/**
 * App root — wraps everything in:
 *  1. GestureHandlerRootView  (required for react-native-gesture-handler)
 *  2. SafeAreaProvider        (required for SafeAreaView in all screens)
 *  3. AppFontProvider         (Poppins + Inter; the app still shows if they fail)
 *  4. AuthProvider            (JWT token + login/logout context for all screens)
 *
 * WHY SafeAreaProvider here?
 *   Every screen imports SafeAreaView from react-native-safe-area-context.
 *   That component looks up the nearest SafeAreaProvider ancestor for inset
 *   values. Without SafeAreaProvider, the context is uninitialised → the
 *   SafeAreaView renders with zero height → blank white screen.
 *   NavigationContainer provides a SafeAreaProviderCompat internally, but
 *   only for screens rendered inside it — not App.tsx-level wrappers.
 */
export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AppFontProvider>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </AppFontProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

