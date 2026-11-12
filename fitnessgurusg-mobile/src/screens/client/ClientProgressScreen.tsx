import React, { useState, useCallback } from 'react';
import {
    View, Text, StyleSheet, ScrollView, ActivityIndicator,
    TouchableOpacity, RefreshControl, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { getCheckIns, getWorkoutHistory, getAuthHeaders } from '../../services/apiClient';
import { BASE_URL } from '../../config/api';
import CheckInCard, { CheckInCardData } from '../../components/CheckInCard';
import EmptyState from '../../components/EmptyState';
import Card from '../../components/Card';
import { WorkoutHistoryEntry } from '../../types';
import { colors, spacing, radius, typography, shadows } from '../../theme/theme';

/**
 * ClientProgressScreen — Enhanced progress view with 5 sections:
 *
 *  1. This Week Summary — streak, total check-ins, workouts this week, days active
 *  2. Workout Progress — recent completed workouts (last 5)
 *  3. Body Profile — read-only display of current profile data
 *  4. Progress Photos — last 6 photos from check-ins
 *  5. Check-in History — existing CheckInCard list
 *
 * Data sources:
 *  - Check-ins: GET /api/clients/:clientId/checkins
 *  - Workout history: GET /api/clients/me/workout/history
 *  - Profile: GET /api/clients/me/profile
 */

// ─── Raw data types ──────────────────────────────────────────────────────────

interface RawCheckIn {
    _id: string;
    date: string;
    metrics: { energy: number; hunger: number; stepsToday?: number };
    notes?: string;
    photos?: string[];
    detectedFlags?: any[];
    createdAt?: string;
}

interface BodyProfile {
    height_cm?: number;
    weight_kg?: number;
    goal?: string;
    experience_level?: string;
    age?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
    try {
        return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-SG', {
            day: '2-digit', month: 'short', year: 'numeric',
        });
    } catch {
        return dateStr;
    }
}

function formatShortDate(dateStr: string): string {
    try {
        return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-SG', {
            day: 'numeric', month: 'short',
        });
    } catch {
        return dateStr;
    }
}

function rawToCardData(ci: RawCheckIn): CheckInCardData {
    return {
        date: formatDate(ci.date),
        energy: ci.metrics.energy,
        hunger: ci.metrics.hunger,
        steps: ci.metrics.stepsToday ?? null,
        notes: ci.notes ?? null,
        detectedFlagCount: ci.detectedFlags?.length ?? 0,
    };
}

function computeStreak(checkIns: RawCheckIn[]): number {
    if (!checkIns.length) return 0;
    const dates = new Set(checkIns.map(c => c.date));
    let streak = 0;
    const d = new Date();
    for (let i = 0; i < 365; i++) {
        const key = d.toISOString().split('T')[0];
        if (dates.has(key)) {
            streak++;
            d.setDate(d.getDate() - 1);
        } else {
            break;
        }
    }
    return streak;
}

