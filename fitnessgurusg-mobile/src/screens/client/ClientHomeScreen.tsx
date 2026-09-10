/**
 * ClientHomeScreen — Daily Check-In
 *
 * Clean rebuild — no external UI component dependencies.
 * Rating pickers are inlined directly; all backend logic is preserved.
 *
 * Sections:
 *   Header    — date, greeting
 *   Wellbeing — Energy + Hunger 1-10 pickers (inline TouchableOpacity)
 *   Activity  — Steps (numeric input) + Nutrition (collapsible)
 *   Extra     — Notes + Progress Photos
 *   Submit    — CTA button + success / error states
 *
 * Touch safety rules applied throughout:
 *   ✓ Explicit height on all buttons (never aspectRatio in a flex row)
 *   ✓ No overflow:'hidden' on containers that wrap touchable children
 *   ✓ ScrollView uses keyboardShouldPersistTaps="handled"
 *   ✓ No pointerEvents overrides
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TextInput,
    TouchableOpacity,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Alert,
    Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useAuth }                           from '../../context/AuthContext';
import { submitCheckIn, uploadSingleCheckInPhoto, getTodayWorkout, submitWorkoutLog, updateCheckInPrefs, getWorkoutHistory } from '../../services/apiClient';
import { BASE_URL }                          from '../../config/api';
import { NutritionData, WorkoutAssignment, WorkoutLog, ExerciseLog, WorkoutHistoryEntry } from '../../types';
import { colors, spacing, radius, typography, componentSize, shadows } from '../../theme/theme';

// ─── Constants ───────────────────────────────────────────────────────────────

const TODAY      = new Date().toISOString().split('T')[0];
const MAX_PHOTOS = 3;
const RATINGS    = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

// ─── Photo Picker ─────────────────────────────────────────────────────────────
//
// Upload-on-select: photo uploads immediately when picked.
// Thumbnails show from server URL. Submit sends already-uploaded URLs.

interface PhotoPickerProps {
    photoUrls:      string[];
    uploadingCount: number;
    onAdd:          (localUri: string) => void;
    onRemove:       (url: string) => void;
}

function PhotoPicker({ photoUrls, uploadingCount, onAdd, onRemove }: PhotoPickerProps) {
    const canAdd      = photoUrls.length + uploadingCount < MAX_PHOTOS;
    const isUploading = uploadingCount > 0;

    const showSourcePicker = () => {
        Alert.alert(
            'Add Progress Photo',
            `${photoUrls.length + uploadingCount} / ${MAX_PHOTOS} photos`,
            [
                { text: 'Camera',        onPress: pickCamera  },
                { text: 'Photo Library', onPress: pickLibrary },
                { text: 'Cancel', style: 'cancel' },
            ]
        );
    };

    const pickCamera = async () => {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
            Alert.alert('Camera access needed', 'Allow camera access in Settings.');
            return;
        }
        const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
        if (!result.canceled) onAdd(result.assets[0].uri);
    };

    const pickLibrary = async () => {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
            Alert.alert('Photo library access needed', 'Allow access in Settings.');
            return;
        }
        const remaining = MAX_PHOTOS - photoUrls.length - uploadingCount;
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsMultipleSelection: remaining > 1,
            selectionLimit: remaining,
            quality: 0.7,
        });
        if (!result.canceled) result.assets.forEach(a => onAdd(a.uri));
    };

    return (
        <View style={s.card}>
            <Text style={s.cardLabel}>📸 Progress Photos</Text>
            <Text style={s.cardDesc}>Optional — up to {MAX_PHOTOS} photos</Text>

            {(photoUrls.length > 0 || isUploading) && (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={ph.strip}
                    contentContainerStyle={ph.stripContent}
                >
                    {photoUrls.map(url => (
                        <View key={url} style={ph.thumb}>
                            <Image source={{ uri: `${BASE_URL}${url}` }} style={ph.thumbImg} />
                            <TouchableOpacity
                                style={ph.removeBtn}
                                onPress={() => onRemove(url)}
                                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                            >
                                <Text style={ph.removeX}>✕</Text>
                            </TouchableOpacity>
                        </View>
                    ))}
                    {Array.from({ length: uploadingCount }).map((_, i) => (
                        <View key={`up-${i}`} style={[ph.thumb, ph.thumbLoading]}>
                            <ActivityIndicator color={colors.accent} />
                        </View>
                    ))}
                </ScrollView>
            )}

            {canAdd && (
                <TouchableOpacity
                    style={ph.addBtn}
                    onPress={showSourcePicker}
                    activeOpacity={0.75}
                    disabled={isUploading}
                >
                    <Text style={ph.addPlus}>＋</Text>
                    <Text style={ph.addLabel}>
                        {photoUrls.length === 0 && uploadingCount === 0
                            ? 'Add Photo'
                            : `Add More (${MAX_PHOTOS - photoUrls.length - uploadingCount} left)`}
                    </Text>
                </TouchableOpacity>
            )}
        </View>
    );
}

const ph = StyleSheet.create({
    strip:        { marginVertical: spacing.sm },
    stripContent: { gap: spacing.sm, paddingBottom: 2 },
    thumb:        { width: 80, height: 80, borderRadius: radius.md, position: 'relative', backgroundColor: colors.border },
    thumbImg:     { width: 80, height: 80, borderRadius: radius.md },
    thumbLoading: { alignItems: 'center', justifyContent: 'center' },
    removeBtn:    { position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
    removeX:      { color: '#fff', fontSize: 10, fontWeight: '700' },
    addBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, gap: 6, marginTop: spacing.xs },
    addPlus:      { fontSize: 18, color: colors.accent, fontWeight: '600' },
    addLabel:     { ...typography.label, color: colors.accent },
});

// ─── Nutrition Card ───────────────────────────────────────────────────────────

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
    wrap:  { flex: 1, minWidth: '45%' },
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
    return (
        <View style={mb.wrap}>
            <View style={mb.bar}>
                <View style={[mb.seg, { width: `${pPct}%` as any, backgroundColor: '#0E6B64' }]} />
                <View style={[mb.seg, { width: `${cPct}%` as any, backgroundColor: '#F59E0B' }]} />
                <View style={[mb.seg, { width: `${fPct}%` as any, backgroundColor: '#EF4444' }]} />
            </View>
            <View style={mb.legend}>
                <Text style={[mb.legendTxt, { color: '#0E6B64' }]}>Protein {pPct}%</Text>
                <Text style={[mb.legendTxt, { color: '#F59E0B' }]}>Carbs {cPct}%</Text>
                <Text style={[mb.legendTxt, { color: '#EF4444' }]}>Fat {fPct}%</Text>
            </View>
        </View>
    );
}

const mb = StyleSheet.create({
    wrap:      { marginTop: spacing.xs, marginBottom: spacing.sm },
    bar:       { flexDirection: 'row', height: 8, borderRadius: radius.pill, backgroundColor: colors.border },
    seg:       { height: '100%' },
    legend:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
    legendTxt: { fontSize: 10, fontWeight: '600' },
});

interface NutritionCardProps {
    calories: string; onCalories: (v: string) => void;
    protein:  string; onProtein:  (v: string) => void;
    carbs:    string; onCarbs:    (v: string) => void;
    fat:      string; onFat:      (v: string) => void;
}

function NutritionCard(props: NutritionCardProps) {
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
                    <Text style={nc.title}>🥗 Nutrition today</Text>
                    <Text style={nc.subtitle}>
                        {hasAny
                            ? [
                                props.calories && `${props.calories} kcal`,
                                props.protein  && `${props.protein}g protein`,
                              ].filter(Boolean).join(' · ')
                            : 'Optional — tap to log calories & macros'}
                    </Text>
                </View>
                <Text style={nc.chevron}>{open ? '▲' : '▼'}</Text>
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

const nc = StyleSheet.create({
    // NOTE: no overflow:'hidden' here — would block touches on child Touchables
    card:     { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.base, ...shadows.card },
    header:   { flexDirection: 'row', alignItems: 'center', padding: spacing.base, gap: spacing.sm },
    title:    { ...typography.label, color: colors.textPrimary, marginBottom: 2 },
    subtitle: { ...typography.caption, color: colors.textSecondary },
    chevron:  { fontSize: 10, color: colors.placeholder },
    body:     { paddingHorizontal: spacing.base, paddingBottom: spacing.base, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
    row:      { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
});

// ─── Today's Workout Card ─────────────────────────────────────────────────────
//
// Completely isolated from check-in state.
// If workout fetch fails, the card gracefully shows nothing.
// Coach-assigned exercise names/targets are displayed as READ-ONLY Text.
// Client enters actual performance in separate input fields.
//
// Enhanced features:
//  - Exercise count + estimated time in header
//  - Start Workout expand/collapse
//  - Previous performance display per exercise (from workout history)
//  - Personal best display per exercise

type WorkoutLogState = {
    [exerciseId: string]: {
        completed:      boolean;
        actual_sets:    string;
        actual_reps:    string;
        actual_weight:  string;
        difficulty:     number;
        notes:          string;
    };
};

type WorkoutCardProps = {
    assignment:    WorkoutAssignment | null;
    savedLog:      WorkoutLog | null;
    logState:      WorkoutLogState;
    onChangeLog:   (exerciseId: string, field: string, value: any) => void;
    onSave:        () => void;
    saveState:     'idle' | 'saving' | 'saved' | 'error';
    saveError:     string | null;
    loading:       boolean;
    workoutHistory: WorkoutHistoryEntry[];
};

// ── Exercise history helpers ──────────────────────────────────────────────────

interface PreviousPerformance {
    date: string;  // YYYY-MM-DD
    sets: Array<{ reps: number; weight?: number }>;
}

interface PersonalBest {
    reps:   number;
    weight: number;
}

function findPreviousPerformance(
    exerciseName: string,
    todayDate:    string,
    history:      WorkoutHistoryEntry[],
): PreviousPerformance | null {
    const nameLower = exerciseName.toLowerCase().trim();

    for (const entry of history) {
        // Skip today's assignment
        if (entry.assignment.date === todayDate) continue;
        if (!entry.log) continue;

        // Find matching exercise by name (case-insensitive)
        const matchingEx = entry.assignment.exercises.find(
            ex => ex.name.toLowerCase().trim() === nameLower
        );
        if (!matchingEx) continue;

        const logEntry = entry.log.exercise_logs.find(
            el => el.exercise_id === matchingEx.id && el.completed
        );
        if (!logEntry) continue;

        // Build sets from the single log entry (actual_sets × actual_reps @ actual_weight)
        const sets: Array<{ reps: number; weight?: number }> = [];
        const numSets = logEntry.actual_sets ?? 1;
        for (let i = 0; i < numSets; i++) {
            sets.push({
                reps:   logEntry.actual_reps ?? 0,
                weight: logEntry.actual_weight,
            });
        }

        return { date: entry.assignment.date, sets };
    }

    return null;
}

function findPersonalBest(
    exerciseName: string,
    history:      WorkoutHistoryEntry[],
): PersonalBest | null {
    const nameLower = exerciseName.toLowerCase().trim();
    let best: PersonalBest | null = null;
    let bestScore = 0;

    for (const entry of history) {
        if (!entry.log) continue;

        const matchingEx = entry.assignment.exercises.find(
            ex => ex.name.toLowerCase().trim() === nameLower
        );
        if (!matchingEx) continue;

        const logEntry = entry.log.exercise_logs.find(
            el => el.exercise_id === matchingEx.id && el.completed
        );
        if (!logEntry || !logEntry.actual_weight || !logEntry.actual_reps) continue;

        const score = logEntry.actual_reps * logEntry.actual_weight;
        if (score > bestScore) {
            bestScore = score;
            best = { reps: logEntry.actual_reps, weight: logEntry.actual_weight };
        }
    }

    return best;
}

function formatHistoryDate(dateStr: string): string {
    try {
        return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-SG', {
            day: 'numeric', month: 'short', year: 'numeric',
        });
    } catch {
        return dateStr;
    }
}

// ── PreviousPerformanceBlock ──────────────────────────────────────────────────

function PreviousPerformanceBlock({ prev }: { prev: PreviousPerformance }) {
    return (
        <View style={wk.prevBlock}>
            <Text style={wk.prevLabel}>📊 Previous: {formatHistoryDate(prev.date)}</Text>
            {prev.sets.map((s, i) => (
                <Text key={i} style={wk.prevSet}>
                    Set {i + 1}: {s.reps} reps{s.weight != null ? ` × ${s.weight} kg` : ''}
                </Text>
            ))}
        </View>
    );
}

// ── PersonalBestBadge ─────────────────────────────────────────────────────────

function PersonalBestBadge({ best }: { best: PersonalBest }) {
    return (
        <View style={wk.pbBadge}>
            <Text style={wk.pbText}>🏆 Best: {best.reps} reps × {best.weight} kg</Text>
        </View>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

function TodayWorkoutCard({
    assignment, savedLog, logState, onChangeLog, onSave, saveState, saveError, loading, workoutHistory
}: WorkoutCardProps) {
    const NAVY  = '#183A4A';
    const GREEN = '#16A34A';
    const [expanded, setExpanded] = useState(false);

    if (loading) {
        return (
            <View style={wk.card}>
                <Text style={wk.sectionLabel}>🏋️ Today's Workout</Text>
                <ActivityIndicator color={colors.accent} size="small" style={{ marginTop: spacing.sm }} />
            </View>
        );
    }

    if (!assignment) {
        return (
            <View style={wk.card}>
                <Text style={wk.sectionLabel}>🏋️ Today's Workout</Text>
                <View style={wk.emptyRow}>
                    <Ionicons name="barbell-outline" size={20} color={colors.placeholder} />
                    <Text style={wk.emptyText}>No workout assigned for today.</Text>
                </View>
            </View>
        );
    }

    const allCompleted = assignment.exercises.every(ex => logState[ex.id]?.completed);
    const exerciseCount = assignment.exercises.length;
    const estMinutes = exerciseCount * 5; // ~5 min per exercise heuristic
    const todayDate = new Date().toISOString().split('T')[0];

    return (
        <View style={wk.card}>
            {/* Header */}
            <View style={wk.headerRow}>
                <View style={{ flex: 1 }}>
                    <Text style={wk.sectionLabel}>🏋️ Today's Workout</Text>
                    <Text style={wk.workoutTitle}>{assignment.title}</Text>
                    <View style={wk.metaRow}>
                        <View style={wk.metaPill}>
                            <Ionicons name="barbell-outline" size={12} color={colors.accent} />
                            <Text style={wk.metaText}>{exerciseCount} exercise{exerciseCount !== 1 ? 's' : ''}</Text>
                        </View>
                        <View style={wk.metaPill}>
                            <Ionicons name="time-outline" size={12} color={colors.accent} />
                            <Text style={wk.metaText}>~{estMinutes} min</Text>
                        </View>
                    </View>
                </View>
                {allCompleted && (
                    <View style={wk.allDoneBadge}>
                        <Text style={wk.allDoneText}>✓ All done</Text>
                    </View>
                )}
            </View>

            {/* Start Workout / Collapse toggle */}
            {!expanded ? (
                <TouchableOpacity
                    style={wk.startBtn}
                    onPress={() => setExpanded(true)}
                    activeOpacity={0.80}
                    accessibilityRole="button"
                    accessibilityLabel="Start workout"
                >
                    <Ionicons name="play" size={16} color="#fff" />
                    <Text style={wk.startBtnLabel}>
                        {savedLog ? 'Continue Workout' : 'Start Workout'}
                    </Text>
                </TouchableOpacity>
            ) : (
                <>
                    {/* Collapse button */}
                    <TouchableOpacity
                        style={wk.collapseBtn}
                        onPress={() => setExpanded(false)}
                        activeOpacity={0.70}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Ionicons name="chevron-up" size={16} color={colors.textSecondary} />
                        <Text style={wk.collapseBtnText}>Collapse</Text>
                    </TouchableOpacity>

                    {/* Exercise list */}
                    {assignment.exercises.map((ex, idx) => {
                        const st = logState[ex.id] ?? {
                            completed: false, actual_sets: '', actual_reps: '', actual_weight: '', difficulty: 5, notes: '',
                        };
                        const prevPerf = findPreviousPerformance(ex.name, todayDate, workoutHistory);
                        const pb = findPersonalBest(ex.name, workoutHistory);

                        return (
                            <View key={ex.id} style={[wk.exCard, st.completed && wk.exCardDone]}>
                                {/* Exercise header: number + name + completed toggle */}
                                <View style={wk.exHeader}>
                                    <View style={wk.exNumBadge}>
                                        <Text style={wk.exNum}>{idx + 1}</Text>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        {/* READ-ONLY: exercise name assigned by coach */}
                                        <Text style={wk.exName}>{ex.name}</Text>
                                        <Text style={wk.exTarget}>
                                            Target: {ex.target_sets} sets × {ex.target_reps} reps
                                            {ex.target_weight ? ` @ ${ex.target_weight} kg` : ''}
                                        </Text>
                                        {ex.notes ? (
                                            <Text style={wk.exCoachNote}>💬 {ex.notes}</Text>
                                        ) : null}
                                    </View>
                                    {/* Completed toggle */}
                                    <TouchableOpacity
                                        style={[wk.checkBtn, st.completed && { backgroundColor: GREEN, borderColor: GREEN }]}
                                        onPress={() => onChangeLog(ex.id, 'completed', !st.completed)}
                                        accessibilityRole="checkbox"
                                        accessibilityState={{ checked: st.completed }}
                                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    >
                                        {st.completed
                                            ? <Ionicons name="checkmark" size={14} color="#fff" />
                                            : <Text style={wk.checkEmpty}> </Text>}
                                    </TouchableOpacity>
                                </View>

                                {/* Previous performance + Personal best */}
                                {prevPerf ? (
                                    <PreviousPerformanceBlock prev={prevPerf} />
                                ) : workoutHistory.length > 0 ? (
                                    <Text style={wk.prevFirstTime}>First time — no previous data</Text>
                                ) : null}
                                {pb ? <PersonalBestBadge best={pb} /> : null}

                                {/* Actual performance inputs */}
                                <View style={wk.inputRow}>
                                    <View style={wk.inputGroup}>
                                        <Text style={wk.inputLabel}>SETS</Text>
                                        <TextInput
                                            style={wk.smallInput}
                                            value={st.actual_sets}
                                            onChangeText={v => onChangeLog(ex.id, 'actual_sets', v)}
                                            keyboardType="numeric"
                                            maxLength={3}
                                            placeholder={String(ex.target_sets)}
                                            placeholderTextColor={colors.placeholder}
                                            accessibilityLabel={`${ex.name} actual sets`}
                                        />
                                    </View>
                                    <Text style={wk.inputSep}>×</Text>
                                    <View style={wk.inputGroup}>
                                        <Text style={wk.inputLabel}>REPS</Text>
                                        <TextInput
                                            style={wk.smallInput}
                                            value={st.actual_reps}
                                            onChangeText={v => onChangeLog(ex.id, 'actual_reps', v)}
                                            keyboardType="numeric"
                                            maxLength={3}
                                            placeholder={String(ex.target_reps)}
                                            placeholderTextColor={colors.placeholder}
                                            accessibilityLabel={`${ex.name} actual reps`}
                                        />
                                    </View>
                                    <View style={wk.inputGroup}>
                                        <Text style={wk.inputLabel}>KG</Text>
                                        <TextInput
                                            style={wk.smallInput}
                                            value={st.actual_weight}
                                            onChangeText={v => onChangeLog(ex.id, 'actual_weight', v)}
                                            keyboardType="decimal-pad"
                                            maxLength={6}
                                            placeholder={ex.target_weight ? String(ex.target_weight) : '—'}
                                            placeholderTextColor={colors.placeholder}
                                            accessibilityLabel={`${ex.name} actual weight`}
                                        />
                                    </View>
                                </View>

                                {/* Optional: difficulty + note */}
                                <View style={wk.diffRow}>
                                    <Text style={wk.inputLabel}>DIFFICULTY (RPE)</Text>
                                    <View style={wk.diffButtons}>
                                        {[1,2,3,4,5,6,7,8,9,10].map(n => (
                                            <TouchableOpacity
                                                key={n}
                                                style={[
                                                    wk.diffBtn,
                                                    st.difficulty === n && { backgroundColor: NAVY, borderColor: NAVY },
                                                ]}
                                                onPress={() => onChangeLog(ex.id, 'difficulty', n)}
                                                hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
                                                accessibilityLabel={`Difficulty ${n}`}
                                            >
                                                <Text style={[
                                                    wk.diffBtnText,
                                                    st.difficulty === n && { color: '#fff' },
                                                ]}>{n}</Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                </View>

                                <TextInput
                                    style={wk.noteInput}
                                    placeholder="Optional note (form tip, how it felt…)"
                                    placeholderTextColor={colors.placeholder}
                                    value={st.notes}
                                    onChangeText={v => onChangeLog(ex.id, 'notes', v)}
                                    multiline
                                    numberOfLines={2}
                                    textAlignVertical="top"
                                    maxLength={300}
                                    accessibilityLabel={`${ex.name} note`}
                                />
                            </View>
                        );
                    })}

                    {/* Save button — completely separate from check-in submit */}
                    {saveState === 'error' && saveError ? (
                        <View style={wk.errorBanner}>
                            <Text style={wk.errorText}>{saveError}</Text>
                        </View>
                    ) : null}
                    {saveState === 'saved' && (
                        <View style={wk.savedBanner}>
                            <Ionicons name="checkmark-circle" size={16} color={GREEN} />
                            <Text style={wk.savedText}>Workout log saved!</Text>
                        </View>
                    )}
                    <TouchableOpacity
                        style={[wk.saveBtn, saveState === 'saving' && wk.saveBtnDisabled]}
                        onPress={onSave}
                        disabled={saveState === 'saving'}
                        activeOpacity={0.80}
                        accessibilityRole="button"
                    >
                        {saveState === 'saving'
                            ? <ActivityIndicator color="#fff" size="small" />
                            : <Text style={wk.saveBtnLabel}>Save Workout Log</Text>
                        }
                    </TouchableOpacity>
                </>
            )}
        </View>
    );
}

const wk = StyleSheet.create({
    card: {
        backgroundColor: colors.surface,
        borderRadius:    radius.card,
        borderWidth:     1,
        borderColor:     colors.border,
        padding:         spacing.base,
        marginBottom:    spacing.base,
        ...shadows.card,
    },
    sectionLabel: {
        fontSize: 11, fontWeight: '700', color: colors.textSecondary,
        letterSpacing: 0.8, marginBottom: spacing.sm,
    },
    headerRow:    { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.md },
    workoutTitle: { ...typography.h3, color: colors.textPrimary },
    allDoneBadge: {
        backgroundColor: '#D1FAE5', borderRadius: radius.pill,
        paddingHorizontal: spacing.sm, paddingVertical: 3,
    },
    allDoneText:  { fontSize: 11, fontWeight: '700', color: '#065F46' },

    emptyRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
    emptyText: { ...typography.body, color: colors.textSecondary },

    // Exercise card
    exCard: {
        backgroundColor: colors.background,
        borderRadius:    radius.md,
        borderWidth:     1,
        borderColor:     colors.border,
        padding:         spacing.md,
        marginBottom:    spacing.sm,
    },
    exCardDone:   { borderColor: '#BBF7D0', backgroundColor: '#F0FDF4' },
    exHeader:     { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.sm },
    exNumBadge:   { width: 22, height: 22, borderRadius: 11, backgroundColor: '#183A4A', alignItems: 'center', justifyContent: 'center' },
    exNum:        { fontSize: 11, fontWeight: '800', color: '#fff' },
    exName:       { ...typography.label, color: colors.textPrimary, marginBottom: 2 },
    exTarget:     { ...typography.caption, color: '#0F766E', fontWeight: '600' },
    exCoachNote:  { ...typography.caption, color: colors.textSecondary, marginTop: 2 },

    checkBtn: {
        width: 26, height: 26, borderRadius: 6,
        borderWidth: 2, borderColor: colors.border,
        backgroundColor: colors.surface,
        alignItems: 'center', justifyContent: 'center',
        alignSelf: 'flex-start',
    },
    checkEmpty: { width: 14, height: 14 },

    inputRow:  { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginBottom: spacing.sm },
    inputGroup:{ flex: 1 },
    inputLabel:{ fontSize: 9, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5, marginBottom: 3 },
    inputSep:  { fontSize: 14, color: colors.textSecondary, marginBottom: 8 },
    smallInput:{
        height: 40,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.md,
        paddingHorizontal: spacing.sm,
        textAlign: 'center',
        fontSize: 15,
        fontWeight: '700',
        color: colors.textPrimary,
    },

    diffRow:    { marginBottom: spacing.sm },
    diffButtons:{ flexDirection: 'row', gap: 3, marginTop: 4 },
    diffBtn: {
        flex: 1, height: 30,
        borderRadius: radius.sm,
        borderWidth: 1.5,
        borderColor: colors.border,
        backgroundColor: colors.background,
        alignItems: 'center', justifyContent: 'center',
    },
    diffBtnText: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },

    noteInput: {
        height: 56,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.md,
        padding: spacing.sm,
        ...typography.caption,
        color: colors.textPrimary,
        marginBottom: spacing.sm,
    },

    errorBanner: { backgroundColor: colors.errorBg, borderWidth: 1, borderColor: colors.errorBorder, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm },
    errorText:   { ...typography.caption, color: colors.errorText },
    savedBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
    savedText:   { ...typography.caption, color: '#16A34A', fontWeight: '600' },

    saveBtn: {
        height: 46,
        backgroundColor: '#0F766E',
        borderRadius:    radius.md,
        alignItems:      'center',
        justifyContent:  'center',
        marginTop:       spacing.xs,
    },
    saveBtnDisabled: { backgroundColor: colors.buttonDisabledBg },
    saveBtnLabel:    { ...typography.label, color: '#fff', fontWeight: '700' },

    // ── New: header meta row ──────────────────────────────────────────────────
    metaRow:  { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    metaPill: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: colors.accentSubtle, borderRadius: radius.pill,
        paddingHorizontal: spacing.sm, paddingVertical: 3,
    },
    metaText: { ...typography.micro, color: colors.accent, fontWeight: '600' },

    // ── New: start / collapse buttons ─────────────────────────────────────────
    startBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
        height: 48, backgroundColor: '#183A4A', borderRadius: radius.md,
        marginTop: spacing.xs,
    },
    startBtnLabel: { ...typography.label, color: '#fff', fontWeight: '700' },
    collapseBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
        paddingVertical: spacing.sm, marginBottom: spacing.xs,
    },
    collapseBtnText: { ...typography.caption, color: colors.textSecondary },

    // ── New: previous performance block ───────────────────────────────────────
    prevBlock: {
        backgroundColor: '#F0F9FF', borderRadius: radius.sm, borderWidth: 1,
        borderColor: '#BAE6FD', padding: spacing.sm, marginBottom: spacing.sm,
    },
    prevLabel: { ...typography.micro, color: '#0369A1', fontWeight: '700', letterSpacing: 0.3, marginBottom: 3 },
    prevSet:   { ...typography.caption, color: '#0C4A6E', marginLeft: spacing.sm },
    prevFirstTime: { ...typography.caption, color: colors.textSecondary, fontStyle: 'italic', marginBottom: spacing.sm },

    // ── New: personal best badge ──────────────────────────────────────────────
    pbBadge: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#FFFBEB', borderRadius: radius.sm, borderWidth: 1,
        borderColor: '#FDE68A', paddingHorizontal: spacing.sm, paddingVertical: 4,
        marginBottom: spacing.sm,
    },
    pbText: { ...typography.micro, color: '#92400E', fontWeight: '700', letterSpacing: 0.3 },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTimeOfDay(): string {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
}

