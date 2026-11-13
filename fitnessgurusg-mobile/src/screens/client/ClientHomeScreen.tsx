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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth }                           from '../../context/AuthContext';
import { submitCheckIn, uploadSingleCheckInPhoto, getTodayWorkout, submitWorkoutLog, updateCheckInPrefs, getWorkoutHistory, getImageRequestHeaders } from '../../services/apiClient';
import { BASE_URL }                          from '../../config/api';
import { NutritionData, WorkoutAssignment, WorkoutLog, ExerciseLog, WorkoutHistoryEntry } from '../../types';
import { colors, spacing, radius, typography, componentSize, shadows } from '../../theme/theme';
import RatingRow from '../../components/RatingRow';
import NutritionCard from '../../components/NutritionCard';
import Button from '../../components/Button';

// ─── Constants ───────────────────────────────────────────────────────────────

const TODAY      = new Date().toISOString().split('T')[0];
const MAX_PHOTOS = 3;

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

// ─── Photo Picker ─────────────────────────────────────────────────────────────
//
// Upload-on-select: photo uploads immediately when picked.
// Thumbnails show from server URL. Submit sends already-uploaded URLs.

interface PhotoPickerProps {
    photoUrls:      string[];
    uploadingCount: number;
    imageHeaders?:  { Authorization: string };
    onAdd:          (localUri: string) => void;
    onRemove:       (url: string) => void;
}

function PhotoPicker({ photoUrls, uploadingCount, imageHeaders, onAdd, onRemove }: PhotoPickerProps) {
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
            <View style={s.cardLabelRow}>
                <Ionicons name="camera-outline" size={16} color={colors.accent} />
                <Text style={s.cardLabel}>Progress Photos</Text>
            </View>
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
                            <Image
                                source={{ uri: `${BASE_URL}${url}`, headers: imageHeaders }}
                                style={ph.thumbImg}
                            />
                            <TouchableOpacity
                                style={ph.removeBtn}
                                onPress={() => onRemove(url)}
                                hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                                accessibilityRole="button"
                                accessibilityLabel="Remove photo"
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
    removeBtn:    { position: 'absolute', top: 4, right: 4, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
    removeX:      { color: '#fff', fontSize: 10, fontWeight: '700' },
    addBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, gap: 6, marginTop: spacing.xs },
    addPlus:      { fontSize: 18, color: colors.accent, fontWeight: '600' },
    addLabel:     { ...typography.label, color: colors.accent },
});

// NutritionCard, NutritionField, MacroBar → extracted to ../../components/NutritionCard.tsx

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

