import React, { useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, radius, typography, componentSize, shadows } from '../../theme/theme';
import type { ClientOnboardingStackParams } from '../../navigation/ClientOnboardingNavigator';

type Props = {
    navigation: NativeStackNavigationProp<ClientOnboardingStackParams, 'ClientSuccess'>;
};

/**
 * ClientSuccessScreen — the moment of confirmation after account creation.
 *
 * WHY this screen exists:
 *   Without it, the user taps "Join programme" and is immediately dropped
 *   into the app. No feedback that signup worked. No context for what
 *   happens next. First impressions of confusion become lasting ones.
 *
 *   This screen does three things:
 *   1. Confirms the action succeeded (reduces anxiety)
 *   2. Sets the expectation: "your coach is involved in what comes next"
 *   3. Gives a single, clear CTA — no decisions required
 *
 * Navigation: ClientSuccess → ClientWelcome
 */
export default function ClientSuccessScreen({ navigation }: Props) {
    // Entrance animation — scale up the checkmark from centre
    const scaleAnim = useRef(new Animated.Value(0)).current;
    const fadeAnim  = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.sequence([
            // Checkmark pops in
            Animated.spring(scaleAnim, {
                toValue:         1,
                damping:         12,
                stiffness:       200,
                useNativeDriver: true,
            }),
            // Text fades in after checkmark settles
            Animated.timing(fadeAnim, {
                toValue:         1,
                duration:        300,
                useNativeDriver: true,
            }),
        ]).start();
    }, []);

    return (
        <SafeAreaView style={s.root}>
            <View style={s.body}>

                {/* ── Checkmark ────────────────────────────────────────────── */}
                <Animated.View style={[s.checkCircle, { transform: [{ scale: scaleAnim }] }]}>
                    <Text style={s.checkmark}>✓</Text>
                </Animated.View>

                {/* ── Confirmation text ─────────────────────────────────────── */}
                <Animated.View style={[s.textBlock, { opacity: fadeAnim }]}>
                    <Text style={s.title}>You're in!</Text>
                    <Text style={s.subtitle}>
                        Your account is ready. Your coach will set up your programme shortly.
                    </Text>
                </Animated.View>

                {/* ── What happens next ─────────────────────────────────────── */}
                <Animated.View style={[s.nextCard, { opacity: fadeAnim }]}>
                    <Text style={s.nextLabel}>WHAT HAPPENS NEXT</Text>

                    <View style={s.nextRow}>
                        <View style={s.nextDot} />
                        <Text style={s.nextText}>Your coach assigns your plan</Text>
                    </View>
                    <View style={s.nextRow}>
                        <View style={s.nextDot} />
                        <Text style={s.nextText}>You select and activate it</Text>
                    </View>
                    <View style={s.nextRow}>
                        <View style={s.nextDot} />
                        <Text style={s.nextText}>Sessions and check-ins go live</Text>
                    </View>
                </Animated.View>

            </View>

            {/* ── CTA ──────────────────────────────────────────────────────── */}
            <View style={s.footer}>
                <TouchableOpacity
                    style={s.btnPrimary}
                    onPress={() => navigation.navigate('ClientWelcome')}
                    activeOpacity={0.88}
                    accessibilityRole="button"
                    accessibilityLabel="Continue to your programme"
                >
                    <Text style={s.btnPrimaryText}>Continue</Text>
                </TouchableOpacity>

                <Text style={s.footerNote}>FitnessGuruSG · Singapore</Text>
            </View>
        </SafeAreaView>
    );
}

const s = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: colors.background,
    },
    body: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.xl,
        gap: spacing.xxl,
    },

    // ── Animated checkmark ────────────────────────────────────────────────────
    checkCircle: {
        width:           100,
        height:          100,
        borderRadius:    50,
        backgroundColor: colors.accent,
        alignItems:      'center',
        justifyContent:  'center',
        ...shadows.cardElevated,
    },
    checkmark: {
        fontSize:   44,
        color:      '#FFFFFF',
        lineHeight: 52,
        fontWeight: '600',
    },

    // ── Text ──────────────────────────────────────────────────────────────────
    textBlock: {
        alignItems: 'center',
        gap: spacing.sm,
    },
    title: {
        fontSize:      32,
        fontWeight:    '800',
        color:         colors.textPrimary,
        letterSpacing: -0.5,
        textAlign:     'center',
    },
    subtitle: {
        ...typography.bodyLg,
        color:     colors.textSecondary,
        textAlign: 'center',
        lineHeight: 26,
    },

    // ── Next steps card ───────────────────────────────────────────────────────
    nextCard: {
        width:           '100%',
        backgroundColor: colors.surface,
        borderRadius:    radius.cardLg,
        borderWidth:     1,
        borderColor:     colors.border,
        padding:         spacing.xl,
        gap:             spacing.md,
        ...shadows.card,
    },
    nextLabel: {
        fontSize:      11,
        fontWeight:    '600',
        color:         colors.textSecondary,
        letterSpacing: 1.2,
        marginBottom:  spacing.xs,
    },
    nextRow: {
        flexDirection: 'row',
        alignItems:    'center',
        gap:            spacing.md,
    },
    nextDot: {
        width:           8,
        height:          8,
        borderRadius:    4,
        backgroundColor: colors.accent,
    },
    nextText: {
        ...typography.body,
        color: colors.textPrimary,
    },

    // ── Footer ────────────────────────────────────────────────────────────────
    footer: {
        paddingHorizontal: spacing.xl,
        paddingBottom:     spacing.xl,
        gap:               spacing.md,
    },
    btnPrimary: {
        height:          componentSize.button,
        backgroundColor: colors.buttonPrimaryBg,
        borderRadius:    radius.card,
        alignItems:      'center',
        justifyContent:  'center',
        ...shadows.card,
    },
    btnPrimaryText: {
        fontSize:   16,
        fontWeight: '600',
        color:      colors.buttonPrimaryText,
    },
    footerNote: {
        ...typography.micro,
        color:       colors.placeholder,
        textAlign:   'center',
        letterSpacing: 0.8,
    },
});
