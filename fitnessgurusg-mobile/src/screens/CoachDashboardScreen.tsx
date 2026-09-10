/**
 * CoachDashboardScreen — Coach Command Center
 *
 * Design principle: "Coach opens app. Knows instantly. Acts immediately."
 *
 * Data sources (real API — no dummy data):
 *   GET /api/coach/dashboard  → total_clients, today_bookings,
 *                               low_session_clients, expiring_clients,
 *                               pending_payments_count
 *   GET /api/clients/status   → hasCheckedInToday per client (action queue)
 *
 * ─── Layout ───────────────────────────────────────────────────────────────────
 *   1. Greeting + date
 *   2. Today Overview  — stat tiles (Total / Needs Attention / Today's Sessions)
 *   3. Action Required — clients who haven't checked in today
 *   4. Today's Sessions — confirmed bookings for today
 *   5. Low-Session Alerts — clients with ≤ 2 sessions left
 */

import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    RefreshControl,
    StatusBar,
    Share,
    Alert,
    ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography, shadows } from '../theme/theme';
import { getDashboard, getClientStatus, getRevenueSummary, RevenueSummary } from '../services/apiClient';
import { DashboardSummary, ClientStatusItem } from '../types';

// ─── Constants ────────────────────────────────────────────────────────────────

const NAVY  = '#183A4A';  // Primary Navy — per spec
const RED   = '#C0392B';  // Critical only — expired / serious alert
const AMBER = '#B45309';  // Attention / follow-up — NOT emergency

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

function getTodayLong(): string {
    try {
        return new Date().toLocaleDateString('en-SG', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        });
    } catch {
        return new Date().toLocaleDateString();
    }
}

function buildReminderMessage(name: string): string {
    const today = new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
    return `Hi ${name}, just a gentle reminder to submit your daily check-in for today (${today}). Thank you!`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatTile({
    label, value, variant = 'default',
}: {
    label: string; value: number | string; variant?: 'default' | 'navy' | 'urgent';
}) {
    // Follow-up/attention tile uses amber (not red) — coach needs to act, but it's not a crisis
    const bg       = variant === 'navy' ? NAVY
                   : variant === 'urgent' ? '#FFFBEB'
                   : colors.surface;
    const valColor = variant === 'default' ? colors.textPrimary
                   : variant === 'urgent'  ? AMBER
                   : '#FFF';
    const lblColor = variant === 'default' ? colors.textSecondary
                   : variant === 'urgent'  ? '#92400E'
                   : 'rgba(255,255,255,0.75)';
    const border   = variant === 'default' ? { borderWidth: 1, borderColor: colors.border }
                   : variant === 'urgent'  ? { borderWidth: 1, borderColor: '#FDE68A' }
                   : {};
    return (
        <View style={[tile.wrap, { backgroundColor: bg }, border]}>
            <Text style={[tile.value, { color: valColor }]}>{value}</Text>
            <Text style={[tile.label, { color: lblColor }]}>{label}</Text>
        </View>
    );
}

const tile = StyleSheet.create({
    wrap: {
        flex: 1, borderRadius: radius.card,
        paddingVertical: spacing.md, paddingHorizontal: spacing.xs,
        alignItems: 'center', ...shadows.card,
    },
    value: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5, lineHeight: 34 },
    label: { fontSize: 11, fontWeight: '600', textAlign: 'center', marginTop: 3, letterSpacing: 0.2 },
});

function ActionCard({
    name, issueLabel, onActionPress, onCardPress,
}: {
    name: string; issueLabel: string;
    onActionPress: () => void; onCardPress: () => void;
}) {
    return (
        <TouchableOpacity
            style={ac.card} onPress={onCardPress} activeOpacity={0.80}
            accessibilityRole="button" accessibilityLabel={`${name} — ${issueLabel}`}
        >
            <View style={ac.strip} />
            <View style={ac.body}>
                <View style={ac.topRow}>
                    <Text style={ac.name} numberOfLines={1}>{name}</Text>
                    <Text style={ac.issueTag}>{issueLabel}</Text>
                </View>
                <TouchableOpacity
                    style={ac.actionBtn} onPress={onActionPress} activeOpacity={0.82}
                    accessibilityRole="button" accessibilityLabel="Send reminder"
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                    <Text style={ac.actionLabel}>WhatsApp reminder</Text>
                </TouchableOpacity>
            </View>
        </TouchableOpacity>
    );
}