// RatingRow → extracted to ../../components/RatingRow.tsx

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ClientHomeScreen() {
    // 🔥 DEBUG — remove after confirming new screen loads
    console.log('🔥 NEW CLIENT HOME SCREEN LOADED — clean rebuild active');

    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    // clientId resolution:
    //   Email/password login → user.clientId
    //   Google OAuth         → user.id (MongoDB _id fallback)
    const clientId = user?.clientId ?? user?.id ?? '';

    console.log('[ClientHomeScreen] mount | clientId:', clientId);

    // ── Core check-in state ────────────────────────────────────────────────────
    const [energy, setEnergy] = useState(5);
    const [hunger, setHunger] = useState(5);
    const [openRating, setOpenRating] = useState<'energy' | 'appetite' | null>(null);
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
    const [imageHeaders,   setImageHeaders]   = useState<{ Authorization: string } | undefined>(undefined);

    useEffect(() => {
        let alive = true;
        getImageRequestHeaders().then(headers => {
            if (alive) setImageHeaders(headers);
        });
        return () => { alive = false; };
    }, []);

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
        const exerciseCount = workoutAssignment?.exercises?.length ?? 0;
        return (
            <View style={s.flex}>
                <ScrollView
                    contentContainerStyle={[s.successScroll, { paddingTop: insets.top + spacing.lg }]}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={s.successCard}>
                        <View style={s.successIcon}>
                            <Ionicons name="checkmark" size={32} color={colors.textOnPrimary} />
                        </View>
                        <Text style={s.successHeading}>Check-in saved.</Text>
                        <Text style={s.successBody}>
                            Come back tomorrow. Your coach will review it shortly.
                        </Text>
                        <TouchableOpacity style={s.resetBtn} onPress={resetForm} activeOpacity={0.75}>
                            <Text style={s.resetLabel}>Edit today's check-in</Text>
                        </TouchableOpacity>
                    </View>
                    {workoutAssignment ? (
                        <View style={s.successWorkout}>
                            <View style={s.successWorkoutIcon}>
                                <Ionicons name="barbell-outline" size={18} color={colors.accent} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={s.successWorkoutTitle}>{workoutAssignment.title}</Text>
                                <Text style={s.successWorkoutSub}>
                                    {exerciseCount} exercise{exerciseCount === 1 ? '' : 's'} · set by your coach
                                </Text>
                            </View>
                        </View>
                    ) : null}
                </ScrollView>
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
                <View style={[s.hero, { paddingTop: insets.top + spacing.sm }]}>
                    <Text style={s.eyebrow}>
                        {new Date()
                            .toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' })
                            .toUpperCase()}
                        {'  ·  CHECK-IN'}
                    </Text>
                    <Text style={s.greeting}>
                        Good {getTimeOfDay()}, {user?.name?.split(' ')[0] ?? 'there'}
                    </Text>
                    <Text style={s.sub}>
                        {missedStreak === 0
                            ? "You're on track. Quick check-in below."
                            : 'Quick check-in — how are you doing today?'}
                    </Text>
                </View>

                <View style={s.sheet}>
                {/* ── Check-in Reminder Preference Card / Paused Banner ─────── */}
                {prefsLoaded && (() => {
                    // Paused state (streak >= 3 or stored as paused)
                    const isPaused = checkInStatus === 'paused' || missedStreak >= 3;

                    if (isPaused) {
                        return (
                            <View style={ci.pausedCard}>
                                <View style={ci.pausedRow}>
                                    <Ionicons name="pause-circle-outline" size={22} color={colors.textSecondary} />
                                    <View style={ci.pausedTextBlock}>
                                        <Text style={ci.pausedTitle}>Your check-in reminders are paused.</Text>
                                        <Text style={ci.pausedSub}>You can still submit a check-in anytime.</Text>
                                    </View>
                                </View>
                                <Button
                                    label="Resume check-ins"
                                    onPress={handleResumeCheckIns}
                                    fullWidth
                                />
                            </View>
                        );
                    }

                    // Not-yet-chosen preference card
                    if (reminderEnabled === undefined) {
                        return (
                            <View style={ci.prefCard}>
                                <View style={ci.prefTop}>
                                    <View style={ci.prefIcon}>
                                        <Ionicons name="notifications-outline" size={18} color={colors.accent} />
                                    </View>
                                    <View style={ci.prefText}>
                                        <Text style={ci.prefQuestion}>Daily check-in reminders?</Text>
                                        <Text style={ci.prefSub}>A gentle nudge so your coach can support you.</Text>
                                    </View>
                                </View>
                                <View style={ci.prefBtnRow}>
                                    <Button
                                        label="Yes, remind me"
                                        onPress={() => handleReminderChoice(true)}
                                        style={ci.prefBtn}
                                    />
                                    <Button
                                        label="Not now"
                                        variant="secondary"
                                        onPress={() => handleReminderChoice(false)}
                                        style={ci.prefBtn}
                                    />
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
                                <Ionicons name="calendar-outline" size={18} color={colors.amberText} />
                                <Text style={ci.missedBannerTxt}>{bannerCopy}</Text>
                            </View>
                        );
                    }

                    return null;
                })()}

                <Text style={s.sectionLabel}>Today so far</Text>
                <View style={s.miniRow}>
                    <TouchableOpacity
                        style={[s.mini, openRating === 'energy' && s.miniOn]}
                        onPress={() => setOpenRating(current => current === 'energy' ? null : 'energy')}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: openRating === 'energy' }}
                        accessibilityLabel={`Rate energy, currently ${energy} of 10, double tap to ${openRating === 'energy' ? 'collapse' : 'expand'}`}
                    >
                        <Ionicons name="flash-outline" size={16} color={colors.accent} />
                        <Text style={s.miniLabel}>Energy</Text>
                        <Text style={s.miniValue}>{energy}<Text style={s.miniUnit}>/10</Text></Text>
                        <Ionicons
                            name={openRating === 'energy' ? 'chevron-up' : 'chevron-down'}
                            size={14}
                            color={colors.accent}
                            style={s.miniChevron}
                        />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[s.mini, openRating === 'appetite' && s.miniOn]}
                        onPress={() => setOpenRating(current => current === 'appetite' ? null : 'appetite')}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: openRating === 'appetite' }}
                        accessibilityLabel={`Rate appetite, currently ${hunger} of 10, double tap to ${openRating === 'appetite' ? 'collapse' : 'expand'}`}
                    >
                        <Ionicons name="restaurant-outline" size={16} color={colors.accent} />
                        <Text style={s.miniLabel}>Appetite</Text>
                        <Text style={s.miniValue}>{hunger}<Text style={s.miniUnit}>/10</Text></Text>
                        <Ionicons
                            name={openRating === 'appetite' ? 'chevron-up' : 'chevron-down'}
                            size={14}
                            color={colors.accent}
                            style={s.miniChevron}
                        />
                    </TouchableOpacity>
                    <View style={s.mini}>
                        <Ionicons name="footsteps-outline" size={16} color={colors.accent} />
                        <Text style={s.miniLabel}>Steps</Text>
                        <Text style={steps.trim() ? s.miniValue : s.miniAdd}>
                            {steps.trim() ? steps : '+ Add'}
                        </Text>
                    </View>
                </View>

                {openRating === 'energy' && (
                <RatingRow
                    label="Energy"
                    question="How's your energy right now?"
                    value={energy}
                    onChange={setEnergy}
                    accentColor={colors.accent}
                    lowLabel="Drained"
                    highLabel="Energised"
                />
                )}

                {/* UI label is "Appetite," but API field remains `hunger` for backward compatibility. */}
                {openRating === 'appetite' && (
                <RatingRow
                    label="Appetite"
                    question="How hungry or snacky do you feel today?"
                    value={hunger}
                    onChange={setHunger}
                    accentColor={colors.badgeSuccessText}
                    lowLabel="Not hungry"
                    highLabel="Very hungry"
                />
                )}

                {/* ── Activity ──────────────────────────────────────────────── */}
                <View style={s.sectionRow}>
                    <View style={s.sectionAccent} />
                    <Ionicons name="fitness-outline" size={15} color={colors.textSecondary} />
                    <Text style={s.sectionLabel}>Activity</Text>
                </View>

                <View style={s.card}>
                    <View style={s.cardLabelRow}>
                        <Ionicons name="footsteps-outline" size={16} color={colors.accent} />
                        <Text style={s.cardLabel}>Steps today</Text>
                    </View>
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
                <View style={s.sectionRow}>
                    <View style={s.sectionAccent} />
                    <Ionicons name="barbell-outline" size={15} color={colors.textSecondary} />
                    <Text style={s.sectionLabel}>Workout</Text>
                </View>
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
                <View style={s.sectionRow}>
                    <View style={s.sectionAccent} />
                    <Ionicons name="chatbubble-outline" size={15} color={colors.textSecondary} />
                    <Text style={s.sectionLabel}>Notes & Photos</Text>
                </View>

                <View style={s.card}>
                    <View style={s.cardLabelRow}>
                        <Ionicons name="chatbubble-outline" size={16} color={colors.accent} />
                        <Text style={s.cardLabel}>Note for your coach</Text>
                    </View>
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
                    imageHeaders={imageHeaders}
                    onAdd={handleAddPhoto}
                    onRemove={handleRemovePhoto}
                />

                {/* Bottom spacer — makes room for sticky submit bar */}
                <View style={{ height: 160 }} />
                </View>

            </ScrollView>

            {/* ── Sticky Submit Bar ────────────────────────────────────── */}
            <View style={s.stickyBar}>
                {submitState === 'error' && errorMsg ? (
                    <View style={s.errorBanner}>
                        <Text style={s.errorText}>{errorMsg}</Text>
                    </View>
                ) : null}

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
            </View>
        </KeyboardAvoidingView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    flex:     { flex: 1, backgroundColor: colors.background },
    scroll:   { flexGrow: 1, paddingBottom: spacing.section },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background, paddingHorizontal: spacing.xl },

    hero: {
        backgroundColor: colors.primary,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.xxl + spacing.sm,
    },
    sheet: {
        marginTop: -spacing.xl,
        paddingHorizontal: spacing.base,
    },
    eyebrow:  { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.7)', letterSpacing: 0.7, marginBottom: spacing.sm },
    greeting: { ...typography.h1, color: colors.textOnPrimary, marginBottom: spacing.xs },
    sub:      { ...typography.body, color: 'rgba(255,255,255,0.78)' },

    miniRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    mini: {
        flex: 1,
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        padding: spacing.md,
        borderWidth: 1.5,
        borderColor: 'transparent',
        ...shadows.card,
    },
    miniOn: { borderColor: colors.accent },
    miniChevron: { position: 'absolute', top: 10, right: 10 },
    miniLabel: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },
    miniValue: { ...typography.h3, color: colors.textPrimary, marginTop: 2 },
    miniUnit: { fontSize: 11, fontWeight: '500', color: colors.textTertiary },
    miniAdd: { ...typography.label, color: colors.accent, marginTop: 4 },

    // ── Section labels ────────────────────────────────────────────────────────
    // ── Section rows ──────────────────────────────────────────────────────────
    sectionRow: {
        flexDirection:  'row',
        alignItems:     'center',
        gap:            spacing.sm,
        marginBottom:   spacing.md,
        marginTop:      spacing.base,
    },
    sectionAccent: {
        width:          3,
        height:         16,
        borderRadius:   2,
        backgroundColor: colors.accent,
    },
    sectionLabel: {
        fontSize:      13,
        fontWeight:    '700',
        color:         colors.textSecondary,
        letterSpacing: 0.5,
    },

    // ── Cards ─────────────────────────────────────────────────────────────────
    // NOTE: no overflow:'hidden' — would clip TouchableOpacity children
    card:      { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, padding: spacing.base, marginBottom: spacing.base, ...shadows.card },
    cardLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
    cardLabel: { ...typography.label, color: colors.textPrimary },
    cardDesc:  { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },

    // ── Inputs ────────────────────────────────────────────────────────────────
    input:    { height: componentSize.input, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.input, paddingHorizontal: spacing.base, ...typography.body, color: colors.textPrimary, marginTop: spacing.xs },
    textArea: { height: 100, paddingTop: spacing.sm },

    // ── Error ─────────────────────────────────────────────────────────────────
    errorBanner: { backgroundColor: colors.errorBg, borderWidth: 1, borderColor: colors.errorBorder, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
    errorText:   { ...typography.label, color: colors.errorText, textAlign: 'center', fontWeight: '400' },

    // ── Sticky Submit Bar ──────────────────────────────────────────────────────
    stickyBar: {
        position:          'absolute' as const,
        bottom:            0,
        left:              0,
        right:             0,
        backgroundColor:   colors.surface,
        borderTopWidth:    1,
        borderTopColor:    colors.border,
        paddingHorizontal: spacing.base,
        paddingTop:        spacing.md,
        paddingBottom:     spacing.xxl,
        ...shadows.cardElevated,
    },
    submitBtn: {
        height:          56,
        flexDirection:   'row' as const,
        backgroundColor: colors.buttonPrimaryBg,
        borderRadius:    radius.card,
        alignItems:      'center' as const,
        justifyContent:  'center' as const,
    },
    submitDisabled: { backgroundColor: colors.buttonDisabledBg },
    submitLabel:    { ...typography.bodyLg, color: colors.buttonPrimaryText, fontWeight: '700', letterSpacing: 0.2 },
    submitCaption:  { ...typography.caption, color: colors.textSecondary, textAlign: 'center' as const, marginTop: spacing.sm },

    // ── Success ───────────────────────────────────────────────────────────────
    successScroll: { paddingHorizontal: spacing.base, paddingBottom: spacing.section },
    successCard: {
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        paddingVertical: spacing.xl,
        paddingHorizontal: spacing.base,
        alignItems: 'center',
        marginBottom: spacing.md,
        ...shadows.card,
    },
    successIcon:    { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md },
    successHeading: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.sm },
    successBody:    { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
    resetBtn:       { marginTop: spacing.base, paddingVertical: spacing.sm, paddingHorizontal: spacing.base },
    resetLabel:     { ...typography.label, color: colors.accent },
    successWorkout: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        padding: spacing.base,
        ...shadows.card,
    },
    successWorkoutIcon: {
        width: 36, height: 36, borderRadius: 10,
        backgroundColor: colors.accentSubtle,
        alignItems: 'center', justifyContent: 'center',
    },
    successWorkoutTitle: { ...typography.label, color: colors.textPrimary },
    successWorkoutSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
});

