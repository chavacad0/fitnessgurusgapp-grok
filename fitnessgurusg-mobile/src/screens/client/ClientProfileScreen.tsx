import React, { useCallback, useEffect, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Alert,
    ScrollView,
    TextInput,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { colors, spacing, radius, typography, shadows } from '../../theme/theme';
import {
    getClientProfile,
    updateClientProfile,
    ClientBodyProfile,
} from '../../services/apiClient';

/**
 * ClientProfileScreen
 *
 * Sections:
 *  1. Account — name + email from AuthContext (no extra call)
 *  2. Body Profile — height, weight, goal, injuries, experience
 *     Loads from GET /api/clients/me/profile on mount.
 *     Edit → Cancel / Save via PATCH /api/clients/me/profile.
 *  3. App info row
 *  4. Sign out
 */

// ─── Fitness goal options ────────────────────────────────────────────────────

const FITNESS_GOAL_OPTIONS: { label: string; value: string }[] = [
    { label: 'Fat Loss',     value: 'Fat Loss'     },
    { label: 'Strength',     value: 'Strength'     },
    { label: 'Muscle Gain',  value: 'Muscle Gain'  },
];

// ─── Experience options ───────────────────────────────────────────────────────

const EXPERIENCE_OPTIONS: { label: string; value: string }[] = [
    { label: 'Beginner',     value: 'beginner'     },
    { label: 'Intermediate', value: 'intermediate' },
    { label: 'Advanced',     value: 'advanced'     },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function ClientProfileScreen() {
    const { user, logout, updateUser } = useAuth();

    // ── Profile state ─────────────────────────────────────────────────────────
    const [profile,  setProfile]  = useState<ClientBodyProfile | null>(null);
    const [loading,  setLoading]  = useState(true);
    const [editing,  setEditing]  = useState(false);
    const [saving,   setSaving]   = useState(false);

    // ── Name-edit state (independent from body-profile editing) ───────────────
    const [nameEditing, setNameEditing] = useState(false);
    const [nameInput,   setNameInput]   = useState('');
    const [nameSaving,  setNameSaving]  = useState(false);

    // ── Body-profile edit buffer ──────────────────────────────────────────────
    const [heightStr,    setHeightStr]    = useState('');
    const [weightStr,    setWeightStr]    = useState('');
    const [goal,         setGoal]         = useState('');
    const [injuries,     setInjuries]     = useState('');
    const [experience,   setExperience]   = useState('');

    // ── Load profile on mount ─────────────────────────────────────────────────
    const loadProfile = useCallback(async () => {
        try {
            setLoading(true);
            const data = await getClientProfile();
            setProfile(data.profile);
        } catch (err: any) {
            // Non-fatal — profile section will show "Not set"
            setProfile(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadProfile(); }, [loadProfile]);

    // ── Start editing — copy current values into buffer ───────────────────────
    const startEdit = () => {
        setHeightStr(profile?.height_cm  != null ? String(profile.height_cm)  : '');
        setWeightStr(profile?.weight_kg  != null ? String(profile.weight_kg)  : '');
        setGoal(profile?.fitness_goal        ?? '');
        setInjuries(profile?.injuries_notes  ?? '');
        setExperience(profile?.training_experience ?? '');
        setEditing(true);
    };

    const cancelEdit = () => setEditing(false);

    // ── Save body profile ─────────────────────────────────────────────────────
    const handleSave = async () => {
        // Validate numbers
        const heightNum = heightStr.trim() !== '' ? parseFloat(heightStr.trim()) : undefined;
        const weightNum = weightStr.trim() !== '' ? parseFloat(weightStr.trim()) : undefined;

        if (heightNum !== undefined && (isNaN(heightNum) || heightNum <= 0 || heightNum > 300)) {
            Alert.alert('Invalid height', 'Enter a valid height in cm (e.g. 165).');
            return;
        }
        if (weightNum !== undefined && (isNaN(weightNum) || weightNum <= 0 || weightNum > 500)) {
            Alert.alert('Invalid weight', 'Enter a valid weight in kg (e.g. 65.5).');
            return;
        }

        setSaving(true);
        try {
            await updateClientProfile({
                ...(heightNum !== undefined ? { height_cm: heightNum }              : {}),
                ...(weightNum !== undefined ? { weight_kg: weightNum }              : {}),
                fitness_goal:        goal.trim()       || undefined,
                injuries_notes:      injuries.trim()   || undefined,
                training_experience: experience.trim() || undefined,
            });

            // Refresh display from server so we show what was actually saved
            await loadProfile();
            setEditing(false);
        } catch (err: any) {
            Alert.alert('Could not save', err.message ?? 'Please try again.');
        } finally {
            setSaving(false);
        }
    };

    // ── Save name ─────────────────────────────────────────────────────────────
    const startNameEdit = () => {
        setNameInput(user?.name ?? '');
        setNameEditing(true);
    };

    const cancelNameEdit = () => setNameEditing(false);

    const handleSaveName = async () => {
        const trimmed = nameInput.trim();
        if (trimmed.length === 0) {
            Alert.alert('Invalid name', 'Name cannot be empty.');
            return;
        }
        if (trimmed.length > 100) {
            Alert.alert('Invalid name', 'Name is too long (max 100 characters).');
            return;
        }
        setNameSaving(true);
        try {
            const result = await updateClientProfile({ name: trimmed });
            // Update AuthContext so the hero avatar + name refresh instantly
            // without requiring a re-login.
            await updateUser({ name: result.name ?? trimmed });
            setNameEditing(false);
        } catch (err: any) {
            Alert.alert('Could not save name', err.message ?? 'Please try again.');
        } finally {
            setNameSaving(false);
        }
    };

    // ── Logout ────────────────────────────────────────────────────────────────
    const handleLogout = () => {
        Alert.alert('Sign out', 'Are you sure you want to sign out?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Sign out',
                style: 'destructive',
                onPress: async () => { await logout(); },
            },
        ]);
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <ScrollView
                style={s.list}
                contentContainerStyle={s.content}
                keyboardShouldPersistTaps="handled"
            >
                {/* ── Avatar + name ── */}
                <View style={s.hero}>
                    <View style={s.avatar}>
                        <Text style={s.avatarInitials}>
                            {getInitials(user?.name ?? '?')}
                        </Text>
                    </View>
                    <Text style={s.name}>{user?.name ?? '—'}</Text>
                    <Text style={s.email}>{user?.email ?? '—'}</Text>
                    <View style={s.rolePill}>
                        <Text style={s.roleText}>Client account</Text>
                    </View>
                </View>

                {/* ── Account section ── */}
                <View style={s.sectionHeader}>
                    <Text style={s.sectionLabel}>Account</Text>
                    {!nameEditing && (
                        <TouchableOpacity
                            onPress={startNameEdit}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityRole="button"
                            accessibilityLabel="Edit display name"
                        >
                            <Text style={s.editLink}>Edit name</Text>
                        </TouchableOpacity>
                    )}
                </View>

                {nameEditing ? (
                    <View style={s.editCard}>
                        {/* Name input */}
                        <View style={s.editRow}>
                            <Text style={s.editLabel}>Name</Text>
                            <TextInput
                                style={s.editInput}
                                value={nameInput}
                                onChangeText={setNameInput}
                                placeholder="Your display name"
                                placeholderTextColor={colors.textSecondary}
                                maxLength={100}
                                autoFocus
                                returnKeyType="done"
                                onSubmitEditing={handleSaveName}
                                accessibilityLabel="Display name"
                            />
                        </View>
                        {/* Email — read-only hint */}
                        <View style={[s.editRow, s.editRowBorder]}>
                            <Text style={s.editLabel}>Email</Text>
                            <Text style={[s.editInputReadOnly]}>{user?.email ?? '—'}</Text>
                        </View>
                        {/* Actions */}
                        <View style={s.actionRow}>
                            <TouchableOpacity
                                style={s.cancelBtn}
                                onPress={cancelNameEdit}
                                disabled={nameSaving}
                                accessibilityRole="button"
                            >
                                <Text style={s.cancelBtnText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[s.saveBtn, nameSaving && s.saveBtnDisabled]}
                                onPress={handleSaveName}
                                disabled={nameSaving}
                                accessibilityRole="button"
                            >
                                {nameSaving
                                    ? <ActivityIndicator size="small" color="#fff" />
                                    : <Text style={s.saveBtnText}>Save</Text>
                                }
                            </TouchableOpacity>
                        </View>
                    </View>
                ) : (
                    <View style={s.infoCard}>
                        <InfoRow label="Name"  value={user?.name  ?? '—'} />
                        <InfoRow label="Email" value={user?.email ?? '—'} last />
                    </View>
                )}

                {/* ── Body Profile section ── */}
                <View style={s.sectionHeader}>
                    <Text style={s.sectionLabel}>Body Profile</Text>
                    {!editing && (
                        <TouchableOpacity
                            onPress={startEdit}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityRole="button"
                            accessibilityLabel="Edit body profile"
                        >
                            <Text style={s.editLink}>Edit</Text>
                        </TouchableOpacity>
                    )}
                </View>

                {loading ? (
                    <View style={s.profileLoading}>
                        <ActivityIndicator size="small" color={colors.accent} />
                    </View>
                ) : editing ? (
                    <View style={s.editCard}>

                        {/* Height */}
                        <View style={s.editRow}>
                            <Text style={s.editLabel}>Height (cm)</Text>
                            <TextInput
                                style={s.editInput}
                                value={heightStr}
                                onChangeText={setHeightStr}
                                placeholder="e.g. 165"
                                placeholderTextColor={colors.textSecondary}
                                keyboardType="numeric"
                                maxLength={5}
                                accessibilityLabel="Height in centimetres"
                            />
                        </View>

                        {/* Weight */}
                        <View style={[s.editRow, s.editRowBorder]}>
                            <Text style={s.editLabel}>Weight (kg)</Text>
                            <TextInput
                                style={s.editInput}
                                value={weightStr}
                                onChangeText={setWeightStr}
                                placeholder="e.g. 65.5"
                                placeholderTextColor={colors.textSecondary}
                                keyboardType="numeric"
                                maxLength={6}
                                accessibilityLabel="Weight in kilograms"
                            />
                        </View>

                        {/* Fitness Goal — tap chips */}
                        <View style={s.editRowBorder}>
                            <Text style={[s.editLabel, { marginBottom: 8 }]}>Fitness Goal</Text>
                            <View style={s.chipRow}>
                                {FITNESS_GOAL_OPTIONS.map((opt) => (
                                    <TouchableOpacity
                                        key={opt.value}
                                        style={[
                                            s.chip,
                                            goal === opt.value && s.chipActive,
                                        ]}
                                        onPress={() => setGoal(
                                            goal === opt.value ? '' : opt.value
                                        )}
                                        activeOpacity={0.75}
                                        accessibilityRole="button"
                                        accessibilityLabel={opt.label}
                                    >
                                        <Text style={[
                                            s.chipText,
                                            goal === opt.value && s.chipTextActive,
                                        ]}>
                                            {opt.label}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>

                        {/* Injuries / health notes */}
                        <View style={s.editRowBorder}>
                            <Text style={[s.editLabel, { marginBottom: 6 }]}>Injuries / Health Notes</Text>
                            <TextInput
                                style={[s.editInput, s.editMulti]}
                                value={injuries}
                                onChangeText={setInjuries}
                                placeholder="e.g. Knee pain left side, lower back tight"
                                placeholderTextColor={colors.textSecondary}
                                multiline
                                maxLength={300}
                                accessibilityLabel="Injuries or health notes"
                            />
                        </View>

                        {/* Training experience — tap chips */}
                        <View style={s.editRowBorder}>
                            <Text style={[s.editLabel, { marginBottom: 8 }]}>Training Experience</Text>
                            <View style={s.chipRow}>
                                {EXPERIENCE_OPTIONS.map((opt) => (
                                    <TouchableOpacity
                                        key={opt.value}
                                        style={[
                                            s.chip,
                                            experience === opt.value && s.chipActive,
                                        ]}
                                        onPress={() => setExperience(
                                            experience === opt.value ? '' : opt.value
                                        )}
                                        accessibilityRole="button"
                                        accessibilityLabel={opt.label}
                                    >
                                        <Text style={[
                                            s.chipText,
                                            experience === opt.value && s.chipTextActive,
                                        ]}>
                                            {opt.label}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>

                        {/* Save / Cancel */}
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
                                {saving
                                    ? <ActivityIndicator size="small" color="#fff" />
                                    : <Text style={s.saveBtnText}>Save</Text>
                                }
                            </TouchableOpacity>
                        </View>
                    </View>
                ) : (
                    <View style={s.infoCard}>
                        <InfoRow label="Height"     value={profile?.height_cm  != null ? `${profile.height_cm} cm`  : 'Not set'} />
                        <InfoRow label="Weight"     value={profile?.weight_kg  != null ? `${profile.weight_kg} kg`  : 'Not set'} />
                        <InfoRow label="Goal"       value={profile?.fitness_goal        ?? 'Not set'} />
                        <InfoRow label="Injuries"   value={profile?.injuries_notes      ?? 'Not set'} />
                        <InfoRow label="Experience" value={formatExperience(profile?.training_experience)} last />
                    </View>
                )}

                {/* ── App section ── */}
                <Text style={[s.sectionLabel, { marginTop: spacing.xl }]}>App</Text>
                <View style={s.infoCard}>
                    <InfoRow label="Role"    value="Client" />
                    <InfoRow label="Version" value="FitnessGuruSG 1.0" last />
                </View>

                {/* ── Logout ── */}
                <TouchableOpacity
                    style={s.logoutBtn}
                    onPress={handleLogout}
                    activeOpacity={0.78}
                    accessibilityRole="button"
                    accessibilityLabel="Sign out"
                >
                    <Text style={s.logoutText}>Sign out</Text>
                </TouchableOpacity>

            </ScrollView>
        </KeyboardAvoidingView>
    );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
    return (
        <View style={[ir.row, !last && ir.divider]}>
            <Text style={ir.label}>{label}</Text>
            <Text style={ir.value} numberOfLines={3}>{value}</Text>
        </View>
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
}

function formatExperience(val: string | null | undefined): string {
    if (!val) return 'Not set';
    // Capitalise the first letter of canonical values for display
    return val.charAt(0).toUpperCase() + val.slice(1);
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const GREEN = '#16A34A';
const GREEN_SUBTLE = '#F0FDF4';

const s = StyleSheet.create({
    list: { flex: 1, backgroundColor: colors.background },
    content: {
        paddingTop: spacing.xl,
        paddingHorizontal: spacing.base,
        paddingBottom: spacing.section,
    },

    // Hero
    hero: {
        alignItems: 'center',
        marginBottom: spacing.xxl,
    },
    avatar: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: colors.statBg,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.base,
    },
    avatarInitials: {
        fontSize: 28,
        fontWeight: '700',
        color: '#FFFFFF',
        letterSpacing: 1,
    },
    name: {
        ...typography.h2,
        color: colors.textPrimary,
        marginBottom: spacing.xs,
    },
    email: {
        ...typography.body,
        color: colors.textSecondary,
        marginBottom: spacing.sm,
    },
    rolePill: {
        backgroundColor: colors.accentSubtle,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.base,
        paddingVertical: spacing.xs,
    },
    roleText: {
        ...typography.label,
        color: colors.accent,
    },

    // Section header row (label + Edit link side by side)
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.sm,
        marginTop: spacing.xs,
    },
    sectionLabel: {
        ...typography.micro,
        color: colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        // Note: no marginBottom here — sectionHeader handles spacing for "Body Profile"
    },
    editLink: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.accent,
    },

    // Original section label (standalone, used for Account + App + spacer)
    // We keep inline usage for Account/App by adding marginBottom manually.

    // Info card (read-only display)
    infoCard: {
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        marginBottom: spacing.xl,
        ...shadows.card,
    },

    // Profile loading placeholder
    profileLoading: {
        height: 80,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.xl,
    },

    // Edit card
    editCard: {
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        marginBottom: spacing.xl,
        paddingHorizontal: spacing.base,
        paddingTop: spacing.md,
        paddingBottom: spacing.md,
        ...shadows.card,
    },
    editRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: spacing.sm,
    },
    editRowBorder: {
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingTop: spacing.md,
        paddingBottom: spacing.sm,
    },
    editLabel: {
        ...typography.body,
        color: colors.textSecondary,
        flex: 1,
    },
    editInput: {
        flex: 1.4,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.sm,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 14,
        color: colors.textPrimary,
        backgroundColor: '#F9FAFB',
        textAlign: 'right',
    },
    editMulti: {
        textAlign: 'left',
        minHeight: 52,
        flex: undefined,
        width: '100%',
    },
    editInputReadOnly: {
        flex: 1.4,
        fontSize: 14,
        color: colors.textSecondary,
        textAlign: 'right',
        paddingVertical: 8,
    },

    // Experience chips
    chipRow: {
        flexDirection: 'row',
        gap: 8,
        flexWrap: 'wrap',
    },
    chip: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: '#F3F4F6',
    },
    chipActive: {
        backgroundColor: GREEN_SUBTLE,
        borderColor: GREEN,
    },
    chipText: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.textSecondary,
    },
    chipTextActive: {
        color: GREEN,
    },

    // Edit action buttons
    actionRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: spacing.md,
    },
    cancelBtn: {
        flex: 1,
        height: 44,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F9FAFB',
    },
    cancelBtnText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textSecondary,
    },
    saveBtn: {
        flex: 1,
        height: 44,
        borderRadius: radius.sm,
        backgroundColor: GREEN,
        alignItems: 'center',
        justifyContent: 'center',
    },
    saveBtnDisabled: {
        opacity: 0.6,
    },
    saveBtnText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#fff',
    },

    // Logout
    logoutBtn: {
        height: 52,
        borderWidth: 1,
        borderColor: colors.errorBorder,
        borderRadius: radius.card,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: spacing.sm,
    },
    logoutText: {
        ...typography.bodyLg,
        color: colors.errorText,
        fontWeight: '600',
    },
});

const ir = StyleSheet.create({
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        paddingHorizontal: spacing.base,
        paddingVertical: spacing.md,
    },
    divider: {
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    label: {
        ...typography.body,
        color: colors.textSecondary,
        flexShrink: 0,
        marginRight: 8,
    },
    value: {
        ...typography.body,
        color: colors.textPrimary,
        fontWeight: '500',
        maxWidth: '65%',
        textAlign: 'right',
    },
});
