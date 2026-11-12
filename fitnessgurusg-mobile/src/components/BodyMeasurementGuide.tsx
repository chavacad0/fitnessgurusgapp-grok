/**
 * BodyMeasurementGuide — Interactive measurement guide + editable inputs.
 *
 * Features:
 *   • Smooth body silhouette (PNG asset; no extra native library)
 *   • Tappable measurement markers: Neck, Chest, Waist, Hips
 *   • Active state highlights the selected area with instructional text
 *   • Editable numeric inputs with explicit Save
 *   • Supports 'female' (4 areas) and 'male' (2 areas) modes
 *   • Uses Phase 1 design tokens
 */

import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    ActivityIndicator,
    Alert,
    Image,
    LayoutChangeEvent,
    Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography, shadows } from '../theme/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

type MeasurementArea = 'neck' | 'chest' | 'waist' | 'hips';

interface AreaConfig {
    key: MeasurementArea;
    label: string;
    apiField: string;
    instruction: string;
    /** Vertical position on the silhouette (percentage from top) */
    position: number;
}

/** Values coming from the API — null means "not set". */
export interface MeasurementValues {
    neck_cm:  number | null;
    chest_cm: number | null;
    waist_cm: number | null;
    hips_cm:  number | null;
}

export interface BodyMeasurementGuideProps {
    /** Controls which areas are shown. Defaults to 'female'. */
    measurementType?: 'female' | 'male';
    /** Current persisted measurement values. */
    values: MeasurementValues;
    /** Called when the user saves. Parent handles API call + reload. */
    onSave: (data: Partial<Record<string, number>>) => Promise<void>;
    /** Whether a save is in progress (parent manages). */
    saving?: boolean;
}

// ─── Area Definitions ─────────────────────────────────────────────────────────

const FEMALE_AREAS: AreaConfig[] = [
    {
        key: 'neck',
        label: 'Neck',
        apiField: 'neck_cm',
        instruction: 'Measure around the base of your neck, just above where it meets your shoulders.',
        position: 12,
    },
    {
        key: 'chest',
        label: 'Chest',
        apiField: 'chest_cm',
        instruction: 'Measure around the fullest part of your chest, keeping the tape level across your back.',
        position: 30,
    },
    {
        key: 'waist',
        label: 'Waist',
        apiField: 'waist_cm',
        instruction: 'Measure around the smallest part of your waist, usually just above your navel.',
        position: 48,
    },
    {
        key: 'hips',
        label: 'Hips',
        apiField: 'hips_cm',
        instruction: 'Measure around the widest part of your hips and glutes.',
        position: 64,
    },
];

const MALE_AREAS: AreaConfig[] = [
    {
        key: 'neck',
        label: 'Neck',
        apiField: 'neck_cm',
        instruction: 'Measure around the base of your neck, just above where it meets your shoulders.',
        position: 12,
    },
    {
        key: 'waist',
        label: 'Waist',
        apiField: 'waist_cm',
        instruction: 'Measure around your waist near the navel, keeping the tape level.',
        position: 48,
    },
];

/**
 * measurement-figure.png is 465×786 (@3x of the approved crop).
 * Circles are baked into the image. cx/cy/r are pixels in that crop,
 * so the transparent hit areas stay on the numbers at any width.
 */
const FIGURE_W = 465;
const FIGURE_H = 786;
const MARKERS: Record<MeasurementArea, { cx: number; cy: number; r: number }> = {
    neck:  { cx: 389,   cy: 139,   r: 24.5 },
    chest: { cx: 389.5, cy: 224.5, r: 25 },
    waist: { cx: 389.5, cy: 314.5, r: 25 },
    hips:  { cx: 393,   cy: 400.5, r: 25.5 },
};