const ac = StyleSheet.create({
    card: {
        flexDirection: 'row', backgroundColor: colors.surface,
        borderRadius: radius.card, borderWidth: 1, borderColor: colors.border,
        marginBottom: spacing.sm, overflow: 'hidden', ...shadows.card,
    },
    strip: { width: 4, backgroundColor: AMBER },    // amber = follow-up attention, not emergency
    body: { flex: 1, padding: spacing.base },
    topRow: { marginBottom: spacing.sm },
    name: { ...typography.h3, color: colors.textPrimary, marginBottom: 3 },
    issueTag: { ...typography.caption, color: AMBER, fontWeight: '600' },
    actionBtn: {
        alignSelf: 'flex-start', backgroundColor: NAVY,
        borderRadius: radius.md, paddingVertical: 7, paddingHorizontal: spacing.md,
    },
    actionLabel: { fontSize: 13, fontWeight: '700', color: '#FFF', letterSpacing: 0.2 },
});

function BookingRow({
    clientName, startTime, endTime, status,
}: {
    clientName: string; startTime: string; endTime: string;
    status: 'booked' | 'completed' | 'cancelled';
}) {
    const statusColor = status === 'completed' ? '#059669' : status === 'cancelled' ? RED : NAVY;
    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
    return (
        <View style={br.row}>
            <View style={br.avatar}>
                <Text style={br.avatarText}>{clientName.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={br.info}>
                <Text style={br.clientName} numberOfLines={1}>{clientName}</Text>
                <Text style={br.time}>{startTime} – {endTime}</Text>
            </View>
            <View style={[br.badge, { backgroundColor: statusColor + '22' }]}>
                <Text style={[br.badgeText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
        </View>
    );
}

const br = StyleSheet.create({
    row: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        paddingVertical: spacing.md, paddingHorizontal: spacing.base,
    },
    avatar: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: colors.accentSubtle, alignItems: 'center', justifyContent: 'center',
    },
    avatarText: { fontSize: 14, fontWeight: '700', color: colors.accent },
    info: { flex: 1 },
    clientName: { ...typography.label, color: colors.textPrimary },
    time: { ...typography.caption, color: colors.textSecondary },
    badge: {
        borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: spacing.sm,
    },
    badgeText: { fontSize: 11, fontWeight: '700' },
});

function SectionLabel({ title, count, urgent }: { title: string; count: number; urgent?: boolean }) {
    return (
        <View style={sl.row}>
            <Text style={sl.title}>{title.toUpperCase()}</Text>
            <View style={[sl.pill, urgent && { backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FDE68A' }]}>
                <Text style={[sl.count, urgent && { color: AMBER }]}>{count}</Text>
            </View>
        </View>
    );
}

const sl = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
    title: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: colors.textSecondary, flex: 1 },
    pill: {
        minWidth: 22, height: 22, borderRadius: radius.pill,
        backgroundColor: colors.accentSubtle, alignItems: 'center', justifyContent: 'center',
        paddingHorizontal: spacing.sm,
    },
    count: { fontSize: 11, fontWeight: '800', color: colors.accent },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CoachDashboardScreen({ navigation }: any) {
    const [loading,    setLoading]    = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error,      setError]      = useState<string | null>(null);

    // Real API data
    const [dashboard,    setDashboard]    = useState<DashboardSummary | null>(null);
    const [clientStatus, setClientStatus] = useState<ClientStatusItem[]>([]);
    const [revenue,      setRevenue]      = useState<RevenueSummary | null>(null);

    const insets = useSafeAreaInsets();

    // ── Data fetch ────────────────────────────────────────────────────────────

    const loadData = useCallback(async () => {
        try {
            setError(null);
            console.log('[Dashboard] fetching real data from API...');

            // Parallel fetch: dashboard summary + client status + revenue
            const [dashResp, statusResp, revResp] = await Promise.all([
                getDashboard(),
                getClientStatus(),
                getRevenueSummary(),
            ]);

            console.log('[Dashboard] dashboard response:', JSON.stringify(dashResp, null, 2));
            console.log('[Dashboard] client status count:', statusResp.clients?.length ?? 0);
            console.log('[Dashboard] revenue:', revResp.actualRevenue);

            setDashboard(dashResp);
            setClientStatus(statusResp.clients ?? []);
            setRevenue(revResp);
        } catch (err: any) {
            console.error('[Dashboard] fetch error:', err.message);
            setError(err.message ?? 'Failed to load dashboard.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useFocusEffect(useCallback(() => {
        setLoading(true);
        loadData();
    }, [loadData]));

    const handleRefresh = () => {
        setRefreshing(true);
        loadData();
    };

    // ── Derived values from real data ─────────────────────────────────────────

    const totalClients    = dashboard?.total_clients ?? clientStatus.length;
    const todayBookings   = dashboard?.today_bookings ?? [];
    const lowSessions     = dashboard?.low_session_clients ?? [];
    const pendingPayments = dashboard?.pending_payments_count ?? 0;

    // Follow-Up = payment/session renewal follow-up.
    // Mirrors getRenewalBadge() logic on the raw ClientStatusItem shape:
    //   plan expired | 0 sessions | <= 2 sessions | expiry within 30 days
    // No-plan clients are NOT counted here (they belong in No Plan filter).
    const RENEWAL_LOW   = 2;
    const RENEWAL_DAYS  = 30;
    const isRenewalNeeded = (c: ClientStatusItem): boolean => {
        if (c.plan_status === 'expired') return true;
        if (c.sessions_remaining != null) {
            if (c.sessions_remaining <= RENEWAL_LOW) return true;
        }
        if (c.expiry_date) {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const exp   = new Date(`${c.expiry_date}T00:00:00`);
            const days  = Math.round((exp.getTime() - today.getTime()) / 86_400_000);
            if (days >= 0 && days <= RENEWAL_DAYS) return true;
        }
        return false;
    };
    const followUpCount = clientStatus.filter(isRenewalNeeded).length;

    // "All Good" section — clients who checked in today
    const doneClients   = clientStatus.filter(c => c.hasCheckedInToday);

    // "Missed Check-Ins Today" section — clients who have NOT checked in.
    // Separate from Follow-Up (which is payment/renewal) — same source data,
    // different meaning.
    const missedClients = clientStatus.filter(c => !c.hasCheckedInToday);
    const missedCount   = missedClients.length;

    // ── Action handlers ───────────────────────────────────────────────────────

    const sendReminder = (name: string) => {
        Share.share({ message: buildReminderMessage(name) }).catch(() => {});
    };

    // ── Navigation handlers ───────────────────────────────────────────────────

    /** Total Clients tile → Clients tab, All filter */
    const goToAllClients = () =>
        navigation.navigate('Clients', { initialFilter: 'all' });

    /** Need Follow-Up tile → Clients tab, Follow-Up (payment/renewal) filter */
    const goToFollowUp = () =>
        navigation.navigate('Clients', { initialFilter: 'followUp' });

    /** Sessions Today tile → Bookings tab */
    const goToBookings = () =>
        navigation.navigate('Bookings');

    /** Active Plans tile → Clients tab, Active Plan filter (plan_status === active | expiring_soon) */
    const goToActivePlans = () =>
        navigation.navigate('Clients', { initialFilter: 'activePlan' });

    /** Expiring Soon tile → Clients tab, Renewals filter */
    const goToExpiringSoon = () =>
        navigation.navigate('Clients', { initialFilter: 'renewals' });

    /** Revenue This Month — no detail screen yet */
    const showRevenuePlaceholder = () =>
        Alert.alert('Revenue Details', 'Revenue details screen coming next.');

    /** Projected Renewals → Clients tab, Renewals filter */
    const showRenewalPlaceholder = () =>
        navigation.navigate('Clients', { initialFilter: 'renewals' });

    /** Assign Workout quick action → Clients tab (coach selects a client, then
     * uses the existing Assign Workout button in Client Details) */
    const goToClientsForWorkout = () =>
        navigation.navigate('Clients');

    // ── Loading state ─────────────────────────────────────────────────────────

    if (loading) {
        return (
            <View style={[s.screen, s.centered]}>
                <ActivityIndicator size="large" color={NAVY} />
                <Text style={s.loadingText}>Loading dashboard...</Text>
            </View>
        );
    }

    // ── Error state ───────────────────────────────────────────────────────────

    if (error && !dashboard) {
        return (
            <View style={[s.screen, s.centered]}>
                <Text style={s.errorText}>⚠ {error}</Text>
                <TouchableOpacity style={s.retryBtn} onPress={() => { setLoading(true); loadData(); }}>
                    <Text style={s.retryLabel}>Retry</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // ── Main render ───────────────────────────────────────────────────────────

    return (
        <ScrollView
            style={s.screen}
            contentContainerStyle={[s.content, { paddingTop: insets.top + spacing.xl }]}
            showsVerticalScrollIndicator={false}
            refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={NAVY} />
            }
        >
            <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

            {/* ── 1. GREETING ──────────────────────────────────────────────── */}
            <View style={s.greetingBlock}>
                <Text style={s.greeting}>{getGreeting()}, Coach</Text>
                <Text style={s.date}>{getTodayLong()}</Text>
                {pendingPayments > 0 && (
                    <View style={s.pendingBadge}>
                        <Text style={s.pendingText}>
                            {pendingPayments} payment{pendingPayments > 1 ? 's' : ''} to collect — tap Bookings to confirm
                        </Text>
                    </View>
                )}
            </View>

            {/* ── 2. BUSINESS OVERVIEW ─────────────────────────────────────── */}
            <View style={s.section}>
                <SectionLabel title="Business Overview" count={revenue?.activePlans ?? 0} />

                {/* Revenue metric tiles — row 1 */}
                <View style={rv.tilesRow}>
                    {/* Revenue This Month — placeholder alert (no detail screen yet) */}
                    <TouchableOpacity
                        onPress={showRevenuePlaceholder}
                        activeOpacity={0.78}
                        style={{ flex: 1 }}
                        accessibilityRole="button"
                        accessibilityLabel="Revenue this month"
                    >
                        <View style={[rv.tile, rv.tileGreen]}>
                            <Text style={[rv.tileCurrency, { color: '#15803D' }]}>SGD</Text>
                            <Text style={[rv.tileAmount, { color: '#15803D' }]}>
                                {(revenue?.actualRevenue ?? 0).toLocaleString()}
                            </Text>
                            <Text style={[rv.tileLabel, { color: '#166534' }]}>Revenue This Month</Text>
                        </View>
                    </TouchableOpacity>

                    {/* Projected Renewals — placeholder alert (renewal list is below on same screen) */}
                    <TouchableOpacity
                        onPress={showRenewalPlaceholder}
                        activeOpacity={0.78}
                        style={{ flex: 1 }}
                        accessibilityRole="button"
                        accessibilityLabel="Projected renewals"
                    >
                        <View style={[rv.tile, rv.tileNavy]}>
                            <Text style={[rv.tileCurrency, { color: 'rgba(255,255,255,0.65)' }]}>SGD</Text>
                            <Text style={[rv.tileAmount, { color: '#fff' }]}>
                                {(revenue?.projectedRevenue ?? 0).toLocaleString()}
                            </Text>
                            <Text style={[rv.tileLabel, { color: 'rgba(255,255,255,0.7)' }]}>Projected Renewals</Text>
                        </View>
                    </TouchableOpacity>
                </View>

                {/* Revenue metric tiles — row 2 */}
                <View style={[rv.tilesRow, { marginTop: spacing.sm }]}>
                    {/* Active Plans → Clients tab (active filter) */}
                    <TouchableOpacity
                        onPress={goToActivePlans}
                        activeOpacity={0.78}
                        style={{ flex: 1 }}
                        accessibilityRole="button"
                        accessibilityLabel="View active plan clients"
                    >
                        <View style={[rv.tile, rv.tileMuted]}>
                            <Text style={rv.tileAmount}>{revenue?.activePlans ?? 0}</Text>
                            <Text style={rv.tileLabel}>Active Plans</Text>
                        </View>
                    </TouchableOpacity>

                    {/* Expiring Soon → Clients tab (all filter — TODO: add expiring filter) */}
                    {(() => {
                        const expiring = revenue?.expiringSoon ?? 0;
                        const isAmber  = expiring > 0;
                        return (
                            <TouchableOpacity
                                onPress={goToExpiringSoon}
                                activeOpacity={0.78}
                                style={{ flex: 1 }}
                                accessibilityRole="button"
                                accessibilityLabel="View expiring plan clients"
                            >
                                <View style={[rv.tile, isAmber ? rv.tileAmber : rv.tileMuted]}>
                                    <Text style={[rv.tileAmount, { color: isAmber ? '#92400E' : colors.textPrimary }]}>
                                        {expiring}
                                    </Text>
                                    <Text style={[rv.tileLabel, { color: isAmber ? '#92400E' : colors.textSecondary }]}>
                                        Expiring Soon
                                    </Text>
                                </View>
                            </TouchableOpacity>
                        );
                    })()}
                </View>
            </View>

            {/* ── 3. STAT TILES ────────────────────────────────────────────── */}
            <View style={s.statsRow}>
                {/* Total Clients → Clients (All) */}
                <TouchableOpacity
                    onPress={goToAllClients}
                    activeOpacity={0.75}
                    style={{ flex: 1 }}
                    accessibilityRole="button"
                    accessibilityLabel="View all clients"
                >
                    <StatTile label="Total Clients" value={totalClients} variant="navy" />
                </TouchableOpacity>

                {/* Need Follow-Up → Clients (Follow-Up = payment/renewal filter) */}
                <TouchableOpacity
                    onPress={goToFollowUp}
                    activeOpacity={0.75}
                    style={{ flex: 1 }}
                    accessibilityRole="button"
                    accessibilityLabel="View clients needing follow-up"
                >
                    <StatTile label="Need Follow-Up" value={followUpCount} variant={followUpCount > 0 ? 'urgent' : 'default'} />
                </TouchableOpacity>

                {/* Sessions Today → Bookings tab */}
                <TouchableOpacity
                    onPress={goToBookings}
                    activeOpacity={0.75}
                    style={{ flex: 1 }}
                    accessibilityRole="button"
                    accessibilityLabel="View today's sessions"
                >
                    <StatTile label="Sessions Today" value={todayBookings.length} variant="default" />
                </TouchableOpacity>
            </View>

            {/* ── 4. QUICK ACTIONS ──────────────────────────────────────────── */}
            <View style={s.section}>
                <View style={qa.header}>
                    <Text style={qa.sectionTitle}>QUICK ACTIONS</Text>
                </View>

                {/* Assign Workout — coach picks the client on the next screen */}
                <TouchableOpacity
                    style={qa.actionBtn}
                    onPress={goToClientsForWorkout}
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityLabel="Assign workout — choose a client"
                >
                    <View style={qa.iconWrap}>
                        <Ionicons name="barbell-outline" size={20} color="#FFFFFF" />
                    </View>
                    <View style={qa.textBlock}>
                        <Text style={qa.actionLabel}>Assign Workout</Text>
                        <Text style={qa.actionSub}>Choose a client to get started</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.55)" />
                </TouchableOpacity>
            </View>

            <View style={s.section}>
                <Text style={rv.subLabel}>RENEWALS TO FOLLOW UP</Text>

                {(revenue?.expiringClients?.length ?? 0) === 0 ? (
                    <View style={rv.emptyRenewCard}>
                        <Text style={rv.emptyRenewIcon}>🗓</Text>
                        <Text style={rv.emptyRenewText}>No renewals due in the next 30 days.</Text>
                    </View>
                ) : (
                    <View style={s.listCard}>
                        {revenue!.expiringClients.map((c, i) => {
                            const urgent   = c.expiresInDays <= 7;
                            const soon     = c.expiresInDays <= 14;
                            const dayColor = urgent ? RED : soon ? '#92400E' : colors.textSecondary;
                            return (
                                <View key={c.clientId}>
                                    <View style={rv.renewRow}>
                                        <View style={[rv.renewAvatar, urgent && { backgroundColor: '#FEE2E2' }]}>
                                            <Text style={[rv.renewAvatarText, urgent && { color: RED }]}>
                                                {c.clientName.charAt(0).toUpperCase()}
                                            </Text>
                                        </View>
                                        <View style={rv.renewInfo}>
                                            <Text style={rv.renewName} numberOfLines={1}>{c.clientName}</Text>
                                            <Text style={[rv.renewSub, { color: dayColor }]}>
                                                {c.planName} · expires in {c.expiresInDays} day{c.expiresInDays !== 1 ? 's' : ''}
                                            </Text>
                                        </View>
                                        {c.renewalValue > 0 && (
                                            <View style={rv.renewValueBadge}>
                                                <Text style={rv.renewValueLabel}>SGD</Text>
                                                <Text style={rv.renewValueText}>
                                                    {c.renewalValue.toLocaleString()}
                                                </Text>
                                                <Text style={rv.renewValueSub}>expected</Text>
                                            </View>
                                        )}
                                    </View>
                                    {i < revenue!.expiringClients.length - 1 && (
                                        <View style={s.divider} />
                                    )}
                                </View>
                            );
                        })}
                    </View>
                )}
            </View>

            {/* ── 5. PLAN MIX ──────────────────────────────────────────────────── */}
            {(revenue?.planBreakdown?.length ?? 0) > 0 && (
                <View style={s.section}>
                    <Text style={rv.subLabel}>PLAN MIX</Text>
                    <View style={s.listCard}>
                        {revenue!.planBreakdown.map((p, i) => (
                            <View key={p.planName}>
                                <View style={rv.breakRow}>
                                    <Text style={rv.breakName} numberOfLines={1}>{p.planName}</Text>
                                    <View style={rv.breakRight}>
                                        <Text style={rv.breakCount}>
                                            {p.count} client{p.count !== 1 ? 's' : ''}
                                        </Text>
                                        <View style={rv.breakPricePill}>
                                            <Text style={rv.breakPrice}>
                                                SGD {p.revenue.toLocaleString()}
                                            </Text>
                                        </View>
                                    </View>
                                </View>
                                {i < revenue!.planBreakdown.length - 1 && (
                                    <View style={s.divider} />
                                )}
                            </View>
                        ))}
                    </View>
                </View>
            )}

            {/* ── 6. LOW SESSION ALERTS ──────────────────────────────────── */}
            {lowSessions.length > 0 && (
                <View style={s.section}>
                    <SectionLabel title="Running Low — Collect Payment" count={lowSessions.length} urgent />
                    {lowSessions.map(item => (
                        <View key={item.client_id} style={s.alertRow}>
                            <View style={s.alertLeft}>
                                <Text style={s.alertName}>{item.client_name}</Text>
                                <Text style={s.alertSub}>Expires {item.expiry_date}</Text>
                            </View>
                            <View style={s.sessionsBadge}>
                                <Text style={s.sessionsBadgeNum}>{item.sessions_remaining}</Text>
                                <Text style={s.sessionsBadgeLabel}>left</Text>
                            </View>
                        </View>
                    ))}
                </View>
            )}

            {/* ── 7. MISSED CHECK-INS TODAY ──────────────────────────────── */}
            <View style={s.section}>
                <SectionLabel title="Missed Check-Ins Today" count={missedCount} urgent={missedCount > 0} />
                {missedCount === 0 ? (
                    <View style={s.emptyCard}>
                        <Text style={s.emptyText}>✓  Everyone has checked in — no action needed</Text>
                    </View>
                ) : (
                    missedClients.map(client => (
                        <ActionCard
                            key={client.clientId}
                            name={client.clientName}
                            issueLabel={
                                client.lastCheckInDate
                                    ? `Last seen ${client.lastCheckInDate} — no check-in today`
                                    : 'Never checked in — send them a link'
                            }
                            onActionPress={() => sendReminder(client.clientName)}
                            onCardPress={goToFollowUp}
                        />
                    ))
                )}
            </View>

            {/* ── 9. ALL GOOD TODAY ─────────────────────────────────────────── */}
            {doneClients.length > 0 && (
                <View style={s.section}>
                    <SectionLabel title="All Good Today" count={doneClients.length} />
                    <View style={s.listCard}>
                        {doneClients.map((c, i) => (
                            <View key={c.clientId}>
                                <View style={s.doneRow}>
                                    <View style={s.doneAvatar}>
                                        <Text style={s.doneAvatarText}>{c.clientName.charAt(0).toUpperCase()}</Text>
                                    </View>
                                    <Text style={s.doneName} numberOfLines={1}>{c.clientName}</Text>
                                    <View style={s.donePill}>
                                        <Text style={s.donePillText}>Done</Text>
                                    </View>
                                </View>
                                {i < doneClients.length - 1 && <View style={s.divider} />}
                            </View>
                        ))}
                    </View>
                </View>
            )}

            <View style={{ height: spacing.xxl }} />
        </ScrollView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
    content: { flexGrow: 1, paddingHorizontal: spacing.xl },

    loadingText: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md },

    errorText: { ...typography.body, color: RED, textAlign: 'center', marginBottom: spacing.md },
    retryBtn:  { backgroundColor: NAVY, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.xl },
    retryLabel: { ...typography.label, color: '#FFF', fontWeight: '700' },

    greetingBlock: { marginBottom: spacing.xl },
    greeting: { fontSize: 26, fontWeight: '800', color: NAVY, letterSpacing: -0.4, marginBottom: spacing.xs },
    date: { ...typography.body, color: colors.textSecondary },

    pendingBadge: {
        marginTop: spacing.sm, backgroundColor: '#FEF3C7',
        borderRadius: radius.md, paddingVertical: 6, paddingHorizontal: spacing.md,
        alignSelf: 'flex-start',
    },
    pendingText: { fontSize: 12, fontWeight: '600', color: '#92400E' },

    statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },

    section: { marginBottom: spacing.xl },

    listCard: {
        backgroundColor: colors.surface, borderRadius: radius.card,
        borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...shadows.card,
    },

    emptyCard: {
        backgroundColor: colors.surface, borderRadius: radius.card,
        borderWidth: 1, borderColor: colors.successBorder,
        paddingVertical: spacing.lg, alignItems: 'center', ...shadows.card,
    },
    emptyText: { ...typography.body, color: colors.badgeSuccessText, fontWeight: '500' },

    divider: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.base },

    // Alert rows (low sessions)
    alertRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: colors.surface, borderRadius: radius.card,
        borderWidth: 1, borderColor: colors.border,
        paddingVertical: spacing.md, paddingHorizontal: spacing.base,
        marginBottom: spacing.sm, ...shadows.card,
    },
    alertLeft: { flex: 1 },
    alertName: { ...typography.label, color: colors.textPrimary },
    alertSub:  { ...typography.caption, color: colors.textSecondary },
    sessionsBadge: {
        alignItems: 'center', backgroundColor: RED + '15',
        borderRadius: radius.md, paddingVertical: 4, paddingHorizontal: spacing.md,
    },
    sessionsBadgeNum:   { fontSize: 22, fontWeight: '800', color: RED, lineHeight: 26 },
    sessionsBadgeLabel: { fontSize: 10, fontWeight: '600', color: RED },

    // Checked-in rows
    doneRow: {
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: spacing.md, paddingHorizontal: spacing.base, gap: spacing.md,
    },
    doneAvatar: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: colors.accentSubtle, alignItems: 'center', justifyContent: 'center',
    },
    doneAvatarText: { fontSize: 14, fontWeight: '700', color: colors.accent },
    doneName: { ...typography.label, color: colors.textPrimary, flex: 1 },
    donePill: {
        backgroundColor: colors.badgeSuccessBg, borderRadius: radius.pill,
        borderWidth: 1, borderColor: colors.successBorder,
        paddingVertical: 3, paddingHorizontal: spacing.sm,
    },
    donePillText: { fontSize: 11, fontWeight: '700', color: colors.badgeSuccessText },
});

