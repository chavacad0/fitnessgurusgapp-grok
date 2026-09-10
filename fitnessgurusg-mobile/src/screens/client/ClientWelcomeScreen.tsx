import React from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../../context/AuthContext';
import { FIRST_LOGIN_KEY } from '../../config/constants';
import { colors, spacing, radius, typography, componentSize, shadows } from '../../theme/theme';
import type { ClientOnboardingStackParams } from '../../navigation/ClientOnboardingNavigator';

type Props = {
    navigation: NativeStackNavigationProp<ClientOnboardingStackParams, 'ClientWelcome'>;
};

/**
 * ClientWelcomeScreen — orientation for first-time clients.
 *
 * WHY this screen exists:
 *   After the success screen, the client knows their account works.
 *   Now they need to know WHAT TO DO. Dropping them into the Home tab
 *   without orientation forces them to explore blindly — most don't.
 *
 *   This screen names the 4 things they can do in the app (tabs) and directs
 *   them to the most important first action: viewing their plan.
 *
 *   Clearing FIRST_LOGIN_KEY here is the one-time gate. After this point,
 *   the client will never see the onboarding flow again regardless of
 *   restarts, re-logins, or app updates.
 *
 * Navigation: completes onboarding → RootNavigator re-renders → ClientAppTabs
 */
export default function ClientWelcomeScreen({ navigation }: Props) {
    const { user } = useAuth();
    const firstName = user?.name?.split(' ')[0] ?? 'there';

    const handleContinue = async () => {
        // Clear the first-login flag — onboarding will never show again.
        // RootNavigator is watching this via the ClientOnboardingNavigator
        // which calls onComplete() which sets the local state to false.
        try {
            await AsyncStorage.removeItem(FIRST_LOGIN_KEY);
        } catch {
            // Non-critical — worst case they see onboarding once more
        }
        // Navigate to the final screen which triggers dismissal
        navigation.navigate('ClientReady');
    };

    return (
        <SafeAreaView style={s.root}>
            <View style={s.body}>

                {/* ── Greeting ──────────────────────────────────────────────── */}
                <View style={s.greeting}>
                    <Text style={s.hello}>Welcome,</Text>
                    <Text style={s.name}>{firstName} 👋</Text>
                    <Text style={s.tagline}>
                        Here's everything you can do on FitnessGuruSG.
                    </Text>
                </View>

                {/* ── Feature orientation tiles ─────────────────────────────── */}
                <View style={s.tiles}>
                    {FEATURE_TILES.map(tile => (
                        <View key={tile.icon} style={s.tile}>
                            <View style={s.tileIcon}>
                                <Text style={s.tileIconText}>{tile.icon}</Text>
                            </View>
                            <View style={s.tileText}>
                                <Text style={s.tileTitle}>{tile.title}</Text>
                                <Text style={s.tileDesc}>{tile.desc}</Text>
                            </View>
                        </View>
                    ))}
                </View>

                {/* ── First action prompt ───────────────────────────────────── */}
                <View style={s.promptCard}>
                    <Text style={s.promptLabel}>START HERE</Text>
                    <Text style={s.promptTitle}>Check your plan</Text>
                    <Text style={s.promptDesc}>
                        Once your coach assigns a plan, you'll find it in{' '}
                        <Text style={s.promptHighlight}>My Plan</Text>.
                        That's where you select and activate your programme.
                    </Text>
                </View>

            </View>

            {/* ── CTA ──────────────────────────────────────────────────────── */}
            <View style={s.footer}>
                <TouchableOpacity
                    style={s.btnPrimary}
                    onPress={handleContinue}
                    activeOpacity={0.88}
                    accessibilityRole="button"
                    accessibilityLabel="Go to my programme"
                >
                    <Text style={s.btnPrimaryText}>Go to my programme</Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

// ─── Feature tile content ─────────────────────────────────────────────────────

const FEATURE_TILES = [
    {
        icon:  '🏠',
        title: 'Home',
        desc:  'Submit daily check-ins to your coach',
    },
    {
        icon:  '📈',
        title: 'Progress',
        desc:  'Track your check-in history and streaks',
    },
    {
        icon:  '🏋️',
        title: 'My Plan',
        desc:  'View, activate, and track your programme',
    },
    {
        icon:  '👤',
        title: 'Profile',
        desc:  'Manage your account',
    },
] as const;

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    root: {
        flex:            1,
        backgroundColor: colors.background,
    },
    body: {
        flex:              1,
        paddingHorizontal: spacing.xl,
        paddingTop:        spacing.xl,
        gap:               spacing.xl,
    },

    // ── Greeting ──────────────────────────────────────────────────────────────
    greeting: { gap: spacing.xs },
    hello: {
        fontSize:      28,
        fontWeight:    '700',
        color:         colors.textPrimary,
        letterSpacing: -0.4,
    },
    name: {
        fontSize:      32,
        fontWeight:    '800',
        color:         colors.accent,
        letterSpacing: -0.5,
        marginBottom:  spacing.xs,
    },
    tagline: {
        ...typography.body,
        color:     colors.textSecondary,
        lineHeight: 22,
    },

    // ── Feature tiles ─────────────────────────────────────────────────────────
    tiles: {
        backgroundColor: colors.surface,
        borderRadius:    radius.cardLg,
        borderWidth:     1,
        borderColor:     colors.border,
        overflow:        'hidden',
        ...shadows.card,
    },
    tile: {
        flexDirection:  'row',
        alignItems:     'center',
        padding:        spacing.base,
        gap:            spacing.base,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    tileIcon: {
        width:           44,
        height:          44,
        borderRadius:    radius.md,
        backgroundColor: colors.accentSubtle,
        alignItems:      'center',
        justifyContent:  'center',
    },
    tileIconText: { fontSize: 20 },
    tileText:     { flex: 1, gap: 2 },
    tileTitle: {
        fontSize:   14,
        fontWeight: '600',
        color:      colors.textPrimary,
    },
    tileDesc: {
        ...typography.caption,
        color:      colors.textSecondary,
        lineHeight: 17,
    },

    // ── First action prompt ───────────────────────────────────────────────────
    promptCard: {
        backgroundColor: colors.buttonPrimaryBg,
        borderRadius:    radius.cardLg,
        padding:         spacing.xl,
        gap:             spacing.sm,
    },
    promptLabel: {
        fontSize:      11,
        fontWeight:    '700',
        color:         'rgba(255,255,255,0.6)',
        letterSpacing: 1.2,
    },
    promptTitle: {
        fontSize:      20,
        fontWeight:    '700',
        color:         '#FFFFFF',
        letterSpacing: -0.2,
    },
    promptDesc: {
        ...typography.body,
        color:      'rgba(255,255,255,0.8)',
        lineHeight: 22,
    },
    promptHighlight: {
        fontWeight: '700',
        color:      '#FFFFFF',
    },

    // ── Footer ────────────────────────────────────────────────────────────────
    footer: {
        paddingHorizontal: spacing.xl,
        paddingBottom:     spacing.xl,
    },
    btnPrimary: {
        height:          componentSize.button,
        backgroundColor: colors.accent,
        borderRadius:    radius.card,
        alignItems:      'center',
        justifyContent:  'center',
        ...shadows.card,
    },
    btnPrimaryText: {
        fontSize:   16,
        fontWeight: '600',
        color:      '#FFFFFF',
    },
});
