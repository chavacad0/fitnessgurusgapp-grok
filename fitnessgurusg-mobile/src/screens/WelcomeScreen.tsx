import React from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Image, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, radius, typography, componentSize } from '../theme/theme';

/**
 * WelcomeScreen — the app's entry point.
 *
 * Design rationale:
 *   ONE primary action (Log in) — people who already have an account.
 *   ONE secondary link (Sign up) — new clients only. Coach accounts are not created here.
 *   Google is surfaced on LoginScreen, not here — keeps this screen clean.
 *
 * UX principle (Singapore-style):
 *   Don't make users decide before they understand. Show them the product
 *   identity first, then give them a single clear next step.
 *
 * Coach access is deliberately not surfaced here — coaches use the same
 * "Log in" button. Role is chosen on the next screen and checked by the server.
 */

type AuthStackParams = {
    Welcome:  undefined;
    Login:    undefined;
    Register: undefined;
};

type Props = {
    navigation: NativeStackNavigationProp<AuthStackParams, 'Welcome'>;
};

export default function WelcomeScreen({ navigation }: Props) {
    return (
        <View style={s.root}>
            <StatusBar barStyle="light-content" />
            <Image
                source={require('../../assets/welcome-bg.png')}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                accessible={false}
            />
            <SafeAreaView style={s.safe}>

                <View style={s.hero}>
                    <View style={s.mark}>
                        <Text style={s.markFG}>FG</Text>
                        <Text style={s.markSG}>SG</Text>
                    </View>
                    <Text style={s.appName}>FitnessGuruSG</Text>
                    <Text style={s.tagline}>Expert coaching, measurable results.</Text>
                </View>

                <View style={s.actions}>
                    <TouchableOpacity
                        style={s.btnPrimary}
                        onPress={() => navigation.navigate('Login')}
                        activeOpacity={0.88}
                        accessibilityRole="button"
                        accessibilityLabel="Log in to your account"
                        accessibilityHint="Opens the log in screen"
                    >
                        <Text style={s.btnPrimaryText}>Log in</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={s.btnSecondary}
                        onPress={() => navigation.navigate('Register')}
                        activeOpacity={0.88}
                        accessibilityRole="button"
                        accessibilityLabel="Sign up as a new client"
                        accessibilityHint="Opens client sign up. Coach accounts are set up by FitnessGuruSG."
                    >
                        <Text style={s.btnSecondaryText}>Sign up</Text>
                    </TouchableOpacity>

                    <Text style={s.hint}>
                        Sign up is for new clients. Coach accounts are set up by FitnessGuruSG.
                    </Text>
                </View>

                <Text style={s.footer}>FitnessGuruSG · Singapore</Text>

            </SafeAreaView>
        </View>
    );
}

const s = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: colors.primaryDark,
    },
    safe: {
        flex: 1,
        paddingHorizontal: spacing.xl,
        justifyContent: 'space-between',
        paddingBottom: spacing.lg,
    },
    hero: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.md,
    },
    mark: {
        width: 92,
        height: 92,
        borderRadius: 24,
        backgroundColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.sm,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.16,
        shadowRadius: 16,
        elevation: 6,
    },
    markFG: {
        fontSize: 28,
        fontWeight: '800',
        color: colors.primary,
        letterSpacing: 1,
        lineHeight: 32,
    },
    markSG: {
        fontSize: 11,
        fontWeight: '700',
        color: colors.accent,
        letterSpacing: 2,
        marginTop: -2,
    },
    appName: {
        fontSize: 28,
        fontWeight: '800',
        color: '#FFFFFF',
        letterSpacing: -0.4,
    },
    tagline: {
        ...typography.body,
        color: 'rgba(255,255,255,0.78)',
        textAlign: 'center',
    },
    actions: {
        gap: spacing.md,
        paddingBottom: spacing.lg,
    },
    btnPrimary: {
        height: componentSize.button,
        backgroundColor: '#FFFFFF',
        borderRadius: radius.card,
        alignItems: 'center',
        justifyContent: 'center',
    },
    btnPrimaryText: {
        ...typography.bodyLg,
        color: colors.primary,
        fontWeight: '700',
    },
    btnSecondary: {
        height: componentSize.button,
        borderRadius: radius.card,
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.85)',
        backgroundColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
    },
    btnSecondaryText: {
        ...typography.bodyLg,
        color: '#FFFFFF',
        fontWeight: '600',
    },
    hint: {
        ...typography.caption,
        color: 'rgba(255,255,255,0.72)',
        textAlign: 'center',
        lineHeight: 18,
        marginTop: spacing.xs,
    },
    footer: {
        ...typography.micro,
        color: 'rgba(255,255,255,0.45)',
        textAlign: 'center',
        letterSpacing: 0.4,
    },
});