// ─── Quick Actions styles ─────────────────────────────────────────────────────

const TEAL = '#0D7B76'; // Teal action color — distinct from NAVY, signals "do something"

const qa = StyleSheet.create({
    header: {
        flexDirection:  'row',
        alignItems:     'center',
        marginBottom:   spacing.sm,
    },
    sectionTitle: {
        fontSize:      11,
        fontWeight:    '800',
        letterSpacing: 1.2,
        color:         colors.textSecondary,
    },

    // Single-action button: icon + text block + chevron, full-width card
    actionBtn: {
        flexDirection:   'row',
        alignItems:      'center',
        gap:             spacing.md,
        backgroundColor: TEAL,
        borderRadius:    radius.card,
        paddingVertical:   spacing.base,
        paddingHorizontal: spacing.base,
        ...shadows.card,
    },
    iconWrap: {
        width:           40,
        height:          40,
        borderRadius:    radius.md,
        backgroundColor: 'rgba(255,255,255,0.18)',
        alignItems:      'center',
        justifyContent:  'center',
    },
    textBlock: { flex: 1 },
    actionLabel: {
        fontSize:      15,
        fontWeight:    '700',
        color:         '#FFFFFF',
        letterSpacing: -0.1,
    },
    actionSub: {
        fontSize:   12,
        fontWeight: '500',
        color:      'rgba(255,255,255,0.70)',
        marginTop:  2,
    },
});

