/**
 * AppCard — Reusable card wrapper for FitnessGuruSG.
 *
 * Provides consistent card styling across all screens:
 *   - White background
 *   - Border + subtle shadow
 *   - 16px border radius
 *   - 16px padding (configurable)
 *   - Optional onPress for tappable cards
 *
 * Usage:
 *   <AppCard>
 *     <Text>Card content</Text>
 *   </AppCard>
 *
 *   <AppCard padding="compact" onPress={() => navigate(...)}>
 *     <Text>Tappable compact card</Text>
 *   </AppCard>
 *
 *   <AppCard variant="muted">
 *     <Text>Muted background card</Text>
 *   </AppCard>
 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { colors, radius, spacing, shadows } from '../theme/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppCardProps {
    children: React.ReactNode;
    /** Padding preset — 'standard' (16px), 'compact' (12px), 'none' (0px) */
    padding?: 'standard' | 'compact' | 'none';
    /** Background variant */
    variant?: 'surface' | 'muted';
    /** If provided, card becomes tappable */
    onPress?: () => void;
    /** Additional styles merged onto the card container */
    style?: ViewStyle | ViewStyle[];
    /** Accessibility label for tappable cards */
    accessibilityLabel?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AppCard({
    children,
    padding = 'standard',
    variant = 'surface',
    onPress,
    style,
    accessibilityLabel,
}: AppCardProps) {
    const cardStyle = [
        s.card,
        variant === 'muted' && s.muted,
        padding === 'compact' && s.paddingCompact,
        padding === 'none' && s.paddingNone,
        style,
    ];

    if (onPress) {
        return (
            <TouchableOpacity
                style={cardStyle}
                onPress={onPress}
                activeOpacity={0.76}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
            >
                {children}
            </TouchableOpacity>
        );
    }

    return <View style={cardStyle}>{children}</View>;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    card: {
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.base,
        marginBottom: spacing.base,
        ...shadows.card,
        // NOTE: no overflow:'hidden' — would clip TouchableOpacity touch events
    },
    muted: {
        backgroundColor: colors.surfaceMuted,
    },
    paddingCompact: {
        padding: spacing.md,
    },
    paddingNone: {
        padding: 0,
    },
});