function getThisWeekDates(): string[] {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7)); // Go back to Monday
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ClientProgressScreen() {
    const { user } = useAuth();
    const clientId = user?.clientId ?? user?.id ?? '';

    const [checkIns,       setCheckIns]       = useState<RawCheckIn[]>([]);
    const [workoutHistory, setWorkoutHistory] = useState<WorkoutHistoryEntry[]>([]);
    const [bodyProfile,    setBodyProfile]    = useState<BodyProfile | null>(null);
    const [loading,        setLoading]        = useState(true);
    const [refreshing,     setRefreshing]     = useState(false);
    const [error,          setError]          = useState<string | null>(null);

    const fetchAll = useCallback(async (isRefresh = false) => {
        if (!clientId) { setLoading(false); setRefreshing(false); return; }
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
        setError(null);

        try {
            // Parallel fetches
            const [checkInResult, historyResult, profileResult] = await Promise.allSettled([
                getCheckIns(clientId),
                getWorkoutHistory(),
                (async () => {
                    const headers = await getAuthHeaders();
                    const res = await fetch(`${BASE_URL}/api/clients/me/profile`, { headers });
                    if (!res.ok) return null;
                    const data = await res.json();
                    return data.profile ?? data;
                })(),
            ]);

            // Check-ins
            if (checkInResult.status === 'fulfilled') {
                const list: RawCheckIn[] = checkInResult.value?.checkins ?? [];
                list.sort((a, b) => (a.date > b.date ? -1 : 1));
                setCheckIns(list);
            }

            // Workout history
            if (historyResult.status === 'fulfilled') {
                setWorkoutHistory(historyResult.value?.entries ?? []);
            }

            // Body profile
            if (profileResult.status === 'fulfilled' && profileResult.value) {
                setBodyProfile(profileResult.value);
            }
        } catch (err: any) {
            setError(err.message || 'Failed to load progress.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [clientId]);

    useFocusEffect(useCallback(() => { fetchAll(); }, [fetchAll]));

    // ── Derived data ───────────────────────────────────────────────────────────

    const streak = computeStreak(checkIns);
    const total  = checkIns.length;

    // This week stats
    const thisWeekDates = getThisWeekDates();
    const daysCheckedIn = checkIns.filter(ci => thisWeekDates.includes(ci.date)).length;
    const workoutsThisWeek = workoutHistory.filter(
        entry => thisWeekDates.includes(entry.assignment.date) && entry.log != null
    ).length;

    // Recent completed workouts (last 5)
    const recentWorkouts = workoutHistory
        .filter(entry => entry.log != null)
        .slice(0, 5);

    // Progress photos (from check-ins with photos, last 6)
    const progressPhotos: Array<{ url: string; date: string }> = [];
    for (const ci of checkIns) {
        if (progressPhotos.length >= 6) break;
        if (ci.photos && ci.photos.length > 0) {
            for (const photo of ci.photos) {
                if (progressPhotos.length >= 6) break;
                progressPhotos.push({
                    url: photo.startsWith('http') ? photo : `${BASE_URL}${photo}`,
                    date: ci.date,
                });
            }
        }
    }

    // ── Loading state ──────────────────────────────────────────────────────────

    if (loading) {
        return (
            <View style={s.centered}>
                <ActivityIndicator size="large" color={colors.accent} />
                <Text style={s.loadingText}>Loading your progress…</Text>
            </View>
        );
    }

    if (error) {
        return (
            <View style={s.centered}>
                <Ionicons name="cloud-offline-outline" size={36} color={colors.textSecondary} />
                <Text style={s.errorMsg}>{error}</Text>
                <TouchableOpacity style={s.retryBtn} onPress={() => fetchAll()} activeOpacity={0.78}>
                    <Text style={s.retryText}>Try again</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // ── Render ─────────────────────────────────────────────────────────────────

    return (
        <ScrollView
            style={s.scroll}
            contentContainerStyle={s.content}
            showsVerticalScrollIndicator={false}
            refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor={colors.accent} />
            }
        >
            {/* ─── Section 1: This Week Summary ──────────────────────────────── */}
            <View style={s.statsGrid}>
                <StatTile label="Day Streak 🔥" value={streak} accent />
                <StatTile label="Total Check-ins" value={total} />
                <StatTile label="This Week" value={daysCheckedIn} suffix="days" />
                <StatTile label="Workouts" value={workoutsThisWeek} suffix="this week" />
            </View>

            {/* ─── Section 2: Workout Progress ───────────────────────────────── */}
            <Text style={s.sectionTitle}>Recent Workouts</Text>
            {recentWorkouts.length === 0 ? (
                <Card style={s.sectionCard}>
                    <EmptyState compact icon="barbell-outline" title="No workouts logged yet" />
                </Card>
            ) : (
                recentWorkouts.map((entry, idx) => {
                    const completedCount = entry.log!.exercise_logs.filter(el => el.completed).length;
                    const totalEx = entry.assignment.exercises.length;
                    return (
                        <View key={entry.assignment._id ?? idx} style={s.workoutCard}>
                            <View style={s.workoutCardHeader}>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.workoutCardTitle}>{entry.assignment.title}</Text>
                                    <Text style={s.workoutCardDate}>{formatShortDate(entry.assignment.date)}</Text>
                                </View>
                                <View style={s.workoutCardBadge}>
                                    <Text style={s.workoutCardBadgeText}>
                                        {completedCount}/{totalEx} done
                                    </Text>
                                </View>
                            </View>
                            <View style={s.workoutCardExercises}>
                                {entry.assignment.exercises.slice(0, 3).map((ex, i) => (
                                    <Text key={i} style={s.workoutCardExName}>
                                        • {ex.name}
                                    </Text>
                                ))}
                                {entry.assignment.exercises.length > 3 && (
                                    <Text style={s.workoutCardMore}>
                                        +{entry.assignment.exercises.length - 3} more
                                    </Text>
                                )}
                            </View>
                        </View>
                    );
                })
            )}

            {/* ─── Section 3: Body Profile ───────────────────────────────────── */}
            <Text style={s.sectionTitle}>Body Profile</Text>
            {bodyProfile ? (
                <View style={s.profileCard}>
                    <View style={s.profileGrid}>
                        {bodyProfile.weight_kg != null && (
                            <ProfilePill label="Weight" value={`${bodyProfile.weight_kg} kg`} />
                        )}
                        {bodyProfile.height_cm != null && (
                            <ProfilePill label="Height" value={`${bodyProfile.height_cm} cm`} />
                        )}
                        {bodyProfile.age != null && (
                            <ProfilePill label="Age" value={`${bodyProfile.age}`} />
                        )}
                        {bodyProfile.experience_level && (
                            <ProfilePill label="Level" value={bodyProfile.experience_level} />
                        )}
                    </View>
                    {bodyProfile.goal ? (
                        <View style={s.goalRow}>
                            <Ionicons name="flag-outline" size={14} color={colors.accent} />
                            <Text style={s.goalText}>{bodyProfile.goal}</Text>
                        </View>
                    ) : null}
                    <Text style={s.profileHint}>Update in Profile tab</Text>
                </View>
            ) : (
                <Card style={s.sectionCard}>
                    <EmptyState compact icon="person-outline" title="No body profile set yet" />
                </Card>
            )}

            {/* ─── Section 4: Progress Photos ────────────────────────────────── */}
            <Text style={s.sectionTitle}>Progress Photos</Text>
            {progressPhotos.length === 0 ? (
                <Card style={s.sectionCard}>
                    <EmptyState
                        compact
                        icon="camera-outline"
                        title="No progress photos yet"
                        subtitle="Add photos in your daily check-in."
                    />
                </Card>
            ) : (
                <View style={s.photoGrid}>
                    {progressPhotos.map((photo, idx) => (
                        <View key={idx} style={s.photoThumb}>
                            <Image
                                source={{ uri: photo.url }}
                                style={s.photoImage}
                                resizeMode="cover"
                            />
                            <Text style={s.photoDate}>{formatShortDate(photo.date)}</Text>
                        </View>
                    ))}
                </View>
            )}

            {/* ─── Section 5: Check-in History ───────────────────────────────── */}
            <Text style={s.sectionTitle}>Check-in History</Text>
            {checkIns.length === 0 ? (
                <Card style={s.sectionCard}>
                    <EmptyState
                        icon="clipboard-outline"
                        title="No check-ins yet"
                        subtitle="Head to the Home tab and submit your first check-in."
                    />
                </Card>
            ) : (
                checkIns.map(ci => (
                    <CheckInCard key={ci._id} data={rawToCardData(ci)} compact={false} />
                ))
            )}
        </ScrollView>
    );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatTile({ label, value, suffix, accent }: {
    label: string; value: number; suffix?: string; accent?: boolean;
}) {
    return (
        <View style={[st.tile, accent && st.tileAccent]}>
            <Text style={[st.value, accent && st.valueAccent]}>{value}</Text>
            <Text style={[st.label, accent && st.labelAccent]}>{label}</Text>
            {suffix ? <Text style={[st.suffix, accent && st.suffixAccent]}>{suffix}</Text> : null}
        </View>
    );
}

function ProfilePill({ label, value }: { label: string; value: string }) {
    return (
        <View style={pp.pill}>
            <Text style={pp.label}>{label}</Text>
            <Text style={pp.value}>{value}</Text>
        </View>
    );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    scroll: { flex: 1, backgroundColor: colors.background },
    content: {
        paddingHorizontal: spacing.base,
        paddingTop: spacing.xl,
        paddingBottom: spacing.section * 2,
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
        padding: spacing.xl,
    },

    // ── Stats grid ────────────────────────────────────────────────────────────
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.sm,
        marginBottom: spacing.xl,
    },

    // ── Section titles ────────────────────────────────────────────────────────
    sectionTitle: {
        ...typography.label,
        color: colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: spacing.sm,
        marginTop: spacing.base,
    },

    // ── Loading / Error ───────────────────────────────────────────────────────
    loadingText: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: spacing.base,
    },
    errorMsg: {
        ...typography.body,
        color: colors.errorText,
        textAlign: 'center',
        marginBottom: spacing.base,
    },
    retryBtn: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.card,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.xl,
    },
    retryText: {
        ...typography.label,
        color: colors.textPrimary,
    },

    sectionCard: { marginBottom: spacing.base, paddingVertical: spacing.sm },

    // ── Workout cards ─────────────────────────────────────────────────────────
    workoutCard: {
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.base,
        marginBottom: spacing.sm,
        ...shadows.card,
    },
    workoutCardHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: spacing.sm,
    },
    workoutCardTitle: {
        ...typography.label,
        color: colors.textPrimary,
        fontWeight: '700',
        marginBottom: 2,
    },
    workoutCardDate: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    workoutCardBadge: {
        backgroundColor: '#D1FAE5',
        borderRadius: radius.pill,
        paddingHorizontal: spacing.sm,
        paddingVertical: 3,
    },
    workoutCardBadgeText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#065F46',
    },
    workoutCardExercises: {
        paddingLeft: spacing.xs,
    },
    workoutCardExName: {
        ...typography.caption,
        color: colors.textPrimary,
        marginBottom: 2,
    },
    workoutCardMore: {
        ...typography.caption,
        color: colors.textSecondary,
        fontStyle: 'italic',
    },

    // ── Body Profile card ─────────────────────────────────────────────────────
    profileCard: {
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.base,
        marginBottom: spacing.base,
        ...shadows.card,
    },
    profileGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.sm,
        marginBottom: spacing.sm,
    },
    goalRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        marginBottom: spacing.xs,
    },
    goalText: {
        ...typography.body,
        color: colors.textPrimary,
        fontWeight: '600',
    },
    profileHint: {
        ...typography.micro,
        color: colors.placeholder,
        textAlign: 'center',
        marginTop: spacing.xs,
    },

    // ── Photo grid ────────────────────────────────────────────────────────────
    photoGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.sm,
        marginBottom: spacing.base,
    },
    photoThumb: {
        width: '31%' as any,
        aspectRatio: 1,
        borderRadius: radius.md,
        overflow: 'hidden',
        backgroundColor: colors.border,
    },
    photoImage: {
        width: '100%',
        height: '100%',
    },
    photoDate: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        color: '#fff',
        fontSize: 10,
        fontWeight: '600',
        textAlign: 'center',
        paddingVertical: 2,
    },
});

