/**
 * Body Measurements card on the client Profile.
 *
 * Female figure: 1 Neck, 2 Waist, 3 Hips.
 * Male figure: 1 Neck, 2 Waist.
 * Chest is not on the figure. It stays under "+ Add more" so a saved chest
 * number is not lost. Arms and thighs are not listed: the profile has no
 * fields for them.
 * Body-fat estimate is not shown. It needs measurement history (AUD-009).
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
    ImageSourcePropType,
    LayoutChangeEvent,
    Pressable,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, radius, typography, shadows } from '../theme/theme';
import { fontStyle, useKitFonts } from '../theme/fonts';

export type MeasurementFigure = 'female' | 'male';

type MeasurementArea = 'neck' | 'chest' | 'waist' | 'hips';

interface AreaConfig {
    key: MeasurementArea;
    label: string;
    apiField: keyof MeasurementValues;
    instruction: string;
}

/** Values coming from the API — null means "not set". */
export interface MeasurementValues {
    neck_cm:  number | null;
    chest_cm: number | null;
    waist_cm: number | null;
    hips_cm:  number | null;
}

export type MeasurementSave = Partial<{
    neck_cm: number;
    chest_cm: number;
    waist_cm: number;
    hips_cm: number;
    height_cm: number;
}>;

export interface BodyMeasurementGuideProps {
    /** Which figure is selected. Defaults to female when the profile has no sex. */
    figure?: MeasurementFigure;
    /** Current persisted measurement values. */
    values: MeasurementValues;
    /** Height in cm from the existing profile field. Null means not set. */
    heightCm?: number | null;
    /** Called when the user saves measurements and/or height. */
    onSave: (data: MeasurementSave) => Promise<void>;
    /** Called when Female or Male is chosen. The parent stores it on the profile. */
    onFigureChange?: (figure: MeasurementFigure) => Promise<void>;
    /** Whether a measurement save is in progress (parent manages). */
    saving?: boolean;
}

const NECK: AreaConfig = {
    key: 'neck',
    label: 'Neck',
    apiField: 'neck_cm',
    instruction: 'Measure around the base of your neck, just above where it meets your shoulders.',
};

const WAIST_FEMALE: AreaConfig = {
    key: 'waist',
    label: 'Waist',
    apiField: 'waist_cm',
    instruction: 'Measure around the smallest part of your waist, usually just above your navel.',
};

const WAIST_MALE: AreaConfig = {
    key: 'waist',
    label: 'Waist',
    apiField: 'waist_cm',
    instruction: 'Measure around your waist near the navel, keeping the tape level.',
};

const HIPS: AreaConfig = {
    key: 'hips',
    label: 'Hips',
    apiField: 'hips_cm',
    instruction: 'Measure around the widest part of your hips and glutes.',
};

const CHEST: AreaConfig = {
    key: 'chest',
    label: 'Chest',
    apiField: 'chest_cm',
    instruction: 'Measure around the fullest part of your chest, keeping the tape level across your back.',
};

/** Numbered points drawn on each figure. Chest is not one of them. */
const NUMBERED: Record<MeasurementFigure, AreaConfig[]> = {
    female: [NECK, WAIST_FEMALE, HIPS],
    male: [NECK, WAIST_MALE],
};

/**
 * Extra tape measures the profile can already store.
 * Arms and thighs are omitted because those fields do not exist.
 */
const EXTRA_AREAS: AreaConfig[] = [CHEST];

/**
 * Both PNGs are 465×786 at @3x. Circles are baked into the image.
 * cx/cy/r are pixels in that crop, so the hit areas stay on the numbers.
 */
const FIGURE_W = 465;
const FIGURE_H = 786;

const MARKERS: Record<MeasurementFigure, Partial<Record<MeasurementArea, { cx: number; cy: number; r: number }>>> = {
    female: {
        neck:  { cx: 389, cy: 139, r: 26 },
        waist: { cx: 389, cy: 314, r: 26 },
        hips:  { cx: 393, cy: 401, r: 26 },
    },
    male: {
        neck:  { cx: 389, cy: 139, r: 26 },
        waist: { cx: 389, cy: 314, r: 26 },
    },
};

const FIGURE_IMAGE: Record<MeasurementFigure, ImageSourcePropType> = {
    female: require('../../assets/measurement-figure-female.png'),
    male: require('../../assets/measurement-figure-male.png'),
};

const SAGE = '#4F7F71';