// ─── Check-in Preference / Pause Styles ──────────────────────────────────────

const ci = StyleSheet.create({
    // Preference card (not-yet-chosen state). Navy and teal, not a blue banner.
    prefCard: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.card,
        padding: spacing.base,
        marginBottom: spacing.base,
        ...shadows.card,
    },
    prefTop:      { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
    prefIcon:     { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.accentSubtle, alignItems: 'center', justifyContent: 'center' },
    prefText:     { flex: 1 },
    prefQuestion: { ...typography.label, color: colors.textPrimary },
    prefSub:      { ...typography.caption, color: colors.textSecondary, lineHeight: 18, marginTop: 2 },
    prefBtnRow:   { flexDirection: 'row', gap: spacing.sm },
    prefBtn:      { flex: 1, alignSelf: 'stretch', minHeight: 40, paddingHorizontal: spacing.sm },

    // Paused banner
    pausedCard: {
        backgroundColor: colors.surfaceMuted,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.card,
        padding: spacing.base,
        marginBottom: spacing.base,
    },
    pausedRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.base },
    pausedTextBlock: { flex: 1 },
    pausedTitle:     { ...typography.label, color: colors.textPrimary, marginBottom: 3 },
    pausedSub:       { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },

    // Missed streak banners (1–2 missed). Amber text, no warning triangle.
    missedBanner: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        backgroundColor: colors.badgeWarningBg, borderWidth: 1, borderColor: colors.amberBorder,
        borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.base,
    },
    missedBannerStrong: { backgroundColor: colors.amberBg },
    missedBannerTxt:    { flex: 1, ...typography.caption, color: colors.badgeWarningText, lineHeight: 18 },
});
