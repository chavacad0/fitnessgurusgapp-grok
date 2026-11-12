/**
 * RatingRow — 1-10 rating picker card for FitnessGuruSG.
 *
 * Used for Energy and Appetite check-in ratings.
 *
 * Critical style rules (DO NOT CHANGE):
 *   • height: 46 on buttons (explicit — never aspectRatio:1 in a flex row)
 *   • Two rows of five, so each number is wide enough to tap
 *   • The saved value is still 1–10
 *   • No overflow:'hidden' on card container (would clip touch events)
 *
 * Usage:
 *   <RatingRow
 *     label="Energy"
 *     question="How's your energy right now?"
 *     value={energy}
 *     onChange={setEnergy}
 *     accentColor={colors.accent}
 *     lowLabel="Drained"
 *     highLabel="Energised"
 *   />
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, radius, typography, shadows } from '../theme/theme';

// ─── Constants ────────────────────────────────────────────────────────────────

const RATINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RatingRowProps {
    /** Label displayed at top of card */
    label:       string;
    /** Question/description below the label */
    question:    string;
    /** Current selected value (1–10) */
    value:       number;
    /** Callback when user taps a rating */
    onChange:    (n: number) => void;
    /** Accent color for the selected state and badge */
    accentColor: string;
    /** Low-end axis label (e.g. "Drained") */
    lowLabel:    string;
    /** High-end axis label (e.g. "Energised") */
    highLabel:   string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RatingRow({
    label,
    question,
    value,
    onChange,
    accentColor,
    lowLabel,
    highLabel,
}: RatingRowProps) {
    return (
        <View style={s.card}>
            {/* Header: label + live badge */}
            <View style={s.header}>
                <View style={s.headerText}>
                    <Text style={s.label}>{label}</Text>
                    <Text style={s.question}>{question}</Text>
                </View>
                <View style={[s.badge, { borderColor: accentColor }]}>
                    <Text style={[s.badgeValue, { color: accentColor }]}>{value}</Text>
                    <Text style={s.badgeMax}>/10</Text>
                </View>
            </View>

            {/* Two rows of five. The value saved is still 1–10. */}
            {[RATINGS.slice(0, 5), RATINGS.slice(5)].map(row => (
                <View key={row[0]} style={s.row}>
                    {row.map(n => {
                        const selected = n === value;
                        return (
                            <TouchableOpacity
                                key={n}
                                onPress={() => {
                                    console.log(`[CheckIn] ${label} selected:`, n);
                                    onChange(n);
                                }}
                                activeOpacity={0.65}
                                accessibilityRole="button"
                                accessibilityLabel={`Rate ${n} out of 10`}
                                accessibilityState={{ selected }}
                                style={[
                                    s.btn,
                                    selected && { backgroundColor: accentColor, borderColor: accentColor },
                                ]}
                            >
                                <Text style={[s.btnText, selected && s.btnTextSelected]}>
                                    {n}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            ))}

            {/* Axis labels */}
            <View style={s.axis}>
                <Text style={s.axisLabel}>{lowLabel}</Text>
                <Text style={s.axisLabel}>{highLabel}</Text>
            </View>
        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    card: {
        backgroundColor: colors.surface,
        borderRadius:    radius.card,
        borderWidth:     1,
        borderColor:     colors.border,
        padding:         spacing.base,
        marginBottom:    spacing.base,
        ...shadows.card,
        // ✓ NO overflow:'hidden' — would clip touch events
    },
    header:     { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.base },
    headerText: { flex: 1, paddingRight: spacing.sm },
    label:      { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 2 },
    question:   { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
    badge: {
        flexDirection:     'row',
        alignItems:        'baseline',
        borderWidth:       1.5,
        borderRadius:      radius.md,
        paddingHorizontal: spacing.sm,
        paddingVertical:   3,
        minWidth:          48,
        justifyContent:    'center',
    },
    badgeValue: { fontSize: 20, fontWeight: '800', lineHeight: 24 },
    badgeMax:   { fontSize: 11, color: colors.textSecondary, fontWeight: '600', marginLeft: 1 },
    row:        { flexDirection: 'row', gap: 7, marginBottom: 7 },
    btn: {
        flex:            1,
        height:          46,
        borderRadius:    12,
        borderWidth:     1.5,
        borderColor:     colors.border,
        backgroundColor: colors.background,
        alignItems:      'center',
        justifyContent:  'center',
    },
    btnText:         { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    btnTextSelected: { color: '#FFFFFF' },
    axis:      { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
    axisLabel: { fontSize: 11, color: colors.textSecondary },
});
