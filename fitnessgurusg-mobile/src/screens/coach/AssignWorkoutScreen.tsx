/**
 * AssignWorkoutScreen — coach assigns a workout to a specific client.
 *
 * Navigated to from ClientPaymentDashboardScreen with { clientId, clientName }.
 *
 * Features:
 *  - Date picker (defaults to today in SGT)
 *  - Workout title input
 *  - Dynamic exercise list (add / remove)
 *  - Per exercise: name, target sets, reps, optional weight (kg), optional coach note
 *  - Validates before submitting
 *  - Calls POST /api/coach/clients/:clientId/workouts via assignWorkout()
 */

import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TextInput,
    TouchableOpacity,
    ActivityIndicator,
    SafeAreaView,
    KeyboardAvoidingView,
    Platform,
    Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, typography, spacing, radius, shadows } from '../../theme/theme';
import { assignWorkout } from '../../services/apiClient';
import type { CoachStackParamList } from '../../navigation/CoachStackParamList';

type NavProp       = NativeStackNavigationProp<CoachStackParamList, 'AssignWorkout'>;
type RoutePropType = RouteProp<CoachStackParamList, 'AssignWorkout'>;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExerciseInput {
    id:            string;   // local key only (not sent to backend)
    name:          string;
    target_sets:   string;
    target_reps:   string;
    target_weight: string;
    notes:         string;
}

type SaveState = 'idle' | 'saving' | 'saved';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _localId = 0;
function localId() { return `ex-${++_localId}`; }

