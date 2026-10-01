/**
 * UserAvatar — Reusable avatar component for FitnessGuruSG.
 *
 * Renders a circular avatar with initials derived from the user's name.
 * Falls back to a "?" if no name is provided.
 *
 * Sizes: 'sm' (32), 'md' (40), 'lg' (56) — mapped to componentSize tokens.
 *
 * Usage:
 *   <UserAvatar name="Rachel Lim" />
 *   <UserAvatar name="Marcus Ong" size="lg" />
 *   <UserAvatar name="Daniel Teo" size="sm" bgColor={colors.warningBg} textColor={colors.amberText} />
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, componentSize, typography } from '../theme/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

type AvatarSize = 'sm' | 'md' | 'lg';

interface UserAvatarProps {
    /** User's display name — initials are derived from this */
    name: string;
    /** Size preset — defaults to 'md' (40px) */
    size?: AvatarSize;
    /** Override background color */
    bgColor?: string;
    /** Override initials text color */
    textColor?: string;
    /** Optional accessibility label override */
    accessibilityLabel?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SIZE_MAP: Record<AvatarSize, number> = {
    sm: componentSize.avatarSm,
    md: componentSize.avatar,
    lg: componentSize.avatarLg,
};

const FONT_MAP: Record<AvatarSize, number> = {
    sm: 13,
    md: 15,
    lg: 20,
};

function getInitials(name: string): string {
    if (!name || !name.trim()) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function UserAvatar({
    name,
    size = 'md',
    bgColor = colors.avatarBg,
    textColor = colors.avatarText,
    accessibilityLabel,
}: UserAvatarProps) {
    const dimension = SIZE_MAP[size];
    const fontSize = FONT_MAP[size];
    const initials = getInitials(name);

    return (
        <View
            style={[
                s.circle,
                {
                    width: dimension,
                    height: dimension,
                    borderRadius: dimension / 2,
                    backgroundColor: bgColor,
                },
            ]}
            accessibilityRole="image"
            accessibilityLabel={accessibilityLabel ?? `${name || 'User'}'s avatar`}
        >
            <Text
                style={[
                    s.initials,
                    { fontSize, color: textColor },
                ]}
            >
                {initials}
            </Text>
        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    circle: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    initials: {
        fontWeight: '700',
        includeFontPadding: false, // Android: remove extra padding
    },
});
