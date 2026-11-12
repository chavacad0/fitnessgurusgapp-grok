/**
 * Card — white rounded surface from the design kit.
 *
 * White fill, 16px corners, hairline border, and the same soft shadow
 * the app already uses on cards. Optional press handler.
 *
 *   <Card>
 *     <Text>Hello</Text>
 *   </Card>
 *
 *   <Card padding="compact" onPress={openDetail}>
 *     <Text>Tappable</Text>
 *   </Card>
 *
 * AppCard is the older bordered card and is left unchanged.
 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { colors, palette, radius, spacing, shadows } from '../theme/theme';

type CardPadding = 'standard' | 'compact' | 'none';

interface CardProps {
    children: React.ReactNode;
    /** 'standard' is 16px, 'compact' is 12px, 'none' is 0 */
    padding?: CardPadding;
    /** 'surface' is white. 'muted' is a flat grey fill. */
    variant?: 'surface' | 'muted';
    onPress?: () => void;
    style?: StyleProp<ViewStyle>;
    accessibilityLabel?: string;
}

export default function Card({
    children,
    padding = 'standard',
    variant = 'surface',
    onPress,
    style,
    accessibilityLabel,
}: CardProps) {
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
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
            >
                {children}
            </TouchableOpacity>
        );
    }

    return <View style={cardStyle}>{children}</View>;
}

const s = StyleSheet.create({
    card: {
        backgroundColor: palette.white,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.base,
        ...shadows.card,
    },
    muted: {
        backgroundColor: palette.gray100,
        shadowOpacity: 0,
        elevation: 0,
    },
    paddingCompact: {
        padding: spacing.md,
    },
    paddingNone: {
        padding: 0,
    },
});