// ─── Revenue section styles ───────────────────────────────────────────────────

const rv = StyleSheet.create({
    tilesRow: { flexDirection: 'row', gap: spacing.sm },
    tile: {
        flex: 1, borderRadius: radius.card, paddingVertical: spacing.md,
        paddingHorizontal: spacing.sm, alignItems: 'center', ...shadows.card,
    },
    tileGreen: { backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0' },
    tileNavy:  { backgroundColor: NAVY },
    tileMuted: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    tileAmber: { backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FCD34D' },

    // "SGD" label that sits above the numeric amount on currency tiles
    tileCurrency: {
        fontSize: 9, fontWeight: '700', letterSpacing: 0.8,
        marginBottom: 1,
    },
    tileAmount: {
        fontSize: 22, fontWeight: '800', color: colors.textPrimary,
        letterSpacing: -0.5, lineHeight: 28,
    },
    tileLabel: {
        fontSize: 10, fontWeight: '600', color: colors.textSecondary,
        textAlign: 'center', marginTop: 3,
    },

    subLabel: {
        fontSize: 10, fontWeight: '800', letterSpacing: 1.1,
        color: colors.textSecondary, marginBottom: spacing.sm,
    },

    // Empty state — "No renewals due"
    emptyRenewCard: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        backgroundColor: colors.surface, borderRadius: radius.card,
        borderWidth: 1, borderColor: colors.border,
        paddingVertical: spacing.lg, paddingHorizontal: spacing.base,
        ...shadows.card,
    },
    emptyRenewIcon: { fontSize: 20 },
    emptyRenewText: {
        ...typography.body, color: colors.textSecondary,
        fontWeight: '500', flex: 1,
    },

    // Renewal follow-up rows
    renewRow: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        paddingVertical: spacing.md, paddingHorizontal: spacing.base,
    },
    renewAvatar: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center',
    },
    renewAvatarText: { fontSize: 14, fontWeight: '700', color: '#92400E' },
    renewInfo: { flex: 1 },
    renewName: { ...typography.label, color: colors.textPrimary },
    renewSub:  { ...typography.caption, color: colors.textSecondary },
    renewValueBadge: {
        backgroundColor: '#F0FDF4', borderRadius: radius.md,
        borderWidth: 1, borderColor: '#BBF7D0',
        paddingVertical: 4, paddingHorizontal: spacing.sm,
        alignItems: 'center',
    },
    renewValueLabel: { fontSize: 9, fontWeight: '700', color: '#15803D', letterSpacing: 0.6 },
    renewValueText:  { fontSize: 13, fontWeight: '800', color: '#15803D', lineHeight: 18 },
    renewValueSub:   { fontSize: 9,  fontWeight: '500', color: '#15803D', letterSpacing: 0.2 },

    // Plan breakdown rows
    breakRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingVertical: spacing.md, paddingHorizontal: spacing.base,
    },
    breakName:  { ...typography.label, color: colors.textPrimary, flex: 1 },
    breakRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    breakCount: { ...typography.caption, color: colors.textSecondary },
    breakPricePill: {
        backgroundColor: colors.accentSubtle, borderRadius: radius.pill,
        paddingVertical: 3, paddingHorizontal: spacing.sm,
    },
    breakPrice: { fontSize: 11, fontWeight: '700', color: colors.accent },
});