// ─── Inline Rating Picker ─────────────────────────────────────────────────────
//
// Rendered directly in the screen — no separate component file.
// Critical style rules:
//   • height: 40  (explicit — never aspectRatio:1 in a flex row)
//   • minWidth: 0 (allows flex shrink in tight containers)
//   • No overflow:'hidden' on parent View

interface RatingRowProps {
    label:       string;
    question:    string;
    value:       number;
    onChange:    (n: number) => void;
    accentColor: string;
    lowLabel:    string;
    highLabel:   string;
}

function RatingRow({ label, question, value, onChange, accentColor, lowLabel, highLabel }: RatingRowProps) {
    return (
        <View style={r.card}>
            {/* Header: label + live badge */}
            <View style={r.header}>
                <View style={r.headerText}>
                    <Text style={r.label}>{label}</Text>
                    <Text style={r.question}>{question}</Text>
                </View>
                <View style={[r.badge, { borderColor: accentColor }]}>
                    <Text style={[r.badgeValue, { color: accentColor }]}>{value}</Text>
                    <Text style={r.badgeMax}>/10</Text>
                </View>
            </View>

            {/* Button row — explicit height ensures real touch targets */}
            <View style={r.row}>
                {RATINGS.map(n => {
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
                                r.btn,
                                selected && { backgroundColor: accentColor, borderColor: accentColor },
                            ]}
                        >
                            <Text style={[r.btnText, selected && r.btnTextSelected]}>
                                {n}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>

            {/* Axis labels */}
            <View style={r.axis}>
                <Text style={r.axisLabel}>{lowLabel}</Text>
                <Text style={r.axisLabel}>{highLabel}</Text>
            </View>
        </View>
    );
}

const r = StyleSheet.create({
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
    row:        { flexDirection: 'row', gap: 4 },
    btn: {
        flex:            1,
        height:          40,   // ← explicit height, NEVER aspectRatio:1 in a flex row
        minWidth:        0,    // ← allows proper shrink when 10 buttons share a row
        borderRadius:    radius.md,
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

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ClientHomeScreen() {
    // 🔥 DEBUG — remove after confirming new screen loads
    console.log('🔥 NEW CLIENT HOME SCREEN LOADED — clean rebuild active');

    const { user } = useAuth();

    // clientId resolution:
    //   Email/password login → user.clientId
    //   Google OAuth         → user.id (MongoDB _id fallback)
    const clientId = user?.clientId ?? user?.id ?? '';

    console.log('[ClientHomeScreen] mount | clientId:', clientId);

    // ── Core check-in state ────────────────────────────────────────────────────
    const [energy, setEnergy] = useState(5);
    const [hunger, setHunger] = useState(5);
    const [steps,  setSteps]  = useState('');
    const [notes,  setNotes]  = useState('');

    // ── Nutrition state (Phase 1 — manual input) ───────────────────────────────
    const [calories, setCalories] = useState('');
    const [protein,  setProtein]  = useState('');
    const [carbs,    setCarbs]    = useState('');
    const [fat,      setFat]      = useState('');

    // ── Photo state (upload-on-select) ─────────────────────────────────────────
    const [photoUrls,      setPhotoUrls]      = useState<string[]>([]);
    const [uploadingCount, setUploadingCount] = useState(0);

    // ── Submit state ───────────────────────────────────────────────────────────
    const [submitState, setSubmitState] = useState<SubmitState>('idle');
    const [errorMsg,    setErrorMsg]    = useState<string | null>(null);

    // ── Workout state (completely separate from check-in) ──────────────────────
    const [workoutAssignment, setWorkoutAssignment] = useState<WorkoutAssignment | null>(null);
    const [savedWorkoutLog,   setSavedWorkoutLog]   = useState<WorkoutLog | null>(null);
    const [workoutLoading,    setWorkoutLoading]    = useState(true);
    const [workoutLogState,   setWorkoutLogState]   = useState<WorkoutLogState>({});
    const [workoutSaveState,  setWorkoutSaveState]  = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [workoutSaveError,  setWorkoutSaveError]  = useState<string | null>(null);
    const [workoutHistory,    setWorkoutHistory]    = useState<WorkoutHistoryEntry[]>([]);

    // ── Check-in reminder preference & pause state ─────────────────────────────
    // undefined = not yet chosen (show preference card)
    // true = opted in, false = "not now" (both hide the card)
    const [reminderEnabled,  setReminderEnabled]  = useState<boolean | undefined>(undefined);
    const [checkInStatus,    setCheckInStatus]    = useState<'active' | 'paused'>('active');
    const [missedStreak,     setMissedStreak]     = useState(0);
    // Track whether we've fetched prefs so we only show the card once loaded
    const [prefsLoaded,      setPrefsLoaded]      = useState(false);

    // ── Load check-in prefs on mount ───────────────────────────────────────────
    useEffect(() => {
        (async () => {
            try {
                const { getAuthHeaders } = await import('../../services/apiClient');
                const headers = await getAuthHeaders();
                const res = await fetch(`${BASE_URL}/api/clients/me/profile`, { headers });
                if (res.ok) {
                    const data = await res.json();
                    const profile = data.profile ?? data;
                    if (profile.check_in_reminders_enabled !== undefined) setReminderEnabled(profile.check_in_reminders_enabled as boolean);
                    if (profile.check_in_status) setCheckInStatus(profile.check_in_status as 'active' | 'paused');
                    if (profile.missed_checkin_streak != null) setMissedStreak(profile.missed_checkin_streak as number);
                }
            } catch { /* non-fatal — card stays hidden until next load */ }
            finally { setPrefsLoaded(true); }
        })();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleReminderChoice = async (enabled: boolean) => {
        setReminderEnabled(enabled);
        try { await updateCheckInPrefs({ check_in_reminders_enabled: enabled }); } catch { /* non-fatal */ }
    };

    const handleResumeCheckIns = async () => {
        setCheckInStatus('active');
        setMissedStreak(0);
        try { await updateCheckInPrefs({ check_in_status: 'active' }); } catch { /* non-fatal */ }
    };

    // ── Fetch today's workout on mount (non-blocking) ──────────────────────────
    useEffect(() => {
        let mounted = true;
        getTodayWorkout().then(result => {
            if (!mounted) return;
            setWorkoutAssignment(result.assignment);
            setSavedWorkoutLog(result.log);

            // Pre-populate log state from existing saved log
            if (result.assignment && result.log) {
                const initial: WorkoutLogState = {};
                result.assignment.exercises.forEach(ex => {
                    const saved = result.log!.exercise_logs.find(el => el.exercise_id === ex.id);
                    initial[ex.id] = {
                        completed:     saved?.completed     ?? false,
                        actual_sets:   saved?.actual_sets   != null ? String(saved.actual_sets)   : '',
                        actual_reps:   saved?.actual_reps   != null ? String(saved.actual_reps)   : '',
                        actual_weight: saved?.actual_weight != null ? String(saved.actual_weight) : '',
                        difficulty:    saved?.difficulty    ?? 5,
                        notes:         saved?.notes         ?? '',
                    };
                });
                setWorkoutLogState(initial);
            } else if (result.assignment) {
                // Fresh assignment, no log yet — init empty state
                const initial: WorkoutLogState = {};
                result.assignment.exercises.forEach(ex => {
                    initial[ex.id] = {
                        completed: false, actual_sets: '', actual_reps: '',
                        actual_weight: '', difficulty: 5, notes: '',
                    };
                });
                setWorkoutLogState(initial);
            }

            setWorkoutLoading(false);
        });

        // Fetch workout history in parallel (for previous performance + personal bests)
        getWorkoutHistory().then(result => {
            if (!mounted) return;
            setWorkoutHistory(result.entries ?? []);
        });

        return () => { mounted = false; };
    }, []);

    // ── Workout log handlers ───────────────────────────────────────────────────
    const handleWorkoutLogChange = useCallback((
        exerciseId: string, field: string, value: any,
    ) => {
        setWorkoutLogState(prev => ({
            ...prev,
            [exerciseId]: { ...prev[exerciseId], [field]: value },
        }));
        // Reset save state so the button is ready again after editing
        setWorkoutSaveState(s => s === 'saved' ? 'idle' : s);
    }, []);

    const handleSaveWorkoutLog = useCallback(async () => {
        if (!workoutAssignment) return;
        setWorkoutSaveState('saving');
        setWorkoutSaveError(null);

        const exerciseLogs: ExerciseLog[] = workoutAssignment.exercises.map(ex => ({
            exercise_id:    ex.id,
            completed:      workoutLogState[ex.id]?.completed ?? false,
            actual_sets:    workoutLogState[ex.id]?.actual_sets    ? parseInt(workoutLogState[ex.id].actual_sets, 10)    : undefined,
            actual_reps:    workoutLogState[ex.id]?.actual_reps    ? parseInt(workoutLogState[ex.id].actual_reps, 10)    : undefined,
            actual_weight:  workoutLogState[ex.id]?.actual_weight  ? parseFloat(workoutLogState[ex.id].actual_weight)  : undefined,
            difficulty:     workoutLogState[ex.id]?.difficulty,
            notes:          workoutLogState[ex.id]?.notes?.trim() || undefined,
        }));

        try {
            await submitWorkoutLog(workoutAssignment._id, exerciseLogs);
            setWorkoutSaveState('saved');
            console.log('[ClientHome] workout log saved');
        } catch (err: any) {
            setWorkoutSaveState('error');
            setWorkoutSaveError(err.message || 'Failed to save. Please try again.');
            console.error('[ClientHome] workout log save failed:', err.message);
        }
    }, [workoutAssignment, workoutLogState]);

    // ── WorkoutLogState type (used above) ─────────────────────────────────────
    type WorkoutLogState = {
        [exerciseId: string]: {
            completed: boolean;
            actual_sets: string;
            actual_reps: string;
            actual_weight: string;
            difficulty: number;
            notes: string;
        };
    };

    // ── Photo handlers ─────────────────────────────────────────────────────────
    const handleAddPhoto = async (localUri: string) => {
        setUploadingCount(c => c + 1);
        try {
            const relativeUrl = await uploadSingleCheckInPhoto(localUri);
            setPhotoUrls(prev => [...prev, relativeUrl].slice(0, MAX_PHOTOS));
        } catch (err: any) {
            Alert.alert('Upload failed', err.message || 'Could not upload photo. Try again.');
            console.error('[ClientHomeScreen] photo upload failed:', err.message);
        } finally {
            setUploadingCount(c => c - 1);
        }
    };

    const handleRemovePhoto = (url: string) => {
        setPhotoUrls(prev => prev.filter(u => u !== url));
    };

    // ── Reset helper ───────────────────────────────────────────────────────────
    const resetForm = () => {
        setSubmitState('idle');
        setEnergy(5);       setHunger(5);
        setSteps('');       setNotes('');
        setCalories('');    setProtein('');
        setCarbs('');       setFat('');
        setPhotoUrls([]);   setUploadingCount(0);
        setErrorMsg(null);
    };

    // ── Submit ─────────────────────────────────────────────────────────────────
    const handleSubmit = async () => {
        if (!clientId) {
            Alert.alert('Session error', 'Your client ID is missing. Please log out and log in again.');
            console.error('[ClientHomeScreen] missing clientId — user:', JSON.stringify(user));
            return;
        }
        if (uploadingCount > 0) {
            Alert.alert('Please wait', 'Photos are still uploading.');
            return;
        }

        console.log('[ClientHomeScreen] submitting | energy:', energy, '| hunger:', hunger, '| steps:', steps, '| photos:', photoUrls.length);

        setSubmitState('loading');
        setErrorMsg(null);

        const hasNutrition = calories || protein || carbs || fat;
        const nutritionPayload: NutritionData | undefined = hasNutrition ? {
            source:   'manual',
            calories: calories ? parseFloat(calories) : undefined,
            protein:  protein  ? parseFloat(protein)  : undefined,
            carbs:    carbs    ? parseFloat(carbs)     : undefined,
            fat:      fat      ? parseFloat(fat)       : undefined,
        } : undefined;

        const payload = {
            date:    TODAY,
            type:    'MANUAL' as const,
            metrics: {
                energy,
                hunger,
                stepsToday: steps ? parseInt(steps, 10) : undefined,
            },
            nutrition: nutritionPayload,
            notes:     notes.trim() || undefined,
            photos:    photoUrls.length > 0 ? photoUrls : undefined,
        };

        try {
            await submitCheckIn(clientId, payload);
            setSubmitState('success');
        } catch (err: any) {
            setSubmitState('error');
            setErrorMsg(err.message || 'Submission failed. Please try again.');
            console.error('[ClientHomeScreen] submit failed:', err.message);
        }
    };

    // ── Success state ──────────────────────────────────────────────────────────
    if (submitState === 'success') {
        return (
            <View style={s.centered}>
                <View style={s.successIcon}>
                    <Text style={s.successCheck}>✓</Text>
                </View>
                <Text style={s.successHeading}>You're all logged in.</Text>
                <Text style={s.successBody}>
                    Well done, {user?.name?.split(' ')[0] ?? 'you'}.{'\n'}
                    Your coach can see your check-in.
                </Text>
                <Text style={s.successCaption}>Come back tomorrow.</Text>
                <TouchableOpacity style={s.resetBtn} onPress={resetForm}>
                    <Text style={s.resetLabel}>Edit today's check-in</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // ── Main form ──────────────────────────────────────────────────────────────
    const isSubmitting     = submitState === 'loading';
    const hasPhotosInFlight = uploadingCount > 0;

    return (
        <KeyboardAvoidingView
            style={s.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <ScrollView
                contentContainerStyle={s.scroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {/* ── Check-in Reminder Preference Card / Paused Banner ─────── */}
                {prefsLoaded && (() => {
                    // Paused state (streak >= 3 or stored as paused)
                    const isPaused = checkInStatus === 'paused' || missedStreak >= 3;

                    if (isPaused) {
                        return (
                            <View style={ci.pausedCard}>
                                <View style={ci.pausedRow}>
                                    <Text style={ci.pausedIcon}>⏸</Text>
                                    <View style={ci.pausedTextBlock}>
                                        <Text style={ci.pausedTitle}>Your check-in reminders are paused.</Text>
                                        <Text style={ci.pausedSub}>You can still submit a check-in anytime.</Text>
                                    </View>
                                </View>
                                <TouchableOpacity style={ci.resumeBtn} onPress={handleResumeCheckIns}>
                                    <Text style={ci.resumeBtnTxt}>Resume check-ins</Text>
                                </TouchableOpacity>
                            </View>
                        );
                    }

                    // Not-yet-chosen preference card
                    if (reminderEnabled === undefined) {
                        return (
                            <View style={ci.prefCard}>
                                <Text style={ci.prefTitle}>Daily check-in reminders</Text>
                                <Text style={ci.prefQuestion}>Would you like daily check-in reminders?</Text>
                                <Text style={ci.prefSub}>
                                    We'll remind you to submit your progress so your coach can support you better.
                                </Text>
                                <View style={ci.prefBtnRow}>
                                    <TouchableOpacity style={ci.prefBtnYes} onPress={() => handleReminderChoice(true)}>
                                        <Text style={ci.prefBtnYesTxt}>Yes, remind me daily</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={ci.prefBtnNo} onPress={() => handleReminderChoice(false)}>
                                        <Text style={ci.prefBtnNoTxt}>Not now</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        );
                    }

                    // Soft missed-streak banners (only shown when reminder is active)
                    if (reminderEnabled && missedStreak >= 1 && missedStreak < 3) {
                        const bannerCopy =
                            missedStreak === 1
                                ? "You missed today's check-in. Submit it when you're ready so your coach can stay updated."
                                : "You've missed 2 check-ins. A quick update helps your coach adjust your plan.";
                        return (
                            <View style={[ci.missedBanner, missedStreak === 2 && ci.missedBannerStrong]}>
                                <Text style={ci.missedBannerIcon}>{missedStreak === 1 ? '📅' : '⚠️'}</Text>
                                <Text style={ci.missedBannerTxt}>{bannerCopy}</Text>
                            </View>
                        );
                    }

                    return null;
                })()}

                {/* ── Header ────────────────────────────────────────────────── */}
                <View style={s.header}>
                    <Text style={s.eyebrow}>
                        {new Date()
                            .toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long' })
                            .toUpperCase()}
                        {'  ·  DAILY CHECK-IN'}
                    </Text>
                    <Text style={s.greeting}>
                        Good {getTimeOfDay()}, {user?.name?.split(' ')[0] ?? 'there'} 👋
                    </Text>
                    <Text style={s.sub}>Quick check-in — how are you doing today?</Text>
                </View>

                {/* ── Wellbeing ─────────────────────────────────────────────── */}
                <Text style={s.sectionLabel}>Wellbeing</Text>

                <RatingRow
                    label="⚡ Energy"
                    question="How's your energy right now?"
                    value={energy}
                    onChange={setEnergy}
                    accentColor={colors.accent}
                    lowLabel="Drained"
                    highLabel="Energised"
                />

                {/* UI label is "Appetite," but API field remains `hunger` for backward compatibility. */}
                <RatingRow
                    label="🍽 Appetite"
                    question="How hungry or snacky do you feel today?"
                    value={hunger}
                    onChange={setHunger}
                    accentColor={(colors as any).celebrationAccent ?? '#6D28D9'}
                    lowLabel="Low appetite"
                    highLabel="Very hungry / craving"
                />

                {/* ── Activity ──────────────────────────────────────────────── */}
                <Text style={s.sectionLabel}>Activity</Text>

                <View style={s.card}>
                    <Text style={s.cardLabel}>👟 Steps today</Text>
                    <TextInput
                        style={s.input}
                        placeholder="Optional — e.g. 8,500"
                        placeholderTextColor={colors.placeholder}
                        value={steps}
                        onChangeText={setSteps}
                        keyboardType="numeric"
                        maxLength={6}
                    />
                </View>

                <NutritionCard
                    calories={calories} onCalories={setCalories}
                    protein={protein}   onProtein={setProtein}
                    carbs={carbs}       onCarbs={setCarbs}
                    fat={fat}           onFat={setFat}
                />

                {/* ── Workout ─────────────────────────────────────────────────────── */}
                <Text style={s.sectionLabel}>Workout</Text>
                <TodayWorkoutCard
                    assignment={workoutAssignment}
                    savedLog={savedWorkoutLog}
                    logState={workoutLogState}
                    onChangeLog={handleWorkoutLogChange}
                    onSave={handleSaveWorkoutLog}
                    saveState={workoutSaveState}
                    saveError={workoutSaveError}
                    loading={workoutLoading}
                    workoutHistory={workoutHistory}
                />

                {/* ── Extra ─────────────────────────────────────────────────── */}
                <Text style={s.sectionLabel}>Extra</Text>

                <View style={s.card}>
                    <Text style={s.cardLabel}>💬 Note for your coach</Text>
                    <TextInput
                        style={[s.input, s.textArea]}
                        placeholder="Sleep, energy, stress, soreness — anything on your mind."
                        placeholderTextColor={colors.placeholder}
                        value={notes}
                        onChangeText={setNotes}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                    />
                </View>

                <PhotoPicker
                    photoUrls={photoUrls}
                    uploadingCount={uploadingCount}
                    onAdd={handleAddPhoto}
                    onRemove={handleRemovePhoto}
                />

                {/* ── Error ─────────────────────────────────────────────────── */}
                {submitState === 'error' && errorMsg ? (
                    <View style={s.errorBanner}>
                        <Text style={s.errorText}>{errorMsg}</Text>
                    </View>
                ) : null}

                {/* ── Submit ────────────────────────────────────────────────── */}
                <TouchableOpacity
                    style={[s.submitBtn, (isSubmitting || hasPhotosInFlight) && s.submitDisabled]}
                    onPress={handleSubmit}
                    disabled={isSubmitting || hasPhotosInFlight}
                    activeOpacity={0.80}
                    accessibilityRole="button"
                >
                    {isSubmitting ? (
                        <ActivityIndicator color="#FFFFFF" />
                    ) : hasPhotosInFlight ? (
                        <>
                            <ActivityIndicator
                                size="small"
                                color="rgba(255,255,255,0.7)"
                                style={{ marginRight: 8 }}
                            />
                            <Text style={s.submitLabel}>
                                Uploading photo{uploadingCount > 1 ? 's' : ''}…
                            </Text>
                        </>
                    ) : (
                        <Text style={s.submitLabel}>Submit today's check-in</Text>
                    )}
                </TouchableOpacity>

                <Text style={s.submitCaption}>Your coach will review this shortly.</Text>

            </ScrollView>
        </KeyboardAvoidingView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    flex:     { flex: 1, backgroundColor: colors.background },
    scroll:   { flexGrow: 1, paddingHorizontal: spacing.base, paddingTop: spacing.xl, paddingBottom: spacing.section },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background, paddingHorizontal: spacing.xl },

    // ── Header ────────────────────────────────────────────────────────────────
    header:   { marginBottom: spacing.xl },
    eyebrow:  { fontSize: 10, fontWeight: '700', color: colors.textSecondary, letterSpacing: 1.0, marginBottom: spacing.sm },
    greeting: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.xs },
    sub:      { ...typography.body, color: colors.textSecondary },

    // ── Section labels ────────────────────────────────────────────────────────
    sectionLabel: {
        fontSize:      11,
        fontWeight:    '700',
        color:         colors.textSecondary,
        letterSpacing: 0.8,
        marginBottom:  spacing.sm,
        marginTop:     spacing.xs,
        paddingLeft:   2,
    },

    // ── Cards ─────────────────────────────────────────────────────────────────
    // NOTE: no overflow:'hidden' — would clip TouchableOpacity children
    card:      { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, padding: spacing.base, marginBottom: spacing.base, ...shadows.card },
    cardLabel: { ...typography.label, color: colors.textPrimary, marginBottom: 2 },
    cardDesc:  { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },

    // ── Inputs ────────────────────────────────────────────────────────────────
    input:    { height: componentSize.input, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.input, paddingHorizontal: spacing.base, ...typography.body, color: colors.textPrimary, marginTop: spacing.xs },
    textArea: { height: 100, paddingTop: spacing.sm },

    // ── Error ─────────────────────────────────────────────────────────────────
    errorBanner: { backgroundColor: colors.errorBg, borderWidth: 1, borderColor: colors.errorBorder, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.base },
    errorText:   { ...typography.label, color: colors.errorText, textAlign: 'center', fontWeight: '400' },

    // ── Submit ────────────────────────────────────────────────────────────────
    submitBtn: {
        height:          56,
        flexDirection:   'row',
        backgroundColor: colors.buttonPrimaryBg,
        borderRadius:    radius.card,
        alignItems:      'center',
        justifyContent:  'center',
        marginTop:       spacing.xl,
    },
    submitDisabled: { backgroundColor: colors.buttonDisabledBg },
    submitLabel:    { ...typography.bodyLg, color: colors.buttonPrimaryText, fontWeight: '700', letterSpacing: 0.2 },
    submitCaption:  { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.sm },

    // ── Success ───────────────────────────────────────────────────────────────
    successIcon:    { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.successBg, borderWidth: 2, borderColor: colors.successBorder, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.xl },
    successCheck:   { fontSize: 32, color: '#059669' },
    successHeading: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.sm },
    successBody:    { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 24, marginBottom: spacing.xs },
    successCaption: { ...typography.caption, color: colors.placeholder, textAlign: 'center', marginTop: spacing.xs },
    resetBtn:       { paddingVertical: spacing.sm, paddingHorizontal: spacing.xl, marginTop: spacing.xl },
    resetLabel:     { ...typography.label, color: colors.accent, textDecorationLine: 'underline' },
});

// ─── Check-in Preference / Pause Styles ──────────────────────────────────────

const ci = StyleSheet.create({
    // Preference card (not-yet-chosen state)
    prefCard: {
        backgroundColor: '#EFF6FF',
        borderWidth: 1, borderColor: '#BFDBFE',
        borderRadius: 14,
        padding: 16,
        marginBottom: 16,
    },
    prefTitle:    { fontSize: 13, fontWeight: '800', color: '#1E40AF', marginBottom: 4, letterSpacing: 0.4 },
    prefQuestion: { fontSize: 15, fontWeight: '700', color: '#1E3A8A', marginBottom: 6 },
    prefSub:      { fontSize: 13, color: '#3B82F6', lineHeight: 19, marginBottom: 14 },
    prefBtnRow:   { flexDirection: 'row', gap: 10 },
    prefBtnYes: {
        flex: 1, backgroundColor: '#2563EB', borderRadius: 10,
        paddingVertical: 10, alignItems: 'center',
    },
    prefBtnYesTxt: { fontSize: 13, fontWeight: '700', color: '#fff' },
    prefBtnNo: {
        flex: 1, backgroundColor: '#DBEAFE', borderRadius: 10,
        paddingVertical: 10, alignItems: 'center',
    },
    prefBtnNoTxt: { fontSize: 13, fontWeight: '600', color: '#1D4ED8' },

    // Paused banner
    pausedCard: {
        backgroundColor: '#F3F4F6',
        borderWidth: 1, borderColor: '#D1D5DB',
        borderRadius: 14,
        padding: 16,
        marginBottom: 16,
    },
    pausedRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
    pausedIcon:      { fontSize: 22, marginTop: 1 },
    pausedTextBlock: { flex: 1 },
    pausedTitle:     { fontSize: 15, fontWeight: '700', color: '#374151', marginBottom: 3 },
    pausedSub:       { fontSize: 13, color: '#6B7280', lineHeight: 19 },
    resumeBtn: {
        backgroundColor: '#4B5563', borderRadius: 10,
        paddingVertical: 10, alignItems: 'center',
    },
    resumeBtnTxt: { fontSize: 13, fontWeight: '700', color: '#fff' },

    // Missed streak banners (1–2 missed)
    missedBanner: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: '#FEF9C3', borderWidth: 1, borderColor: '#FDE68A',
        borderRadius: 12, padding: 12, marginBottom: 14,
    },
    missedBannerStrong: { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' },
    missedBannerIcon:   { fontSize: 18 },
    missedBannerTxt:    { flex: 1, fontSize: 13, color: '#92400E', lineHeight: 19 },
});