// ── StatTile styles ──────────────────────────────────────────────────────────

const st = StyleSheet.create({
    tile: {
        flexBasis: '48%',
        flexGrow: 1,
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.base,
        alignItems: 'center',
        ...shadows.card,
    },
    tileAccent: {
        backgroundColor: colors.statBg,
        borderColor: colors.statBg,
    },
    value: {
        ...typography.h1,
        color: colors.textPrimary,
    },
    valueAccent: { color: '#FFFFFF' },
    label: {
        ...typography.caption,
        color: colors.textSecondary,
        textAlign: 'center',
    },
    labelAccent: { color: 'rgba(255,255,255,0.75)' },
    suffix: {
        ...typography.micro,
        color: colors.placeholder,
        marginTop: 2,
    },
    suffixAccent: { color: 'rgba(255,255,255,0.55)' },
});

// ── ProfilePill styles ───────────────────────────────────────────────────────

const pp = StyleSheet.create({
    pill: {
        backgroundColor: colors.background,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        alignItems: 'center',
        minWidth: 70,
    },
    label: {
        ...typography.micro,
        color: colors.textSecondary,
        textTransform: 'uppercase',
        marginBottom: 2,
    },
    value: {
        ...typography.label,
        color: colors.textPrimary,
        fontWeight: '700',
    },
});