function todaySGT(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

function emptyExercise(): ExerciseInput {
    return { id: localId(), name: '', target_sets: '3', target_reps: '10', target_weight: '', notes: '' };
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AssignWorkoutScreen() {
    const navigation = useNavigation<NavProp>();
    const route      = useRoute<RoutePropType>();
    const { clientId, clientName } = route.params;

    const [date,       setDate]       = useState(todaySGT());
    const [title,      setTitle]      = useState('');
    const [exercises,  setExercises]  = useState<ExerciseInput[]>([emptyExercise()]);
    const [saveState,  setSaveState]  = useState<SaveState>('idle');
    const [errorMsg,   setErrorMsg]   = useState<string | null>(null);

    // ── Exercise list handlers ────────────────────────────────────────────────

    const addExercise = useCallback(() => {
        setExercises(prev => [...prev, emptyExercise()]);
    }, []);

    const removeExercise = useCallback((id: string) => {
        setExercises(prev => {
            if (prev.length <= 1) {
                Alert.alert('Minimum 1', 'A workout must have at least one exercise.');
                return prev;
            }
            return prev.filter(ex => ex.id !== id);
        });
    }, []);

    const updateExercise = useCallback((id: string, field: keyof ExerciseInput, value: string) => {
        setExercises(prev =>
            prev.map(ex => ex.id === id ? { ...ex, [field]: value } : ex)
        );
        if (errorMsg) setErrorMsg(null);
    }, [errorMsg]);

    // ── Validation ────────────────────────────────────────────────────────────

    function validate(): string | null {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Please enter a valid date (YYYY-MM-DD).';
        if (!title.trim()) return 'Workout title is required.';
        for (let i = 0; i < exercises.length; i++) {
            const ex = exercises[i];
            const n  = i + 1;
            if (!ex.name.trim()) return `Exercise ${n}: name is required.`;
            const sets = parseInt(ex.target_sets, 10);
            const reps = parseInt(ex.target_reps, 10);
            if (isNaN(sets) || sets < 1) return `Exercise ${n}: target sets must be ≥ 1.`;
            if (isNaN(reps) || reps < 1) return `Exercise ${n}: target reps must be ≥ 1.`;
            if (ex.target_weight) {
                const w = parseFloat(ex.target_weight);
                if (isNaN(w) || w < 0) return `Exercise ${n}: weight must be a positive number.`;
            }
        }
        return null;
    }

    // ── Submit ────────────────────────────────────────────────────────────────

    const handleSave = useCallback(async () => {
        const validationError = validate();
        if (validationError) {
            setErrorMsg(validationError);
            return;
        }
        setErrorMsg(null);
        setSaveState('saving');

        try {
            await assignWorkout(clientId, {
                date,
                title: title.trim(),
                exercises: exercises.map(ex => ({
                    name:          ex.name.trim(),
                    target_sets:   parseInt(ex.target_sets, 10),
                    target_reps:   parseInt(ex.target_reps, 10),
                    target_weight: ex.target_weight ? parseFloat(ex.target_weight) : undefined,
                    notes:         ex.notes.trim() || undefined,
                })),
            });

            setSaveState('saved');
            Alert.alert(
                '✅ Workout Assigned',
                `${title} has been assigned to ${clientName} for ${date}.`,
                [{ text: 'Done', onPress: () => navigation.goBack() }],
            );
        } catch (err: any) {
            setSaveState('idle');
            setErrorMsg(err.message || 'Failed to assign workout. Please try again.');
        }
    }, [clientId, date, title, exercises, clientName, navigation]);

    // ── Render ────────────────────────────────────────────────────────────────

    const saving = saveState === 'saving';

    return (
        <SafeAreaView style={s.container}>
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <ScrollView
                    contentContainerStyle={s.scroll}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    {/* Header */}
                    <View style={s.headerRow}>
                        <View>
                            <Text style={s.clientLabel}>CLIENT</Text>
                            <Text style={s.clientName}>{clientName}</Text>
                        </View>
                    </View>

                    {/* Date */}
                    <Text style={s.fieldLabel}>DATE (YYYY-MM-DD)</Text>
                    <TextInput
                        style={s.input}
                        value={date}
                        onChangeText={setDate}
                        placeholder="2026-06-20"
                        placeholderTextColor={colors.placeholder}
                        maxLength={10}
                        autoCapitalize="none"
                        accessibilityLabel="Workout date"
                    />

                    {/* Title */}
                    <Text style={s.fieldLabel}>WORKOUT TITLE</Text>
                    <TextInput
                        style={s.input}
                        value={title}
                        onChangeText={t => { setTitle(t); if (errorMsg) setErrorMsg(null); }}
                        placeholder="e.g. Lower Body Strength"
                        placeholderTextColor={colors.placeholder}
                        maxLength={80}
                        accessibilityLabel="Workout title"
                    />

                    {/* Exercises */}
                    <Text style={s.sectionHeader}>EXERCISES</Text>

                    {exercises.map((ex, idx) => (
                        <View key={ex.id} style={s.exCard}>
                            {/* Exercise header */}
                            <View style={s.exTitleRow}>
                                <View style={s.exNumBadge}>
                                    <Text style={s.exNum}>{idx + 1}</Text>
                                </View>
                                <Text style={s.exCardLabel}>Exercise {idx + 1}</Text>
                                <TouchableOpacity
                                    onPress={() => removeExercise(ex.id)}
                                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                    accessibilityLabel={`Remove exercise ${idx + 1}`}
                                >
                                    <Ionicons name="trash-outline" size={18} color={colors.errorText} />
                                </TouchableOpacity>
                            </View>

                            {/* Exercise name */}
                            <Text style={s.inputLabel}>NAME</Text>
                            <TextInput
                                style={s.input}
                                value={ex.name}
                                onChangeText={v => updateExercise(ex.id, 'name', v)}
                                placeholder="e.g. Back Squat"
                                placeholderTextColor={colors.placeholder}
                                maxLength={60}
                                accessibilityLabel={`Exercise ${idx + 1} name`}
                            />

                            {/* Sets / Reps / Weight */}
                            <View style={s.metaRow}>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.inputLabel}>SETS</Text>
                                    <TextInput
                                        style={[s.input, s.metaInput]}
                                        value={ex.target_sets}
                                        onChangeText={v => updateExercise(ex.id, 'target_sets', v)}
                                        keyboardType="numeric"
                                        maxLength={3}
                                        accessibilityLabel={`Exercise ${idx + 1} target sets`}
                                    />
                                </View>
                                <Text style={s.metaSep}>×</Text>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.inputLabel}>REPS</Text>
                                    <TextInput
                                        style={[s.input, s.metaInput]}
                                        value={ex.target_reps}
                                        onChangeText={v => updateExercise(ex.id, 'target_reps', v)}
                                        keyboardType="numeric"
                                        maxLength={3}
                                        accessibilityLabel={`Exercise ${idx + 1} target reps`}
                                    />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.inputLabel}>KG (OPT.)</Text>
                                    <TextInput
                                        style={[s.input, s.metaInput]}
                                        value={ex.target_weight}
                                        onChangeText={v => updateExercise(ex.id, 'target_weight', v)}
                                        keyboardType="decimal-pad"
                                        maxLength={6}
                                        placeholder="—"
                                        placeholderTextColor={colors.placeholder}
                                        accessibilityLabel={`Exercise ${idx + 1} target weight kg`}
                                    />
                                </View>
                            </View>

                            {/* Coach note */}
                            <Text style={s.inputLabel}>COACH NOTE (OPTIONAL)</Text>
                            <TextInput
                                style={[s.input, s.noteInput]}
                                value={ex.notes}
                                onChangeText={v => updateExercise(ex.id, 'notes', v)}
                                placeholder="Form tip, tempo, etc."
                                placeholderTextColor={colors.placeholder}
                                multiline
                                numberOfLines={2}
                                textAlignVertical="top"
                                maxLength={200}
                                accessibilityLabel={`Exercise ${idx + 1} coach note`}
                            />
                        </View>
                    ))}

                    {/* Add exercise button */}
                    <TouchableOpacity
                        style={s.addExBtn}
                        onPress={addExercise}
                        activeOpacity={0.75}
                        accessibilityRole="button"
                    >
                        <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
                        <Text style={s.addExLabel}>Add Exercise</Text>
                    </TouchableOpacity>

                    {/* Error */}
                    {errorMsg ? (
                        <View style={s.errorBanner}>
                            <Ionicons name="alert-circle-outline" size={16} color={colors.errorText} />
                            <Text style={s.errorText}>{errorMsg}</Text>
                        </View>
                    ) : null}

                    {/* Save */}
                    <TouchableOpacity
                        style={[s.saveBtn, saving && s.saveBtnDisabled]}
                        onPress={handleSave}
                        disabled={saving}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                    >
                        {saving
                            ? <ActivityIndicator color="#fff" size="small" />
                            : (
                                <>
                                    <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                                    <Text style={s.saveBtnLabel}>Assign Workout</Text>
                                </>
                            )
                        }
                    </TouchableOpacity>

                    <View style={{ height: spacing.xxl }} />
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const NAVY  = '#183A4A';
const TEAL  = '#0F766E';

const s = StyleSheet.create({
    container:  { flex: 1, backgroundColor: colors.background },
    scroll:     { padding: spacing.md, paddingBottom: spacing.xxl },

    headerRow:  { marginBottom: spacing.lg },
    clientLabel:{ fontSize: 10, fontWeight: '700', color: colors.textSecondary, letterSpacing: 1, marginBottom: 2 },
    clientName: { ...typography.h2, color: colors.textPrimary },

    fieldLabel: { fontSize: 10, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.8, marginBottom: spacing.xs },
    input: {
        height:              48,
        backgroundColor:     colors.surface,
        borderWidth:         1,
        borderColor:         colors.border,
        borderRadius:        radius.md,
        paddingHorizontal:   spacing.md,
        marginBottom:        spacing.md,
        ...typography.body,
        color:               colors.textPrimary,
    },

    sectionHeader: {
        fontSize: 11, fontWeight: '800', color: NAVY,
        letterSpacing: 1.2,
        marginTop: spacing.sm, marginBottom: spacing.sm,
    },

    // Exercise card
    exCard: {
        backgroundColor: colors.surface,
        borderRadius:    radius.card,
        borderWidth:     1,
        borderColor:     colors.border,
        padding:         spacing.md,
        marginBottom:    spacing.md,
        ...shadows.card,
    },
    exTitleRow:   { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
    exNumBadge:   { width: 24, height: 24, borderRadius: 12, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
    exNum:        { fontSize: 12, fontWeight: '800', color: '#fff' },
    exCardLabel:  { flex: 1, ...typography.label, color: colors.textPrimary },

    inputLabel: { fontSize: 9, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5, marginBottom: 3 },

    metaRow:  { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' },
    metaSep:  { fontSize: 16, color: colors.textSecondary, marginBottom: 16, alignSelf: 'flex-end' },
    metaInput:{ textAlign: 'center' },

    noteInput: { height: 60, paddingTop: spacing.sm },

    // Add exercise
    addExBtn: {
        flexDirection:   'row',
        alignItems:      'center',
        justifyContent:  'center',
        gap:             spacing.xs,
        borderWidth:     1.5,
        borderColor:     colors.accent,
        borderStyle:     'dashed',
        borderRadius:    radius.md,
        paddingVertical: spacing.sm,
        marginBottom:    spacing.md,
    },
    addExLabel: { ...typography.label, color: colors.accent },

    // Error
    errorBanner: {
        flexDirection:   'row',
        alignItems:      'center',
        gap:             spacing.xs,
        backgroundColor: colors.errorBg,
        borderWidth:     1,
        borderColor:     colors.errorBorder,
        borderRadius:    radius.md,
        padding:         spacing.sm,
        marginBottom:    spacing.md,
    },
    errorText: { ...typography.caption, color: colors.errorText, flex: 1 },

    // Save button
    saveBtn: {
        height:          52,
        flexDirection:   'row',
        alignItems:      'center',
        justifyContent:  'center',
        gap:             spacing.sm,
        backgroundColor: TEAL,
        borderRadius:    radius.card,
        marginBottom:    spacing.md,
    },
    saveBtnDisabled: { backgroundColor: colors.buttonDisabledBg },
    saveBtnLabel:    { ...typography.label, color: '#fff', fontWeight: '700' },
});
