/**
 * NutritionCard — Collapsible nutrition input card for FitnessGuruSG.
 *
 * Allows clients to optionally log daily calories and macros (protein, carbs, fat).
 * Includes a visual macro breakdown bar when values are entered.
 *
 * Touch safety: No overflow:'hidden' on card container — would block touches
 * on child Touchables.
 *
 * Usage:
 *   <NutritionCard
 *     calories={calories} onCalories={setCalories}
 *     protein={protein}   onProtein={setProtein}
 *     carbs={carbs}       onCarbs={setCarbs}
 *     fat={fat}           onFat={setFat}
 *   />
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography, shadows } from '../theme/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NutritionCardProps {
    calories: string; onCalories: (v: string) => void;
    protein:  string; onProtein:  (v: string) => void;
    carbs:    string; onCarbs:    (v: string) => void;
    fat:      string; onFat:      (v: string) => void;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NutritionField({
    label, unit, placeholder, value, onChange,
}: {
    label:       string;
    unit:        string;
    placeholder: string;
    value:       string;
    onChange:    (v: string) => void;
}) {
    return (
        <View style={nf.wrap}>
            <Text style={nf.label}>{label}</Text>
            <View style={nf.row}>
                <TextInput
                    style={nf.input}
                    placeholder={placeholder}
                    placeholderTextColor={colors.placeholder}
                    value={value}
                    onChangeText={onChange}
                    keyboardType="numeric"
                    maxLength={6}
                />
                <Text style={nf.unit}>{unit}</Text>
            </View>
        </View>
    );
}

const nf = StyleSheet.create({
    wrap:  { flex: 1, minWidth: '45%' as any },
    label: { ...typography.micro, color: colors.textSecondary, fontWeight: '700', marginBottom: 4, letterSpacing: 0.3 },
    row:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
    input: { flex: 1, height: 42, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, ...typography.body, color: colors.textPrimary },
    unit:  { ...typography.caption, color: colors.textSecondary, minWidth: 24 },
});

function MacroBar({ protein, carbs, fat }: { protein: number; carbs: number; fat: number }) {
    const total = protein * 4 + carbs * 4 + fat * 9;
    if (total === 0) return null;
    const pPct = Math.round((protein * 4 / total) * 100);
    const cPct = Math.round((carbs * 4 / total) * 100);
    const fPct = 100 - pPct - cPct;

    // Macro bar colors — semantic, not from theme (nutrition-specific)
    const PROTEIN_COLOR = '#0E6B64';
    const CARB_COLOR    = '#F59E0B';
    const FAT_COLOR     = '#EF4444';

    return (
        <View style={mb.wrap}>
            <View style={mb.bar}>
                <View style={[mb.seg, { width: `${pPct}%` as any, backgroundColor: PROTEIN_COLOR }]} />
                <View style={[mb.seg, { width: `${cPct}%` as any, backgroundColor: CARB_COLOR }]} />
                <View style={[mb.seg, { width: `${fPct}%` as any, backgroundColor: FAT_COLOR }]} />
            </View>
            <View style={mb.legend}>
                <Text style={[mb.legendTxt, { color: PROTEIN_COLOR }]}>Protein {pPct}%</Text>
                <Text style={[mb.legendTxt, { color: CARB_COLOR }]}>Carbs {cPct}%</Text>
                <Text style={[mb.legendTxt, { color: FAT_COLOR }]}>Fat {fPct}%</Text>
            </View>
        </View>
    );
}

const mb = StyleSheet.create({
    wrap:      { marginTop: spacing.xs, marginBottom: spacing.sm },
    bar:       { flexDirection: 'row', height: 8, borderRadius: radius.pill, backgroundColor: colors.border },
    seg:       { height: '100%' as any },
    legend:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
    legendTxt: { fontSize: 10, fontWeight: '600' },
});

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NutritionCard(props: NutritionCardProps) {
    const [open, setOpen] = useState(false);
    const hasAny = props.calories || props.protein || props.carbs || props.fat;

    return (
        <View style={nc.card}>
            <TouchableOpacity
                style={nc.header}
                onPress={() => setOpen(o => !o)}
                activeOpacity={0.75}
                accessibilityRole="button"
            >
                <View style={{ flex: 1 }}>
                    <View style={nc.titleRow}>
                        <Ionicons name="nutrition-outline" size={16} color={colors.accent} />
                        <Text style={nc.title}>Nutrition today</Text>
                    </View>
                    <Text style={nc.subtitle}>
                        {hasAny
                            ? [
                                props.calories && `${props.calories} kcal`,
                                props.protein  && `${props.protein}g protein`,
                              ].filter(Boolean).join(' · ')
                            : 'Optional — tap to log calories & macros'}
                    </Text>
                </View>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textTertiary} />
            </TouchableOpacity>

            {open && (
                <View style={nc.body}>
                    <View style={nc.row}>
                        <NutritionField label="CALORIES" unit="kcal" placeholder="e.g. 2000" value={props.calories} onChange={props.onCalories} />
                        <NutritionField label="PROTEIN"  unit="g"    placeholder="e.g. 150"  value={props.protein}  onChange={props.onProtein}  />
                    </View>
                    <View style={nc.row}>
                        <NutritionField label="CARBS" unit="g" placeholder="e.g. 250" value={props.carbs} onChange={props.onCarbs} />
                        <NutritionField label="FAT"   unit="g" placeholder="e.g. 70"  value={props.fat}   onChange={props.onFat}   />
                    </View>
                    <MacroBar
                        protein={parseFloat(props.protein) || 0}
                        carbs={parseFloat(props.carbs) || 0}
                        fat={parseFloat(props.fat) || 0}
                    />
                </View>
            )}
        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const nc = StyleSheet.create({
    // NOTE: no overflow:'hidden' here — would block touches on child Touchables
    card:     { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.base, ...shadows.card },
    header:   { flexDirection: 'row', alignItems: 'center', padding: spacing.base, gap: spacing.sm },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    title:    { ...typography.label, color: colors.textPrimary, marginBottom: 2 },
    subtitle: { ...typography.caption, color: colors.textSecondary },
    body:     { paddingHorizontal: spacing.base, paddingBottom: spacing.base, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
    row:      { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
});