function MeasurementFigure({
    areas,
    focusedArea,
    onSelect,
}: {
    areas: AreaConfig[];
    focusedArea: MeasurementArea | null;
    onSelect: (key: MeasurementArea) => void;
}) {
    const [box, setBox] = useState({ w: 0, h: 0 });

    const onLayout = (e: LayoutChangeEvent) => {
        const { width, height } = e.nativeEvent.layout;
        if (width !== box.w || height !== box.h) setBox({ w: width, h: height });
    };

    return (
        <View style={fig.wrap} onLayout={onLayout}>
            <Image
                source={require('../../assets/measurement-figure.png')}
                style={fig.image}
                resizeMode="stretch"
                accessible={false}
            />
            {box.w > 0 && areas.map((area, index) => {
                const marker = MARKERS[area.key];
                const active = focusedArea === area.key;
                const size = (marker.r * 2 * box.w) / FIGURE_W;
                const left = ((marker.cx - marker.r) * box.w) / FIGURE_W;
                const top = ((marker.cy - marker.r) * box.h) / FIGURE_H;
                const ringPad = (3 * box.w) / FIGURE_W;
                const ringSize = size + ringPad * 2;
                return (
                    <React.Fragment key={area.key}>
                        {active && (
                            <View
                                pointerEvents="none"
                                style={[
                                    fig.ring,
                                    {
                                        left: left - ringPad,
                                        top: top - ringPad,
                                        width: ringSize,
                                        height: ringSize,
                                        borderRadius: ringSize / 2,
                                    },
                                ]}
                            />
                        )}
                        <Pressable
                            style={{
                                position: 'absolute',
                                left,
                                top,
                                width: size,
                                height: size,
                                borderRadius: size / 2,
                            }}
                            onPress={() => onSelect(area.key)}
                            accessibilityRole="button"
                            accessibilityLabel={`${area.label}, marker ${index + 1}`}
                            accessibilityState={{ selected: active }}
                        />
                    </React.Fragment>
                );
            })}
        </View>
    );
}

const fig = StyleSheet.create({
    wrap: {
        width: '40%',
        aspectRatio: FIGURE_W / FIGURE_H,
    },
    image: { width: '100%', height: '100%' },
    ring: {
        position: 'absolute',
        borderWidth: 2,
        borderColor: colors.primary,
    },
});

// ─── Component ────────────────────────────────────────────────────────────────

