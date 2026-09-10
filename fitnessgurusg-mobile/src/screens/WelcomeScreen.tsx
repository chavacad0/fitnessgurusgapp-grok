import React from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, radius, typography, componentSize, shadows } from '../theme/theme';

/**
 * WelcomeScreen — the app's entry point.
 *
 * Design rationale:
 *   ONE primary action (Sign in) — the most common path for any returning user.
 *   ONE secondary link (Join a programme) — the client self-registration path.
 *   Google is surfaced on LoginScreen, not here — keeps this screen clean.
 *
 * UX principle (Singapore-style):
 *   Don't make users decide before they understand. Show them the product
 *   identity first, then give them a single clear next step.
 *
 * Coach access is deliberately not surfaced here — coaches use the same
 * "Sign in" button. Role is determined by the backend, not the user.
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
        <SafeAreaView style={s.root}>

            {/* ── Brand hero ─────────────────────────────────────────────────── */}
            <View style={s.hero}>

                {/* Monogram mark */}
                <View style={s.mark}>
                    <Text style={s.markFG}>FG</Text>
                    <Text style={s.markSG}>SG</Text>
                </View>

                {/* Brand identity */}
                <View style={s.identity}>
                    <Text style={s.appName}>FitnessGuruSG</Text>
                    <Text style={s.tagline}>Expert coaching, measurable results.</Text>
                </View>

                {/* Three feature pills — social proof at a glance */}
                <View style={s.pillRow}>
                    {['Personalised plans', 'Progress tracking', 'Direct coaching'].map(label => (
                        <View key={label} style={s.pill}>
                            <Text style={s.pillText}>{label}</Text>
                        </View>
                    ))}
                </View>
            </View>

            {/* ── Actions ────────────────────────────────────────────────────── */}
            <View style={s.actions}>

                {/* PRIMARY: Sign in — the most common action */}
                <TouchableOpacity
                    style={s.btnPrimary}
                    onPress={() => navigation.navigate('Login')}
                    activeOpacity={0.88}
                    accessibilityRole="button"
                    accessibilityLabel="Sign in to your account"
                    accessibilityHint="Opens the sign in screen"
                >
                    <Text style={s.btnPrimaryText}>Sign in</Text>
                </TouchableOpacity>

                {/* SECONDARY: Client registration — needs invite code */}
                <TouchableOpacity
                    style={s.btnSecondary}
                    onPress={() => navigation.navigate('Register')}
                    activeOpacity={0.88}
                    accessibilityRole="button"
                    accessibilityLabel="Join a coaching programme"
                    accessibilityHint="Opens the registration screen — you will need an invite code from your coach"
                >
                    <Text style={s.btnSecondaryText}>Join a programme</Text>
                </TouchableOpacity>

                {/* Context line — sets expectation clearly */}
                <Text style={s.hint}>
                    New clients need an invite code from their coach.
                </Text>
            </View>

            {/* ── Footer ─────────────────────────────────────────────────────── */}
            <Text style={s.footer}>FitnessGuruSG · Singapore</Text>

        </SafeAreaView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: colors.background,
        paddingHorizontal: spacing.xl,
        justifyContent: 'space-between',
        paddingBottom: spacing.lg,
    },

    // ── Hero ──────────────────────────────────────────────────────────────────
    hero: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xl,
        paddingTop: spacing.section,
    },

    // Brand mark — square tile on background colour (no hero panel)
    mark: {
        width: 88,
        height: 88,
        borderRadius: radius.cardLg,
        backgroundColor: colors.buttonPrimaryBg,
        alignItems: 'center',
        justifyContent: 'center',
        ...shadows.cardElevated,
    },
    markFG: {
        fontSize: 24,
        fontWeight: '800',
        color: '#FFFFFF',
        letterSpacing: 2,
        lineHeight: 28,
    },
    markSG: {
        fontSize: 10,
        fontWeight: '600',
        color: 'rgba(255,255,255,0.55)',
        letterSpacing: 3,
    },

    // Identity text
    identity: {
        alignItems: 'center',
        gap: spacing.xs,
    },
    appName: {
        fontSize: 22,
        fontWeight: '800',
        color: colors.textPrimary,
        letterSpacing: -0.3,
    },
    tagline: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
    },

    // Feature pills
    pillRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: spacing.sm,
    },
    pill: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        backgroundColor: colors.accentSubtle,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.accent + '30',
    },
    pillText: {
        fontSize: 12,
        fontWeight: '500',
        color: colors.accent,
        letterSpacing: 0.2,
    },

    // ── Actions ───────────────────────────────────────────────────────────────
    actions: {
        gap: spacing.md,
        paddingBottom: spacing.xl,
    },

    btnPrimary: {
        height: componentSize.button,
        backgroundColor: colors.buttonPrimaryBg,
        borderRadius: radius.card,
        alignItems: 'center',
        justifyContent: 'center',
        ...shadows.card,
    },
    btnPrimaryText: {
        ...typography.bodyLg,
        color: colors.buttonPrimaryText,
        fontWeight: '600',
    },

    btnSecondary: {
        height: componentSize.button,
        borderRadius: radius.card,
        borderWidth: 1.5,
        borderColor: colors.buttonPrimaryBg,
        alignItems: 'center',
        justifyContent: 'center',
    },
    btnSecondaryText: {
        ...typography.bodyLg,
        color: colors.buttonPrimaryBg,
        fontWeight: '600',
    },

    hint: {
        ...typography.caption,
        color: colors.textSecondary,
        textAlign: 'center',
        lineHeight: 18,
    },

    // ── Footer ────────────────────────────────────────────────────────────────
    footer: {
        ...typography.micro,
        color: colors.placeholder,
        textAlign: 'center',
        letterSpacing: 0.8,
    },
});
