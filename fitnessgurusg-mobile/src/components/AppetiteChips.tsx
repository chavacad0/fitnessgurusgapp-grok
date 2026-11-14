/**
 * Three appetite chips for the daily check-in.
 * A tap saves 2, 5, or 9 on the existing hunger field.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, radius, shadows } from '../theme/theme';
import { fontStyle, useKitFonts } from '../theme/fonts';
import { APPETITE_CHIPS, nearestAppetite } from '../checkin/scale';

const TEAL = '#0F766E';

export default function AppetiteChips({
    value,
    onChange,
}: {
    value: number;
    onChange: (next: number) => void;
}) {
    const fonts = useKitFonts();
    const selectedValue = nearestAppetite(value);

    return (
        <View style={styles.card}>
            <Text style={[styles.title, fontStyle(fonts.headingSemibold, '600')]}>Appetite</Text>
            <Text style={[styles.question, fontStyle(fonts.body, '400')]}>
                How is your appetite today?
            </Text>
            <View style={styles.row}>
                {APPETITE_CHIPS.map(chip => {
                    const selected = chip.value === selectedValue;
                    return (
                        <TouchableOpacity
                            key={chip.id}
                            style={[styles.chip, selected && styles.chipOn]}
                            onPress={() => onChange(chip.value)}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            accessibilityLabel={chip.label}
                            accessibilityState={{ selected }}
                        >
                            <Text
                                style={[
                                    styles.chipLabel,
                                    fontStyle(fonts.bodyMedium, '500'),
                                    selected && styles.chipLabelOn,
                                ]}
                            >
                                {chip.label}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.base,
        marginBottom: spacing.base,
        ...shadows.card,
    },
    title: {
        fontSize: 16,
        color: colors.textPrimary,
        marginBottom: 2,
    },
    question: {
        fontSize: 13,
        color: colors.textSecondary,
        marginBottom: spacing.md,
    },
    row: {
        flexDirection: 'row',
        gap: spacing.sm,
    },
    chip: {
        flex: 1,
        minHeight: 44,
        borderRadius: radius.pill,
        borderWidth: 1.5,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 6,
        paddingVertical: 8,
    },
    chipOn: {
        backgroundColor: '#E6F7F1',
        borderColor: TEAL,
    },
    chipLabel: {
        fontSize: 12,
        color: colors.textSecondary,
        textAlign: 'center',
    },
    chipLabelOn: {
        color: '#183A4A',
    },
});
