/**
 * ClientPaymentDashboardScreen — "Client Details"
 *
 * Full client overview for the coach. Screen layout (top → bottom):
 *   1. Client header  — name, plan badge, sessions remaining
 *   2. Quick Actions  — Assign Plan · Assign Workout · WhatsApp
 *   3. Body Profile   — height, weight, goal, experience, injuries
 *   4. Latest Check-In — date, energy, steps, note
 *   5. Session Plan card (unchanged)
 *   6. Payment History (unchanged, moved to bottom)
 *
 * Safety:
 *   - Payment logic unchanged (PaymentRow, handleConfirmFromRow)
 *   - SessionStatusCard unchanged
 *   - Plan assignment logic unchanged
 *   - Workout assignment logic unchanged
 *   - Auth unchanged
 *   - Database schema unchanged (new route is read-only)
 *   - Body Profile / Check-In fetches are non-blocking:
 *     if they fail, the card shows a graceful empty state.
 */

import React, { useCallback, useLayoutEffect, useState } from 'react';
import {
    View, Text, StyleSheet, FlatList, TouchableOpacity,
    Alert, ActivityIndicator, SafeAreaView, RefreshControl,
    Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, typography, spacing, radius, shadows, palette } from '../../theme/theme';
import { fontStyle, useKitFonts } from '../../theme/fonts';
import UserAvatar from '../../components/UserAvatar';
import {
    getSessionStatus,
    getClientPayments,
    getCheckIns,
    getClientBodyProfile,
    ClientBodyProfile,
} from '../../services/apiClient';
import { Payment, PlanStatus, SessionStatusResponse, CheckIn } from '../../types';
import type { CoachStackParamList } from '../../navigation/CoachStackParamList';

type NavProp       = NativeStackNavigationProp<CoachStackParamList, 'ClientPayments'>;
type RoutePropType = RouteProp<CoachStackParamList, 'ClientPayments'>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const METHOD_LABELS: Record<string, string> = {
    paynow:        'PayNow',
    bank_transfer: 'Bank Transfer',
    cash:          'Cash',
    other:         'Other',
};

const STATUS_CONFIG = {
    active:         { label: 'Active',         bg: '#D1FAE5', text: '#065F46' },
    expiring_soon:  { label: 'Expiring Soon',  bg: '#FEF3C7', text: '#92400E' },
    expired:        { label: 'Expired',        bg: '#FEE2E2', text: '#991B1B' },
    none:           { label: 'No Plan',        bg: '#F3F4F6', text: '#6B7280' },
} as const;