function draftsFrom(values: MeasurementValues, heightCm: number | null | undefined): Record<string, string> {
    return {
        neck_cm:   values.neck_cm  != null ? String(values.neck_cm)  : '',
        chest_cm:  values.chest_cm != null ? String(values.chest_cm) : '',
        waist_cm:  values.waist_cm != null ? String(values.waist_cm) : '',
        hips_cm:   values.hips_cm  != null ? String(values.hips_cm)  : '',
        height_cm: heightCm != null ? String(heightCm) : '',
    };
}

function MeasurementFigureImage({
    figure,
    areas,
    focusedArea,
    onSelect,
}: {
    figure: MeasurementFigure;
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
                source={FIGURE_IMAGE[figure]}
                style={fig.image}
                resizeMode="stretch"
                accessible={false}
            />
            {box.w > 0 && areas.map((area, index) => {
                const marker = MARKERS[figure][area.key];
                if (!marker) return null;
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
                            accessibilityLabel={`${index + 1} ${area.label}`}
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
        width: '38%',
        aspectRatio: FIGURE_W / FIGURE_H,
    },
    image: { width: '100%', height: '100%' },
    ring: {
        position: 'absolute',
        borderWidth: 2,
        borderColor: colors.accent,
    },
});

export default function BodyMeasurementGuide({
    figure = 'female',
    values,
    heightCm = null,
    onSave,
    onFigureChange,
    saving = false,
}: BodyMeasurementGuideProps) {
    const fonts = useKitFonts();
    const areas = NUMBERED[figure];

    const [editing, setEditing] = useState(false);
    const [focusedArea, setFocusedArea] = useState<MeasurementArea | null>(null);
    const [focusHeight, setFocusHeight] = useState(false);
    const [extrasOpen, setExtrasOpen] = useState(values.chest_cm != null);
    const [figureSaving, setFigureSaving] = useState(false);
    const [drafts, setDrafts] = useState<Record<string, string>>(() => draftsFrom(values, heightCm));

    useEffect(() => {
        if (editing) return;
        setDrafts(draftsFrom(values, heightCm));
    }, [editing, values.neck_cm, values.chest_cm, values.waist_cm, values.hips_cm, heightCm]);

    useEffect(() => {
        if (values.chest_cm != null) setExtrasOpen(true);
    }, [values.chest_cm]);

    useEffect(() => {
        if (focusedArea && focusedArea !== 'chest' && !areas.some(area => area.key === focusedArea)) {
            setFocusedArea(null);
        }
    }, [figure, focusedArea, areas]);

    const startEdit = (fromHeight = false) => {
        setFocusHeight(fromHeight);
        setEditing(true);
    };

    const cancelEdit = () => {
        setDrafts(draftsFrom(values, heightCm));
        setEditing(false);
        setFocusedArea(null);
        setFocusHeight(false);
    };

    const handleSave = async () => {
        const payload: MeasurementSave = {};
        const fields: { field: keyof MeasurementSave; label: string }[] = [
            ...areas.map(area => ({ field: area.apiField, label: area.label })),
            { field: CHEST.apiField, label: CHEST.label },
            { field: 'height_cm', label: 'Height' },
        ];

        for (const { field, label } of fields) {
            const raw = drafts[field]?.trim();
            if (!raw) continue;
            const num = parseFloat(raw);
            if (isNaN(num) || num <= 0 || num > 300) {
                Alert.alert(
                    `Invalid ${label}`,
                    'Enter a valid measurement in cm (e.g. 73.5). Must be between 0.1 and 300.',
                );
                return;
            }
            payload[field] = num;
        }

        if (Object.keys(payload).length === 0) {
            Alert.alert('Nothing to save', 'Enter a measurement or a height in cm.');
            return;
        }

        try {
            await onSave(payload);
            setEditing(false);
            setFocusedArea(null);
            setFocusHeight(false);
        } catch {
            // Error handled by parent
        }
    };

    const updateDraft = (field: string, val: string) => {
        setDrafts(prev => ({ ...prev, [field]: val }));
    };

    const selectFigure = async (next: MeasurementFigure) => {
        if (next === figure || figureSaving || saving || !onFigureChange) return;
        setFigureSaving(true);
        try {
            await onFigureChange(next);
        } catch {
            // Parent shows the error. The switch stays on the saved figure.
        } finally {
            setFigureSaving(false);
        }
    };

    const toggleFocus = (key: MeasurementArea) => {
        setFocusedArea(focusedArea === key ? null : key);
    };

    const activeConfig = focusedArea === 'chest'
        ? CHEST
        : areas.find(area => area.key === focusedArea) ?? null;

    const hasSavedData = areas.some(
        area => values[area.apiField] != null,
    ) || values.chest_cm != null;

    const chestVisible = extrasOpen || values.chest_cm != null || (drafts.chest_cm ?? '').trim().length > 0;
    const extraNames = EXTRA_AREAS.map(area => area.label.toLowerCase()).join(', ');

    const renderTile = (area: AreaConfig, index: number, shareRow: boolean) => {
        const isActive = focusedArea === area.key;
        const savedVal = values[area.apiField];
        return (
            <TouchableOpacity
                key={area.key}
                style={[s.mTile, shareRow && s.mTileFlex, isActive && s.mTileActive]}
                onPress={() => toggleFocus(area.key)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`${index + 1} ${area.label}`}
                accessibilityState={{ selected: isActive }}
            >
                <View style={s.mLabelRow}>
                    <View style={s.mNum}>
                        <Text style={s.mNumText}>{index + 1}</Text>
                    </View>
                    <Text style={[s.mLabel, fontStyle(fonts.bodySemibold, '700')]}>{area.label}</Text>
                </View>
                {renderValue(area, savedVal)}
            </TouchableOpacity>
        );
    };

    const renderValue = (area: AreaConfig, savedVal: number | null) => {
        const draftVal = drafts[area.apiField] ?? '';
        if (editing) {
            return (
                <TextInput
                    style={s.mInput}
                    value={draftVal}
                    onChangeText={v => updateDraft(area.apiField, v)}
                    onFocus={() => setFocusedArea(area.key)}
                    placeholder="cm"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="decimal-pad"
                    maxLength={6}
                    accessibilityLabel={`${area.label} in cm`}
                />
            );
        }
        if (savedVal != null) {
            return <Text style={s.mValue}>{savedVal} <Text style={s.mUnit}>cm</Text></Text>;
        }
        return <Text style={s.mUnset}>Not set</Text>;
    };

    return (
        <View style={s.card}>
            <View style={s.headerRow}>
                <View style={s.headerLeft}>
                    <Ionicons name="person-outline" size={18} color={colors.accent} />
                    <Text style={[s.title, fontStyle(fonts.headingSemibold, '700')]}>Body Measurements</Text>
                </View>
                {!editing && (
                    <TouchableOpacity
                        onPress={() => startEdit(false)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityRole="button"
                        accessibilityLabel={hasSavedData ? 'Edit measurements' : 'Add measurements'}
                    >
                        <Text style={[s.editLink, fontStyle(fonts.bodySemibold, '600')]}>
                            {hasSavedData ? 'Edit' : 'Add'}
                        </Text>
                    </TouchableOpacity>
                )}
            </View>
            <Text style={[s.subtitle, fontStyle(fonts.body, '400')]}>
                {editing
                    ? 'Tap a number, then enter the measurement in cm.'
                    : 'Tap a number to see where to measure.'}
            </Text>

            <View style={s.figureRow}>
                <Text style={[s.figureLabel, fontStyle(fonts.body, '400')]}>Figure</Text>
                <View style={s.segment} accessibilityRole="tablist">
                    {(['female', 'male'] as const).map(option => {
                        const on = figure === option;
                        const label = option === 'female' ? 'Female' : 'Male';
                        return (
                            <Pressable
                                key={option}
                                style={[s.segmentBtn, on && s.segmentOn]}
                                onPress={() => { void selectFigure(option); }}
                                disabled={figureSaving || saving}
                                accessibilityRole="tab"
                                accessibilityLabel={`${label} figure`}
                                accessibilityState={{ selected: on, disabled: figureSaving || saving }}
                            >
                                <Text style={[
                                    s.segmentText,
                                    on ? s.segmentTextOn : s.segmentTextOff,
                                    fontStyle(on ? fonts.bodySemibold : fonts.body, on ? '600' : '400'),
                                ]}>
                                    {label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
            </View>

            <View style={s.mgrid}>
                <MeasurementFigureImage
                    figure={figure}
                    areas={areas}
                    focusedArea={focusedArea}
                    onSelect={toggleFocus}
                />
                <View style={s.mTiles}>
                    {figure === 'female' ? (
                        <>
                            <View style={s.tilePair}>
                                {areas.slice(0, 2).map((area, index) => renderTile(area, index, true))}
                            </View>
                            {areas.slice(2).map((area, index) => renderTile(area, index + 2, false))}
                        </>
                    ) : (
                        areas.map((area, index) => renderTile(area, index, false))
                    )}
                </View>
            </View>

            <TouchableOpacity
                style={s.addMoreRow}
                onPress={() => {
                    const chestHasValue = values.chest_cm != null || (drafts.chest_cm ?? '').trim().length > 0;
                    if (chestHasValue) {
                        setExtrasOpen(true);
                        return;
                    }
                    setExtrasOpen(open => !open);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Add more, ${extraNames}`}
                accessibilityState={{ expanded: chestVisible }}
            >
                <Text style={[s.addMore, fontStyle(fonts.bodySemibold, '600')]}>
                    + Add more ({extraNames})
                </Text>
                <Text style={[s.optional, fontStyle(fonts.body, '400')]}> Optional</Text>
            </TouchableOpacity>

            {chestVisible && (
                <TouchableOpacity
                    style={[s.mTile, s.extraTile, focusedArea === 'chest' && s.mTileActive]}
                    onPress={() => toggleFocus('chest')}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Chest measurement"
                    accessibilityState={{ selected: focusedArea === 'chest' }}
                >
                    <View style={s.mLabelRow}>
                        <Text style={[s.mLabel, fontStyle(fonts.bodySemibold, '700')]}>{CHEST.label}</Text>
                    </View>
                    {renderValue(CHEST, values.chest_cm)}
                </TouchableOpacity>
            )}

            <View style={s.heightRow}>
                <View style={s.heightIcon}>
                    <MaterialCommunityIcons name="ruler" size={16} color={colors.accent} />
                </View>
                <Text style={[s.heightLabel, fontStyle(fonts.bodySemibold, '700')]}>Height</Text>
                {editing ? (
                    <TextInput
                        style={s.heightInput}
                        value={drafts.height_cm ?? ''}
                        onChangeText={v => updateDraft('height_cm', v)}
                        placeholder="cm"
                        placeholderTextColor={colors.textTertiary}
                        keyboardType="decimal-pad"
                        maxLength={6}
                        autoFocus={focusHeight}
                        accessibilityLabel="Height in cm"
                    />
                ) : heightCm != null ? (
                    <TouchableOpacity
                        onPress={() => startEdit(true)}
                        accessibilityRole="button"
                        accessibilityLabel={`Height ${heightCm} centimetres`}
                    >
                        <Text style={[s.heightValue, fontStyle(fonts.headingSemibold, '700')]}>
                            {heightCm} <Text style={s.heightUnit}>cm</Text>
                        </Text>
                    </TouchableOpacity>
                ) : (
                    <TouchableOpacity
                        onPress={() => startEdit(true)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityRole="button"
                        accessibilityLabel="Add height"
                    >
                        <Text style={[s.editLink, fontStyle(fonts.bodySemibold, '600')]}>+ Add</Text>
                    </TouchableOpacity>
                )}
            </View>

            {activeConfig ? (
                <View style={s.instruction}>
                    <View style={s.instructionIcon}>
                        <Ionicons name="information-circle" size={18} color={colors.accent} />
                    </View>
                    <View style={s.instructionContent}>
                        <Text style={[s.instructionTitle, fontStyle(fonts.bodySemibold, '700')]}>{activeConfig.label}</Text>
                        <Text style={[s.instructionText, fontStyle(fonts.body, '400')]}>{activeConfig.instruction}</Text>
                    </View>
                </View>
            ) : (
                <Text style={[s.hintText, fontStyle(fonts.body, '400')]}>Tap an area to see instructions</Text>
            )}

            <Text style={[s.tip, fontStyle(fonts.body, '400')]}>
                <Text style={s.tipLabel}>Tip: </Text>
                Measure in the morning, tape snug not tight.
            </Text>
            <Text style={[s.defaults, fontStyle(fonts.body, '400')]}>
                Defaults from the sex on your profile. You can change the figure any time.
            </Text>

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
                        onPress={() => { void handleSave(); }}
                        disabled={saving}
                        accessibilityRole="button"
                    >
                        {saving ? (
                            <ActivityIndicator size="small" color="#fff" />
                        ) : (
                            <Text style={s.saveBtnText}>Save</Text>
                        )}
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    card: {
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        padding: spacing.base,
        marginBottom: spacing.md,
        ...shadows.soft,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 2,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flex: 1,
    },
    title: {
        fontSize: 17,
        color: colors.primary,
    },
    editLink: {
        fontSize: 15,
        color: colors.accent,
    },
    subtitle: {
        ...typography.caption,
        fontSize: 13,
        color: colors.textSecondary,
        marginBottom: spacing.md,
    },
    figureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.md,
    },
    figureLabel: {
        fontSize: 14,
        color: colors.textSecondary,
    },
    segment: {
        flexDirection: 'row',
        backgroundColor: colors.surfaceMuted,
        borderRadius: radius.pill,
        padding: 3,
    },
    segmentBtn: {
        minWidth: 76,
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: radius.pill,
        alignItems: 'center',
    },
    segmentOn: {
        backgroundColor: colors.surface,
        ...shadows.cardElevated,
    },
    segmentText: { fontSize: 14 },
    segmentTextOn: { color: colors.primary },
    segmentTextOff: { color: colors.textSecondary },

    mgrid: {
        flexDirection: 'row',
        gap: spacing.sm,
        alignItems: 'center',
        marginBottom: spacing.sm,
    },
    mTiles: {
        flex: 1,
        gap: spacing.sm,
        justifyContent: 'center',
    },
    tilePair: {
        flexDirection: 'row',
        gap: spacing.sm,
    },
    mTile: {
        borderWidth: 1,
        borderColor: '#C9E8DF',
        borderRadius: radius.md,
        backgroundColor: colors.accentSubtle,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.sm,
        minHeight: 68,
        justifyContent: 'center',
    },
    mTileFlex: { flex: 1 },
    mTileActive: { borderColor: colors.accent },
    extraTile: { marginBottom: spacing.sm },
    mLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
    mNum: {
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
    },
    mNumText: { color: colors.textOnPrimary, fontSize: 10, fontWeight: '700' },
    mLabel: { fontSize: 14, color: colors.primary },
    mValue: { fontSize: 14, fontWeight: '600', color: colors.accent, marginTop: 2 },
    mUnit: { fontSize: 12, fontWeight: '500', color: colors.textSecondary },
    mUnset: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
    mInput: {
        borderBottomWidth: 1,
        borderBottomColor: colors.accent,
        paddingVertical: 2,
        marginTop: 2,
        fontSize: 14,
        color: colors.textPrimary,
    },

    addMoreRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        paddingVertical: spacing.sm,
    },
    addMore: { fontSize: 14, color: colors.accent },
    optional: { fontSize: 13, color: SAGE },

    heightRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surfaceMuted,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.md,
        paddingVertical: 10,
        marginTop: spacing.xs,
        marginBottom: spacing.md,
        gap: spacing.sm,
    },
    heightIcon: {
        width: 28,
        height: 28,
        borderRadius: 8,
        backgroundColor: colors.accentSubtle,
        alignItems: 'center',
        justifyContent: 'center',
    },
    heightLabel: { flex: 1, fontSize: 15, color: colors.primary },
    heightValue: { fontSize: 16, color: colors.primary },
    heightUnit: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
    heightInput: {
        minWidth: 72,
        borderBottomWidth: 1,
        borderBottomColor: colors.accent,
        paddingVertical: 2,
        fontSize: 16,
        color: colors.textPrimary,
        textAlign: 'right',
    },

    instruction: {
        flexDirection: 'row',
        gap: spacing.sm,
        padding: spacing.md,
        backgroundColor: colors.accentSubtle,
        borderRadius: radius.md,
        marginBottom: spacing.sm,
    },
    instructionIcon: { marginTop: 1 },
    instructionContent: { flex: 1 },
    instructionTitle: {
        fontSize: 13,
        color: colors.accent,
        marginBottom: 2,
    },
    instructionText: {
        fontSize: 13,
        color: colors.textPrimary,
        lineHeight: 19,
    },
    hintText: {
        ...typography.caption,
        color: colors.textTertiary,
        textAlign: 'center',
        marginBottom: spacing.sm,
        marginTop: spacing.xs,
    },
    tip: {
        fontSize: 13,
        color: colors.textSecondary,
        textAlign: 'center',
        lineHeight: 18,
    },
    tipLabel: { fontWeight: '600', color: colors.textSecondary },
    defaults: {
        fontSize: 12,
        color: colors.textTertiary,
        textAlign: 'center',
        lineHeight: 17,
        marginTop: 4,
    },

    actionRow: {
        flexDirection: 'row',
        gap: spacing.md,
        marginTop: spacing.md,
    },
    cancelBtn: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
    },
    cancelBtnText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textSecondary,
    },
    saveBtn: {
        flex: 2,
        paddingVertical: 12,
        borderRadius: radius.md,
        backgroundColor: colors.accent,
        alignItems: 'center',
    },
    saveBtnDisabled: { opacity: 0.6 },
    saveBtnText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#FFFFFF',
    },
});