export default function BodyMeasurementGuide({
    measurementType = 'female',
    values,
    onSave,
    saving = false,
}: BodyMeasurementGuideProps) {
    const areas = measurementType === 'male' ? MALE_AREAS : FEMALE_AREAS;

    // ── Local editing state ───────────────────────────────────────────────────
    const [editing, setEditing]       = useState(false);
    const [focusedArea, setFocusedArea] = useState<MeasurementArea | null>(null);

    // Draft values (string buffers for TextInputs)
    const [drafts, setDrafts] = useState<Record<string, string>>({});

    // Sync drafts when values change (e.g. after reload)
    useEffect(() => {
        const d: Record<string, string> = {};
        for (const area of areas) {
            const val = values[area.apiField as keyof MeasurementValues];
            d[area.apiField] = val != null ? String(val) : '';
        }
        setDrafts(d);
    }, [values]); // eslint-disable-line react-hooks/exhaustive-deps

    const startEdit = () => setEditing(true);
    const cancelEdit = () => {
        // Reset drafts to persisted values
        const d: Record<string, string> = {};
        for (const area of areas) {
            const val = values[area.apiField as keyof MeasurementValues];
            d[area.apiField] = val != null ? String(val) : '';
        }
        setDrafts(d);
        setEditing(false);
        setFocusedArea(null);
    };

    const handleSave = async () => {
        // Validate all filled fields
        const payload: Record<string, number> = {};
        for (const area of areas) {
            const raw = drafts[area.apiField]?.trim();
            if (raw && raw.length > 0) {
                const num = parseFloat(raw);
                if (isNaN(num) || num <= 0 || num > 300) {
                    Alert.alert(
                        `Invalid ${area.label}`,
                        `Enter a valid measurement in cm (e.g. 73.5). Must be between 0.1 and 300.`,
                    );
                    return;
                }
                payload[area.apiField] = num;
            }
        }

        if (Object.keys(payload).length === 0) {
            Alert.alert('No measurements', 'Enter at least one measurement value to save.');
            return;
        }

        try {
            await onSave(payload);
            setEditing(false);
            setFocusedArea(null);
        } catch {
            // Error handled by parent
        }
    };

    const updateDraft = (field: string, val: string) => {
        setDrafts(prev => ({ ...prev, [field]: val }));
    };

    const activeConfig = areas.find(a => a.key === focusedArea) ?? null;

    // ── Is there any saved data? ──────────────────────────────────────────────
    const hasSavedData = areas.some(
        a => values[a.apiField as keyof MeasurementValues] != null,
    );

    return (
        <View style={s.card}>
            {/* Header */}
            <View style={s.headerRow}>
                <View style={s.headerLeft}>
                    <Ionicons name="body-outline" size={18} color={colors.accent} />
                    <Text style={s.title}>Body Measurements</Text>
                </View>
                {!editing && (
                    <TouchableOpacity
                        onPress={startEdit}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityRole="button"
                        accessibilityLabel="Edit measurements"
                    >
                        <Text style={s.editLink}>
                            {hasSavedData ? 'Edit' : 'Add'}
                        </Text>
                    </TouchableOpacity>
                )}
            </View>
            <Text style={s.subtitle}>
                {editing
                    ? 'Tap a number, then enter the measurement in cm.'
                    : 'Tap a number to see where to measure.'}
            </Text>

            <View style={s.mgrid}>
                <MeasurementFigure
                    areas={areas}
                    focusedArea={focusedArea}
                    onSelect={key => setFocusedArea(focusedArea === key ? null : key)}
                />
                <View style={s.mTiles}>
                    {areas.map((area, index) => {
                        const isActive = focusedArea === area.key;
                        const savedVal = values[area.apiField as keyof MeasurementValues];
                        const draftVal = drafts[area.apiField] ?? '';
                        return (
                            <TouchableOpacity
                                key={area.key}
                                style={[s.mTile, isActive && s.mTileActive]}
                                onPress={() => setFocusedArea(focusedArea === area.key ? null : area.key)}
                                activeOpacity={0.8}
                                accessibilityRole="button"
                                accessibilityLabel={`${area.label} measurement`}
                                accessibilityState={{ selected: isActive }}
                            >
                                <View style={s.mLabelRow}>
                                    <View style={s.mNum}>
                                        <Text style={s.mNumText}>{index + 1}</Text>
                                    </View>
                                    <Text style={s.mLabel}>{area.label}</Text>
                                </View>
                                {editing ? (
                                    <TextInput
                                        style={s.mInput}
                                        value={draftVal}
                                        onChangeText={(v) => updateDraft(area.apiField, v)}
                                        onFocus={() => setFocusedArea(area.key)}
                                        placeholder="cm"
                                        placeholderTextColor={colors.textTertiary}
                                        keyboardType="numeric"
                                        maxLength={6}
                                        accessibilityLabel={`${area.label} in cm`}
                                    />
                                ) : savedVal != null ? (
                                    <Text style={s.mValue}>{savedVal} <Text style={s.mUnit}>cm</Text></Text>
                                ) : (
                                    <Text style={s.mUnset}>Not set</Text>
                                )}
                            </TouchableOpacity>
                        );
                    })}
                </View>
            </View>

            {/* Instruction callout */}
            {activeConfig ? (
                <View style={s.instruction}>
                    <View style={s.instructionIcon}>
                        <Ionicons name="information-circle" size={18} color={colors.accent} />
                    </View>
                    <View style={s.instructionContent}>
                        <Text style={s.instructionTitle}>{activeConfig.label}</Text>
                        <Text style={s.instructionText}>{activeConfig.instruction}</Text>
                    </View>
                </View>
            ) : (
                <View style={s.hintRow}>
                    <Ionicons name="hand-left-outline" size={14} color={colors.textTertiary} />
                    <Text style={s.hintText}>Tap an area to see instructions</Text>
                </View>
            )}

            {/* Edit actions */}
            {editing && (
                <View style={s.actionRow}>
                    <TouchableOpacity
                        style={s.cancelBtn}
                        onPress={cancelEdit}
                        disabled={saving}
                        accessibilityRole="button"
                    >
                        <Text style={s.cancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[s.saveBtn, saving && s.saveBtnDisabled]}
                        onPress={handleSave}
                        disabled={saving}
                        accessibilityRole="button"
                    >
                        {saving ? (
                            <ActivityIndicator size="small" color="#fff" />
                        ) : (
                            <Text style={s.saveBtnText}>Save Measurements</Text>
                        )}
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const SILHOUETTE_BG   = '#E8ECF0';
const SILHOUETTE_BODY = '#D1D8E0';
const MARKER_DEFAULT  = '#C5CDD5';
const MARKER_ACTIVE   = colors.accent;

const s = StyleSheet.create({
    mgrid: { flexDirection: 'row', gap: spacing.base, alignItems: 'center' },
    mTiles: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    mTile: {
        width: '47%',
        borderWidth: 1,
        borderColor: '#C9E8DF',
        borderRadius: radius.md,
        backgroundColor: '#F0FAF6',
        padding: spacing.sm,
        minHeight: 72,
        justifyContent: 'center',
    },
    mTileActive: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
    mLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
    mNum: {
        width: 16, height: 16, borderRadius: 8,
        backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    },
    mNumText: { color: colors.textOnPrimary, fontSize: 9, fontWeight: '700' },
    mLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    mValue: { ...typography.label, color: colors.accent },
    mUnit: { fontSize: 11, fontWeight: '500', color: colors.textSecondary },
    mUnset: { ...typography.caption, color: colors.textTertiary },
    mInput: {
        borderBottomWidth: 1, borderBottomColor: colors.accent,
        paddingVertical: 2, fontSize: 14, color: colors.textPrimary,
    },

    card: {
        backgroundColor: colors.surface,
        borderRadius:     radius.card,
        borderWidth:      1,
        borderColor:      colors.border,
        padding:          spacing.base,
        ...shadows.card,
    },

    // Header
    headerRow: {
        flexDirection:  'row',
        alignItems:     'center',
        justifyContent: 'space-between',
        marginBottom:   4,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems:    'center',
        gap:           6,
    },
    title: {
        ...typography.label,
        color:      colors.textPrimary,
        fontWeight: '700',
    },
    editLink: {
        fontSize:   13,
        fontWeight: '600',
        color:      colors.accent,
    },
    subtitle: {
        ...typography.caption,
        color:        colors.textSecondary,
        marginBottom: spacing.base,
    },

    // Layout
    guideContainer: {
        flexDirection: 'row',
        gap:           spacing.md,
        marginBottom:  spacing.base,
    },

    // Silhouette
    silhouette: {
        width:           100,
        alignItems:      'center',
        backgroundColor: SILHOUETTE_BG,
        borderRadius:    radius.md,
        paddingVertical: spacing.md,
        minHeight:       220,
    },
    head: {
        width:           24,
        height:          24,
        borderRadius:    12,
        backgroundColor: SILHOUETTE_BODY,
        marginBottom:    4,
    },
    trunk: {
        flex:                       1,
        width:                      70,
        backgroundColor:            SILHOUETTE_BODY,
        borderTopLeftRadius:        18,
        borderTopRightRadius:       18,
        borderBottomLeftRadius:     6,
        borderBottomRightRadius:    6,
        position:                   'relative',
    },
    legs: {
        flexDirection:  'row',
        justifyContent: 'center',
        marginTop:      2,
    },
    leg: {
        width:                      26,
        height:                     42,
        backgroundColor:            SILHOUETTE_BODY,
        borderBottomLeftRadius:     8,
        borderBottomRightRadius:    8,
    },
    legGap: { width: 5 },

    // Markers on silhouette
    markerRow: {
        position:       'absolute',
        left:           0,
        right:          0,
        flexDirection:  'row',
        alignItems:     'center',
        justifyContent: 'center',
        height:         22,
        marginTop:      -11,
    },
    markerLine: {
        position:        'absolute',
        left:            4,
        right:           4,
        height:          2,
        backgroundColor: MARKER_DEFAULT,
        borderRadius:    1,
    },
    markerLineActive: {
        backgroundColor: MARKER_ACTIVE,
        height:          2.5,
    },
    markerPill: {
        backgroundColor:   'rgba(255,255,255,0.85)',
        paddingHorizontal: 5,
        paddingVertical:   1,
        borderRadius:      radius.xs,
        borderWidth:       1,
        borderColor:       MARKER_DEFAULT,
    },
    markerPillActive: {
        backgroundColor: colors.accentSubtle,
        borderColor:     MARKER_ACTIVE,
    },
    markerLabel: {
        fontSize:       8,
        fontWeight:     '700',
        color:          colors.textSecondary,
        letterSpacing:  0.3,
        textTransform:  'uppercase',
    },
    markerLabelActive: { color: MARKER_ACTIVE },

    // Values column
    valuesColumn: {
        flex:           1,
        justifyContent: 'center',
        gap:            spacing.sm,
    },
    valueRow: {
        flexDirection:     'row',
        alignItems:        'center',
        gap:               spacing.sm,
        paddingVertical:   8,
        paddingHorizontal: spacing.md,
        backgroundColor:   colors.background,
        borderRadius:      radius.md,
        borderWidth:       1,
        borderColor:       colors.border,
    },
    valueRowActive: {
        backgroundColor: colors.accentSubtle,
        borderColor:     colors.accent,
    },
    valueDot: {
        width:           7,
        height:          7,
        borderRadius:    3.5,
        backgroundColor: MARKER_DEFAULT,
    },
    valueDotActive: { backgroundColor: MARKER_ACTIVE },
    valueLabel: {
        fontSize:   12,
        fontWeight: '600',
        color:      colors.textPrimary,
        width:      42,
    },
    valueLabelActive: { color: colors.accent },
    valueDisplay: {
        flex:       1,
        textAlign:  'right',
        fontSize:   13,
        color:      colors.textSecondary,
    },
    valueUnset: { color: colors.textTertiary, fontWeight: '400' },
    valueDisplayActive: { color: colors.accent, fontWeight: '600' },

    // Input group
    inputGroup: {
        flex:           1,
        flexDirection:  'row',
        alignItems:     'center',
        justifyContent: 'flex-end',
        gap:            4,
    },
    valueInput: {
        width:           56,
        height:          30,
        borderWidth:     1,
        borderColor:     colors.border,
        borderRadius:    radius.xs,
        backgroundColor: colors.surface,
        textAlign:       'center',
        fontSize:        13,
        fontWeight:      '600',
        color:           colors.textPrimary,
        paddingVertical: 0,
    },
    valueInputActive: {
        borderColor: colors.accent,
    },
    unitText: {
        fontSize: 12,
        color:    colors.textTertiary,
    },

    // Instruction callout
    instruction: {
        flexDirection:   'row',
        gap:             spacing.sm,
        padding:         spacing.md,
        backgroundColor: colors.accentSubtle,
        borderRadius:    radius.md,
        borderWidth:     1,
        borderColor:     colors.accent + '30',
        marginBottom:    spacing.sm,
    },
    instructionIcon: { marginTop: 1 },
    instructionContent: { flex: 1 },
    instructionTitle: {
        fontSize:     13,
        fontWeight:   '700',
        color:        colors.accent,
        marginBottom: 2,
    },
    instructionText: {
        fontSize:   13,
        color:      colors.textPrimary,
        lineHeight: 19,
    },

    // Hint
    hintRow: {
        flexDirection:  'row',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            6,
        paddingVertical: spacing.sm,
        marginBottom:   spacing.sm,
    },
    hintText: {
        ...typography.caption,
        color: colors.textTertiary,
    },

    // Action buttons
    actionRow: {
        flexDirection:  'row',
        gap:            spacing.md,
        marginTop:      spacing.sm,
    },
    cancelBtn: {
        flex:            1,
        paddingVertical: 12,
        borderRadius:    radius.md,
        borderWidth:     1,
        borderColor:     colors.border,
        alignItems:      'center',
    },
    cancelBtnText: {
        fontSize:   14,
        fontWeight: '600',
        color:      colors.textSecondary,
    },
    saveBtn: {
        flex:            2,
        paddingVertical: 12,
        borderRadius:    radius.md,
        backgroundColor: colors.accent,
        alignItems:      'center',
    },
    saveBtnDisabled: { opacity: 0.6 },
    saveBtnText: {
        fontSize:   14,
        fontWeight: '700',
        color:      '#FFFFFF',
    },
});