function daysUntilExpiry(expiryDate: string): number {
    const today  = new Date(); today.setHours(0, 0, 0, 0);
    const expiry = new Date(`${expiryDate}T00:00:00`);
    return Math.round((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDateSG(dateStr: string): string {
    try {
        const d = new Date(`${dateStr}T00:00:00`);
        return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

// ─── Section label ────────────────────────────────────────────────────────────

function SLabel({ text }: { text: string }) {
    return <Text style={st.sectionLabel}>{text}</Text>;
}

// ─── Quick Actions ────────────────────────────────────────────────────────────

function QuickActions({
    onAssignPlan,
    onAssignWorkout,
    onWhatsApp,
}: {
    onAssignPlan:    () => void;
    onAssignWorkout: () => void;
    onWhatsApp:      () => void;
}) {
    const fonts = useKitFonts();
    const items: Array<{ label: string; icon: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void }> = [
        { label: 'Assign Plan', icon: 'document-text-outline', onPress: onAssignPlan },
        { label: 'Assign Workout', icon: 'barbell-outline', onPress: onAssignWorkout },
        { label: 'WhatsApp', icon: 'logo-whatsapp', onPress: onWhatsApp },
    ];
    return (
        <View style={st.quickRow}>
            {items.map(item => (
                <TouchableOpacity key={item.label} style={st.qTile} onPress={item.onPress} activeOpacity={0.85} accessibilityRole="button">
                    <View style={st.qIcon}>
                        <Ionicons name={item.icon} size={18} color={palette.teal} />
                    </View>
                    <Text style={[st.qBtnLabel, fontStyle(fonts.bodySemibold, '600')]}>{item.label}</Text>
                </TouchableOpacity>
            ))}
        </View>
    );
}

// ─── Body Profile section ─────────────────────────────────────────────────────

function ProfileRow({ label, value }: { label: string; value: string | number | null }) {
    return (
        <View style={st.profileRow}>
            <Text style={st.profileLabel}>{label}</Text>
            <Text style={[st.profileValue, !value && st.profileValueEmpty]}>
                {value != null && value !== '' ? String(value) : 'Not set'}
            </Text>
        </View>
    );
}

function BodyProfileCard({ profile, loading }: { profile: ClientBodyProfile | null; loading: boolean }) {
    return (
        <View style={st.infoCard}>
            <SLabel text="BODY PROFILE" />
            {loading ? (
                <ActivityIndicator color={colors.accent} size="small" style={{ marginVertical: spacing.sm }} />
            ) : (
                <>
                    <View style={st.profileGrid}>
                        <View style={{ flex: 1 }}>
                            <ProfileRow label="Height" value={profile?.height_cm != null ? `${profile.height_cm} cm` : null} />
                            <ProfileRow label="Weight" value={profile?.weight_kg != null ? `${profile.weight_kg} kg` : null} />
                        </View>
                        <View style={st.profileDivider} />
                        <View style={{ flex: 1 }}>
                            <ProfileRow label="Experience" value={profile?.training_experience ?? null} />
                            <ProfileRow label="Goal" value={profile?.fitness_goal ?? null} />
                        </View>
                    </View>
                    {(profile?.injuries_notes) ? (
                        <View style={st.injuriesRow}>
                            <Text style={st.injuriesText}>{profile.injuries_notes}</Text>
                        </View>
                    ) : (
                        <Text style={st.profileValueEmpty}>No injuries / notes on file</Text>
                    )}
                </>
            )}
        </View>
    );
}

// ─── Body Measurements section (read-only) ────────────────────────────────────

function MeasurementRow({
    label,
    value,
    isLast = false,
}: {
    label: string;
    value: number | null | undefined;
    isLast?: boolean;
}) {
    const hasValue = typeof value === 'number' && !isNaN(value);
    return (
        <View style={[st.measurementRow, isLast && st.measurementRowLast]}>
            <Text style={st.measurementLabel}>{label}</Text>
            <Text style={[st.measurementValue, !hasValue && st.profileValueEmpty]}>
                {hasValue ? `${value} cm` : 'Not set'}
            </Text>
        </View>
    );
}

function BodyMeasurementsCard({ profile, loading }: { profile: ClientBodyProfile | null; loading: boolean }) {
    const hasAnyMeasurements = Boolean(
        profile && (
            profile.neck_cm != null ||
            profile.chest_cm != null ||
            profile.waist_cm != null ||
            profile.hips_cm != null
        )
    );

    return (
        <View style={st.infoCard}>
            <SLabel text="BODY MEASUREMENTS" />
            {loading ? (
                <ActivityIndicator color={colors.accent} size="small" style={{ marginVertical: spacing.sm }} />
            ) : !hasAnyMeasurements ? (
                <View style={st.emptyInline}>
                    <Ionicons name="body-outline" size={18} color={colors.placeholder} />
                    <Text style={st.emptyInlineText}>No body measurements recorded yet.</Text>
                </View>
            ) : (
                <View style={st.measurementsList}>
                    <MeasurementRow label="Neck" value={profile?.neck_cm} />
                    <MeasurementRow label="Chest/Bust" value={profile?.chest_cm} />
                    <MeasurementRow label="Waist" value={profile?.waist_cm} />
                    <MeasurementRow label="Hips" value={profile?.hips_cm} isLast />
                </View>
            )}
        </View>
    );
}

// ─── Latest Check-In section ──────────────────────────────────────────────────

function EnergyDots({ value }: { value: number }) {
    return (
        <View style={st.energyRow}>
            {Array.from({ length: 10 }, (_, i) => (
                <View
                    key={i}
                    style={[
                        st.energyDot,
                        i < value
                            ? { backgroundColor: value <= 6 ? '#D97706' : colors.accent }
                            : { backgroundColor: colors.border },
                    ]}
                />
            ))}
            <Text style={st.energyNum}>{value}/10</Text>
        </View>
    );
}

function LatestCheckInCard({ checkin, loading }: { checkin: CheckIn | null; loading: boolean }) {
    return (
        <View style={st.infoCard}>
            <SLabel text="LATEST CHECK-IN" />
            {loading ? (
                <ActivityIndicator color={colors.accent} size="small" style={{ marginVertical: spacing.sm }} />
            ) : !checkin ? (
                <View style={st.emptyInline}>
                    <Ionicons name="calendar-outline" size={18} color={colors.placeholder} />
                    <Text style={st.emptyInlineText}>No check-in recorded yet</Text>
                </View>
            ) : (
                <>
                    <Text style={st.checkinDate}>{formatDateSG(checkin.date)}</Text>
                    <View style={st.checkinMetaGrid}>
                        <View style={st.checkinMetaItem}>
                            <Text style={st.profileLabel}>Energy</Text>
                            <EnergyDots value={checkin.metrics.energy} />
                        </View>
                        <View style={st.checkinMetaItem}>
                            {/* UI label is "Appetite," but data field remains `hunger` for backward compatibility. */}
                            <Text style={st.profileLabel}>Appetite</Text>
                            <Text style={st.checkinMetaValue}>{checkin.metrics.hunger}/10</Text>
                        </View>
                        {checkin.metrics.stepsToday != null && (
                            <View style={st.checkinMetaItem}>
                                <Text style={st.profileLabel}>Steps</Text>
                                <Text style={st.checkinMetaValue}>{checkin.metrics.stepsToday.toLocaleString()}</Text>
                            </View>
                        )}
                    </View>
                    {checkin.notes ? (
                        <View style={st.checkinNote}>
                            <Ionicons name="chatbubble-ellipses-outline" size={13} color={colors.textSecondary} />
                            <Text style={st.checkinNoteText}>{checkin.notes}</Text>
                        </View>
                    ) : null}
                </>
            )}
        </View>
    );
}

// ─── Session Status Card (unchanged) ─────────────────────────────────────────

function SessionStatusCard({ status }: { status: SessionStatusResponse }) {
    if (!status.has_plan) {
        return (
            <View style={st.noPlanCard}>
                <Ionicons name="folder-open-outline" size={32} color={colors.textSecondary} />
                <Text style={st.noPlanText}>No active session plan</Text>
            </View>
        );
    }

    const planStatus = (status.plan_status ?? 'none') as PlanStatus;
    const cfg        = STATUS_CONFIG[planStatus] ?? STATUS_CONFIG.none;
    const remaining  = status.sessions_remaining ?? 0;
    const total      = status.sessions_total ?? 0;
    const pct        = total > 0 ? remaining / total : 0;

    const expiryLabelText = status.expiry_date
        ? (() => {
              const d = daysUntilExpiry(status.expiry_date);
              if (d < 0)  return `Expired ${Math.abs(d)}d ago`;
              if (d === 0) return 'Expires today';
              return `${d} days left`;
          })()
        : '';

    return (
        <View style={st.statusCard}>
            <View style={st.statusHeader}>
                <Text style={st.statusPlanName}>{status.plan_name ?? 'Active Plan'}</Text>
                <View style={[st.statusBadgeSmall, { backgroundColor: cfg.bg }]}>
                    <Text style={[st.statusBadgeText, { color: cfg.text }]}>{cfg.label}</Text>
                </View>
            </View>

            {/* Progress bar */}
            <View style={st.progressOuter}>
                <View style={[st.progressInner, { width: `${pct * 100}%` as any }]} />
            </View>
            <View style={st.progressLabels}>
                <Text style={st.progressLeft}>{remaining} sessions left</Text>
                <Text style={st.progressRight}>{total} total</Text>
            </View>

            {status.expiry_date && (
                <Text style={st.expiryLabel}>
                    <Ionicons name="calendar-outline" size={13} /> {expiryLabelText} ·{' '}
                    {new Date(`${status.expiry_date}T00:00:00`).toLocaleDateString('en-SG', {
                        day: 'numeric', month: 'short', year: 'numeric',
                    })}
                </Text>
            )}
        </View>
    );
}

// ─── Payment Row (unchanged) ──────────────────────────────────────────────────

function PaymentRow({ payment, onConfirm }: { payment: Payment; onConfirm?: (p: Payment) => void }) {
    const isPending = payment.status === 'pending';
    const dateStr   = payment.paid_at
        ? new Date(payment.paid_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
        : new Date(payment.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });

    return (
        <View style={[st.paymentRow, isPending && st.paymentRowPending]}>
            <View style={st.paymentLeft}>
                <Text style={st.paymentPlan}>{payment.plan_name}</Text>
                <Text style={st.paymentMeta}>
                    {METHOD_LABELS[payment.payment_method] ?? payment.payment_method}
                    {payment.reference ? ` · ${payment.reference}` : ''}
                </Text>
                <Text style={st.paymentDate}>{dateStr}</Text>
            </View>
            <View style={st.paymentRight}>
                <Text style={st.paymentAmount}>SGD {payment.amount_sgd.toLocaleString()}</Text>
                {isPending ? (
                    <TouchableOpacity style={st.confirmMiniButton} onPress={() => onConfirm?.(payment)}>
                        <Text style={st.confirmMiniLabel}>Mark Paid</Text>
                    </TouchableOpacity>
                ) : (
                    <View style={st.confirmedBadge}>
                        <Ionicons name="checkmark-circle" size={14} color="#22C55E" />
                        <Text style={st.confirmedBadgeText}>Paid</Text>
                    </View>
                )}
            </View>
        </View>
    );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

type DetailTab = 'overview' | 'checkins' | 'payments';

export default function ClientPaymentDashboardScreen() {
    const navigation = useNavigation<NavProp>();
    const route      = useRoute<RoutePropType>();
    const insets     = useSafeAreaInsets();
    const fonts      = useKitFonts();
    const { clientId, clientName } = route.params;
    const [tab, setTab] = useState<DetailTab>('overview');

    useLayoutEffect(() => {
        navigation.setOptions({ headerShown: false });
    }, [navigation]);

    // Core data (same as before)
    const [sessionStatus, setSessionStatus] = useState<SessionStatusResponse | null>(null);
    const [payments,      setPayments]      = useState<Payment[]>([]);
    const [loading,       setLoading]       = useState(true);
    const [refreshing,    setRefreshing]    = useState(false);
    const [error,         setError]         = useState<string | null>(null);

    // New: body profile + check-in (non-blocking)
    const [bodyProfile,     setBodyProfile]     = useState<ClientBodyProfile | null>(null);
    const [latestCheckIn,   setLatestCheckIn]   = useState<CheckIn | null>(null);
    const [profileLoading,  setProfileLoading]  = useState(true);
    const [checkinLoading,  setCheckinLoading]  = useState(true);

    const fetchAll = useCallback(async () => {
        try {
            setError(null);

            // ── Core: session status + payments (same as before) ──────────────
            const [ss, pay] = await Promise.all([
                getSessionStatus(clientId),
                getClientPayments(clientId),
            ]);
            setSessionStatus(ss);
            setPayments(pay.payments);
        } catch (e: any) {
            setError(e.message ?? 'Failed to load client data.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }

        // ── Non-blocking: body profile ────────────────────────────────────────
        setProfileLoading(true);
        getClientBodyProfile(clientId)
            .then(res => { if (res.success) setBodyProfile(res.profile); })
            .catch(() => {/* graceful degrade — card shows empty state */})
            .finally(() => setProfileLoading(false));

        // ── Non-blocking: latest check-in ─────────────────────────────────────
        setCheckinLoading(true);
        getCheckIns(clientId)
            .then(res => {
                if (res.checkins && res.checkins.length > 0) {
                    // Backend returns newest first
                    setLatestCheckIn(res.checkins[0]);
                }
            })
            .catch(() => {/* graceful degrade */})
            .finally(() => setCheckinLoading(false));
    }, [clientId]);

    useFocusEffect(useCallback(() => {
        setLoading(true);
        setProfileLoading(true);
        setCheckinLoading(true);
        fetchAll();
    }, [fetchAll]));

    // ── Handlers (unchanged) ──────────────────────────────────────────────────

    const handleConfirmFromRow = async (payment: Payment) => {
        navigation.navigate('PaymentConfirm', {
            paymentId:  payment._id,
            clientName,
            planName:   payment.plan_name,
            amount:     payment.amount_sgd,
        });
    };

    const handleWhatsApp = () => {
        Alert.alert(
            '📱 WhatsApp Reminder',
            `Send a check-in reminder to ${clientName} on WhatsApp.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Open WhatsApp',
                    onPress: () =>
                        Linking.openURL('https://wa.me/').catch(() =>
                            Alert.alert('Cannot Open WhatsApp', 'Make sure WhatsApp is installed.')
                        ),
                },
            ]
        );
    };

    // ── Loading / error states ────────────────────────────────────────────────

    if (loading) {
        return (
            <SafeAreaView style={st.centered}>
                <ActivityIndicator size="large" color={colors.accent} />
            </SafeAreaView>
        );
    }

    if (error) {
        return (
            <SafeAreaView style={st.centered}>
                <Text style={st.errorText}>{error}</Text>
                <TouchableOpacity onPress={fetchAll} style={st.retryBtn}>
                    <Text style={st.retryLabel}>Try Again</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    // ── Render ────────────────────────────────────────────────────────────────

    const planStatus = (sessionStatus?.plan_status ?? 'none') as PlanStatus;
    const planCfg = STATUS_CONFIG[planStatus] ?? STATUS_CONFIG.none;
    const tabs: Array<{ key: DetailTab; label: string }> = [
        { key: 'overview', label: 'Overview' },
        { key: 'checkins', label: 'Check-ins' },
        { key: 'payments', label: 'Payments' },
    ];

    const overview = (
        <>
            <QuickActions
                onAssignPlan={() => navigation.navigate('PlanSelection', { clientId, clientName })}
                onAssignWorkout={() => navigation.navigate('AssignWorkout', { clientId, clientName })}
                onWhatsApp={handleWhatsApp}
            />
            <LatestCheckInCard checkin={latestCheckIn} loading={checkinLoading} />
            <BodyProfileCard profile={bodyProfile} loading={profileLoading} />
            <BodyMeasurementsCard profile={bodyProfile} loading={profileLoading} />
            <SLabel text="SESSION PLAN" />
            {sessionStatus && <SessionStatusCard status={sessionStatus} />}
        </>
    );

    return (
        <View style={st.container}>
            <View style={[st.hero, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity
                    style={st.backRow}
                    onPress={() => navigation.goBack()}
                    accessibilityRole="button"
                    accessibilityLabel="Back to clients"
                >
                    <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
                    <Text style={[st.backLabel, fontStyle(fonts.bodySemibold, '600')]}>Clients</Text>
                </TouchableOpacity>
                <View style={st.identity}>
                    <UserAvatar name={clientName} size={56} bgColor="rgba(255,255,255,0.16)" textColor="#FFFFFF" />
                    <View style={{ flex: 1 }}>
                        <Text style={[st.heroName, fontStyle(fonts.heading, '700')]} numberOfLines={1}>{clientName}</Text>
                        <View style={[st.heroPill, { backgroundColor: planCfg.bg }]}>
                            <Text style={[st.heroPillText, { color: planCfg.text }]}>
                                {planStatus === 'active' ? 'Active Plan' : planCfg.label}
                            </Text>
                        </View>
                    </View>
                </View>
                <View style={st.tabRow}>
                    {tabs.map(item => {
                        const on = tab === item.key;
                        return (
                            <TouchableOpacity
                                key={item.key}
                                style={[st.tab, on && st.tabOn]}
                                onPress={() => setTab(item.key)}
                                accessibilityRole="button"
                            >
                                <Text style={[st.tabText, on && st.tabTextOn, fontStyle(fonts.bodySemibold, '600')]}>{item.label}</Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            </View>

            <FlatList
                data={tab === 'payments' ? payments : []}
                keyExtractor={p => p._id}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={() => { setRefreshing(true); fetchAll(); }}
                        tintColor={colors.accent}
                    />
                }
                ListHeaderComponent={() => (
                    <View style={st.sheet}>
                        {tab === 'overview' && overview}
                        {tab === 'checkins' && (
                            <LatestCheckInCard checkin={latestCheckIn} loading={checkinLoading} />
                        )}
                        {tab === 'payments' && payments.length > 0 && <SLabel text="PAYMENT HISTORY" />}
                    </View>
                )}
                renderItem={({ item }) => (
                    <View style={st.paymentWrap}>
                        <PaymentRow payment={item} onConfirm={handleConfirmFromRow} />
                    </View>
                )}
                ListEmptyComponent={() => (
                    tab === 'payments' ? (
                        <View style={st.emptyState}>
                            <Ionicons name="receipt-outline" size={40} color={colors.textSecondary} />
                            <Text style={st.emptyText}>No payments yet</Text>
                        </View>
                    ) : null
                )}
                contentContainerStyle={st.listContent}
                showsVerticalScrollIndicator={false}
            />
        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const NAVY = '#183A4A';
const TEAL = '#0F766E';

const st = StyleSheet.create({
    container:   { flex: 1, backgroundColor: colors.background },
    centered:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.xl },
    listContent: { paddingBottom: spacing.xxl },
    sheet: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
    paymentWrap: { paddingHorizontal: spacing.md },
    hero: {
        backgroundColor: palette.primary,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.md,
    },
    backRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: spacing.md },
    backLabel: { color: '#FFFFFF', fontSize: 16, marginLeft: 2 },
    identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
    heroName: { fontSize: 24, color: '#FFFFFF', marginBottom: 6 },
    heroPill: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
    heroPillText: { fontSize: 12, fontWeight: '700' },
    tabRow: { flexDirection: 'row', gap: 6 },
    tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
    tabOn: { backgroundColor: 'rgba(255,255,255,0.16)' },
    tabText: { color: 'rgba(255,255,255,0.65)', fontSize: 14 },
    tabTextOn: { color: '#FFFFFF' },

    // ── Section label ──────────────────────────────────────────────────────────
    sectionLabel: {
        ...typography.micro,
        color:         colors.textSecondary,
        letterSpacing: 1,
        marginTop:     spacing.md,
        marginBottom:  spacing.sm,
    },

    // ── Client Header card ────────────────────────────────────────────────────
    headerCard: {
        flexDirection:   'row',
        alignItems:      'center',
        gap:             spacing.md,
        backgroundColor: NAVY,
        borderRadius:    radius.cardLg,
        padding:         spacing.base,
        marginBottom:    spacing.sm,
        ...shadows.cardElevated,
    },
    avatarCircle: {
        width:           48,
        height:          48,
        borderRadius:    24,
        backgroundColor: 'rgba(255,255,255,0.18)',
        alignItems:      'center',
        justifyContent:  'center',
    },
    avatarText:      { fontSize: 18, fontWeight: '800', color: '#fff' },
    clientName:      { ...typography.h2, color: '#fff' },
    planSubline:     { ...typography.caption, color: '#9AAFC4', marginTop: 2 },
    planSublineNone: { ...typography.caption, color: '#9AAFC4', fontStyle: 'italic', marginTop: 2 },
    statusBadge: {
        paddingHorizontal: spacing.sm,
        paddingVertical:   3,
        borderRadius:      radius.pill,
        alignSelf:         'flex-start',
    },
    statusBadgeText: { ...typography.micro, fontWeight: '700' },

    // ── Quick Actions ─────────────────────────────────────────────────────────
    quickRow: {
        flexDirection:  'row',
        gap:            spacing.sm,
        marginBottom:   spacing.sm,
    },
    qBtn: {
        flex:           1,
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            spacing.xs,
        paddingVertical: spacing.sm,
        borderRadius:   radius.md,
    },
    qBtnNavy:  { backgroundColor: NAVY },
    qBtnTeal:  { backgroundColor: TEAL },
    qBtnGhost: {
        backgroundColor: colors.surface,
        borderWidth:     1.5,
        borderColor:     '#25D366',
    },
    qTile: {
        flex: 1,
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.xs,
        ...shadows.card,
    },
    qIcon: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: colors.accentSubtle,
        alignItems: 'center', justifyContent: 'center',
        marginBottom: spacing.sm,
    },
    qBtnLabel: { ...typography.caption, color: colors.textPrimary, fontWeight: '700', textAlign: 'center' },

    // ── Info cards (body profile + check-in) ─────────────────────────────────
    infoCard: {
        backgroundColor: colors.surface,
        borderRadius:    radius.card,
        borderWidth:     1,
        borderColor:     colors.border,
        padding:         spacing.md,
        marginBottom:    spacing.sm,
        ...shadows.card,
    },

    // Body Profile
    profileGrid:      { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
    profileDivider:   { width: 1, backgroundColor: colors.border },
    profileRow:       { marginBottom: spacing.xs },
    profileLabel:     { fontSize: 9, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5, marginBottom: 1 },
    profileValue:     { ...typography.label, color: colors.textPrimary },
    profileValueEmpty:{ ...typography.caption, color: colors.placeholder, fontStyle: 'italic' },
    injuriesRow: {
        flexDirection:   'row',
        alignItems:      'flex-start',
        gap:             spacing.xs,
        backgroundColor: colors.amberBg,
        borderRadius:    radius.sm,
        padding:         spacing.sm,
        marginTop:       spacing.xs,
    },
    injuriesText: { ...typography.caption, color: colors.amberText, flex: 1 },

    // Body Measurements
    measurementsList:   { marginTop: spacing.xs },
    measurementRow: {
        flexDirection:     'row',
        justifyContent:    'space-between',
        alignItems:        'center',
        paddingVertical:   spacing.xs + 3,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderLight,
    },
    measurementRowLast: {
        borderBottomWidth: 0,
        paddingBottom:     0,
    },
    measurementLabel: {
        fontSize:   13,
        fontWeight: '500',
        color:      colors.textSecondary,
    },
    measurementValue: {
        ...typography.label,
        color: colors.textPrimary,
    },

    // Check-In
    checkinDate:      { ...typography.label, color: colors.textPrimary, marginBottom: spacing.sm },
    checkinMetaGrid:  { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xs },
    checkinMetaItem:  { gap: 3 },
    checkinMetaValue: { ...typography.h3, color: colors.textPrimary },
    energyRow:        { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
    energyDot:        { width: 8, height: 8, borderRadius: 4 },
    energyNum:        { ...typography.caption, color: colors.textSecondary, marginLeft: 4 },
    checkinNote: {
        flexDirection:   'row',
        alignItems:      'flex-start',
        gap:             spacing.xs,
        marginTop:       spacing.xs,
        backgroundColor: colors.background,
        borderRadius:    radius.sm,
        padding:         spacing.sm,
    },
    checkinNoteText:  { ...typography.caption, color: colors.textSecondary, flex: 1, fontStyle: 'italic' },

    emptyInline: {
        flexDirection:  'row',
        alignItems:     'center',
        gap:            spacing.sm,
        paddingVertical: spacing.sm,
    },
    emptyInlineText: { ...typography.caption, color: colors.textSecondary },

    // ── Session status card ───────────────────────────────────────────────────
    statusCard: {
        backgroundColor: colors.surface,
        borderRadius:    radius.cardLg,
        padding:         spacing.md,
        marginBottom:    spacing.sm,
        ...shadows.cardElevated,
    },
    statusHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
    statusPlanName:  { ...typography.h3, color: colors.textPrimary },
    statusBadgeSmall:{ paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },

    progressOuter:  { height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden', marginBottom: 4 },
    progressInner:  { height: '100%', backgroundColor: colors.accent, borderRadius: 4 },
    progressLabels: { flexDirection: 'row', justifyContent: 'space-between' },
    progressLeft:   { ...typography.caption, color: colors.textPrimary, fontWeight: '600' },
    progressRight:  { ...typography.caption, color: colors.textSecondary },
    expiryLabel:    { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },

    noPlanCard: {
        alignItems:      'center',
        paddingVertical: spacing.xl,
        gap:             spacing.sm,
        backgroundColor: colors.surface,
        borderRadius:    radius.card,
        marginBottom:    spacing.sm,
    },
    noPlanText: { ...typography.body, color: colors.textSecondary },

    // ── Payment rows ──────────────────────────────────────────────────────────
    paymentRow: {
        flexDirection:   'row',
        justifyContent:  'space-between',
        alignItems:      'center',
        backgroundColor: colors.surface,
        borderRadius:    radius.md,
        padding:         spacing.md,
        marginBottom:    spacing.xs,
        ...shadows.card,
    },
    paymentRowPending: { borderLeftWidth: 3, borderLeftColor: '#F59E0B' },
    paymentLeft:   { flex: 1, gap: 2 },
    paymentPlan:   { ...typography.label, color: colors.textPrimary },
    paymentMeta:   { ...typography.caption, color: colors.textSecondary },
    paymentDate:   { ...typography.caption, color: colors.textSecondary },
    paymentRight:  { alignItems: 'flex-end', gap: spacing.xs },
    paymentAmount: { ...typography.h3, color: colors.textPrimary },
    confirmMiniButton: {
        backgroundColor: '#F59E0B',
        borderRadius:    radius.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical:   4,
    },
    confirmMiniLabel:   { ...typography.micro, color: '#fff', fontWeight: '700' },
    confirmedBadge:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
    confirmedBadgeText: { ...typography.caption, color: '#22C55E', fontWeight: '600' },

    // ── Empty / error ─────────────────────────────────────────────────────────
    emptyState: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
    emptyText:  { ...typography.body, color: colors.textSecondary },
    errorText:  { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md },
    retryBtn:   { paddingVertical: spacing.sm, paddingHorizontal: spacing.xl, backgroundColor: colors.buttonPrimaryBg, borderRadius: radius.md },
    retryLabel: { ...typography.label, color: '#fff' },
});
