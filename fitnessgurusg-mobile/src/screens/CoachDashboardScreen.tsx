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
 *   GET /api/coach/revenue-summary
 *
 * Layout follows the approved coach dashboard:
 *   Navy greeting (the logged-in coach's own name)
 *   Business overview tiles
 *   Assign Workout
 *   Running low, today's sessions, missed check-ins, renewals
 *
 * Need Follow-Up is a calm amber tile when the count is above zero.
 * It is not a red alert card. Hide SGD, streaks, and holiday mode are not here.
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
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography, shadows, palette } from '../theme/theme';
import { fontStyle, useKitFonts } from '../theme/fonts';
import { useAuth } from '../context/AuthContext';
import UserAvatar from '../components/UserAvatar';
import { getDashboard, getClientStatus, getRevenueSummary, RevenueSummary } from '../services/apiClient';
import { DashboardSummary, ClientStatusItem } from '../types';

function getGreeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

function getTodayShort(): string {
    try {
        return new Date().toLocaleDateString('en-SG', {
            weekday: 'long', day: 'numeric', month: 'short',
            timeZone: 'Asia/Singapore',
        }).toUpperCase();
    } catch {
        return new Date().toLocaleDateString();
    }
}

function buildReminderMessage(name: string): string {
    const today = new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
    return `Hi ${name}, just a gentle reminder to submit your daily check-in for today (${today}). Thank you!`;
}

function firstName(fullName: string | undefined): string {
    const trimmed = fullName?.trim() ?? '';
    if (!trimmed) return '';
    return trimmed.split(/\s+/)[0];
}

function sessionLabel(status: 'booked' | 'completed' | 'cancelled'): { label: string; bg: string; color: string } {
    if (status === 'completed') return { label: 'Done', bg: colors.badgeSuccessBg, color: colors.badgeSuccessText };
    if (status === 'cancelled') return { label: 'Missed', bg: colors.surfaceMuted, color: colors.textSecondary };
    return { label: 'Upcoming', bg: '#E7EEF2', color: palette.primary };
}

function StatTile({
    label, value, variant = 'default',
}: {
    label: string; value: number | string; variant?: 'default' | 'navy' | 'urgent';
}) {
    const fonts = useKitFonts();
    const bg       = variant === 'navy' ? palette.primary
                   : variant === 'urgent' ? colors.amberBg
                   : colors.surface;
    const valColor = variant === 'default' ? colors.textPrimary
                   : variant === 'urgent'  ? colors.amberText
                   : colors.statText;
    const lblColor = variant === 'default' ? colors.textSecondary
                   : variant === 'urgent'  ? colors.badgeWarningText
                   : 'rgba(255,255,255,0.75)';
    const border   = variant === 'navy'
        ? { borderWidth: 0 }
        : variant === 'urgent'
            ? { borderWidth: 1, borderColor: colors.amberBorder }
            : { borderWidth: 1, borderColor: colors.border };
    return (
        <View style={[tile.wrap, { backgroundColor: bg }, border]}>
            <Text style={[tile.value, { color: valColor }, fontStyle(fonts.heading, '800')]}>{value}</Text>
            <Text style={[tile.label, { color: lblColor }, fontStyle(fonts.bodyMedium, '600')]} numberOfLines={2}>{label}</Text>
        </View>
    );
}

const tile = StyleSheet.create({
    wrap: {
        flex: 1,
        minHeight: 84,
        borderRadius: radius.card,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.xs,
        alignItems: 'center',
        justifyContent: 'center',
        ...shadows.card,
    },
    value: { fontSize: 26, letterSpacing: -0.5, lineHeight: 32 },
    label: { fontSize: 11, textAlign: 'center', marginTop: 3 },
});

function MissedRow({
    name, issueLabel, onActionPress, onCardPress,
}: {
    name: string; issueLabel: string;
    onActionPress: () => void; onCardPress: () => void;
}) {
    const fonts = useKitFonts();
    return (
        <TouchableOpacity
            style={ac.card} onPress={onCardPress} activeOpacity={0.80}
            accessibilityRole="button" accessibilityLabel={`${name} — ${issueLabel}`}
        >
            <UserAvatar name={name} size={40} bgColor="#FEF3C7" textColor={colors.amberText} />
            <View style={ac.body}>
                <Text style={[ac.name, fontStyle(fonts.bodySemibold, '600')]} numberOfLines={1}>{name}</Text>
                <Text style={[ac.issueTag, fontStyle(fonts.body, '500')]} numberOfLines={2}>{issueLabel}</Text>
            </View>
            <TouchableOpacity
                style={ac.actionBtn} onPress={onActionPress} activeOpacity={0.82}
                accessibilityRole="button" accessibilityLabel={`Remind ${name}`}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
                <Text style={[ac.actionLabel, fontStyle(fonts.bodySemibold, '600')]}>Remind</Text>
            </TouchableOpacity>
        </TouchableOpacity>
    );
}

const ac = StyleSheet.create({
    card: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        backgroundColor: colors.surface,
        borderRadius: radius.card, borderWidth: 1, borderColor: colors.border,
        marginBottom: spacing.sm, padding: spacing.base, ...shadows.card,
    },
    body: { flex: 1 },
    name: { ...typography.label, color: colors.textPrimary, marginBottom: 2 },
    issueTag: { ...typography.caption, color: colors.amberText },
    actionBtn: {
        borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
        backgroundColor: colors.surface,
        paddingVertical: 6, paddingHorizontal: spacing.md,
    },
    actionLabel: { fontSize: 13, color: palette.primary },
});

function EmptyPanel({
    icon, title, subtitle,
}: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    title: string;
    subtitle: string;
}) {
    const fonts = useKitFonts();
    return (
        <View style={s.emptyCard}>
            <View style={s.emptyIcon}>
                <Ionicons name={icon} size={22} color={palette.teal} />
            </View>
            <Text style={[s.emptyTitle, fontStyle(fonts.bodySemibold, '600')]}>{title}</Text>
            <Text style={[s.emptySub, fontStyle(fonts.body, '400')]}>{subtitle}</Text>
        </View>
    );
}

function SectionLabel({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
    const fonts = useKitFonts();
    return (
        <View style={sl.row}>
            <Text style={[sl.title, fontStyle(fonts.bodySemibold, '700')]}>{title}</Text>
            {action && onAction ? (
                <TouchableOpacity onPress={onAction} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={[sl.action, fontStyle(fonts.bodySemibold, '600')]}>{action}</Text>
                </TouchableOpacity>
            ) : null}
        </View>
    );
}

const sl = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
    title: {
        fontSize: 11, letterSpacing: 1.1, color: colors.textSecondary, flex: 1,
    },
    action: { fontSize: 13, color: palette.teal },
});

export default function CoachDashboardScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const fonts = useKitFonts();
    const { user } = useAuth();
    const [loading,    setLoading]    = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error,      setError]      = useState<string | null>(null);

    const [dashboard,    setDashboard]    = useState<DashboardSummary | null>(null);
    const [clientStatus, setClientStatus] = useState<ClientStatusItem[]>([]);
    const [revenue,      setRevenue]      = useState<RevenueSummary | null>(null);

    const loadData = useCallback(async () => {
        try {
            setError(null);
            const [dashResp, statusResp, revResp] = await Promise.all([
                getDashboard(),
                getClientStatus(),
                getRevenueSummary(),
            ]);
            setDashboard(dashResp);
            setClientStatus(statusResp.clients ?? []);
            setRevenue(revResp);
        } catch (err: any) {
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

    const totalClients    = dashboard?.total_clients ?? clientStatus.length;
    const todayBookings   = dashboard?.today_bookings ?? [];
    const lowSessions     = dashboard?.low_session_clients ?? [];
    const pendingPayments = dashboard?.pending_payments_count ?? 0;

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
    const doneClients   = clientStatus.filter(c => c.hasCheckedInToday);
    const missedClients = clientStatus.filter(c => !c.hasCheckedInToday);
    const missedCount   = missedClients.length;

    const coachFirst = firstName(user?.name);
    const greetingLine = coachFirst ? `${getGreeting()}, ${coachFirst}` : getGreeting();
    const needsAction = followUpCount > 0 || missedCount > 0 || lowSessions.length > 0;
    const subtitle = !needsAction
        ? 'All good today. Nothing needs action.'
        : followUpCount > 0
            ? `${followUpCount} client${followUpCount === 1 ? '' : 's'} need you today.`
            : missedCount > 0
                ? `${missedCount} client${missedCount === 1 ? '' : 's'} haven't checked in today.`
                : `${lowSessions.length} plan${lowSessions.length === 1 ? '' : 's'} running low.`;

    const sendReminder = (name: string) => {
        Share.share({ message: buildReminderMessage(name) }).catch(() => {});
    };

    const goToAllClients = () =>
        navigation.navigate('Clients', { initialFilter: 'all' });
    const goToFollowUp = () =>
        navigation.navigate('Clients', { initialFilter: 'followUp' });
    const goToBookings = () =>
        navigation.navigate('Bookings');
    const goToActivePlans = () =>
        navigation.navigate('Clients', { initialFilter: 'activePlan' });
    const goToExpiringSoon = () =>
        navigation.navigate('Clients', { initialFilter: 'renewals' });
    const showRevenuePlaceholder = () =>
        Alert.alert('Revenue Details', 'Revenue details screen coming next.');
    const showRenewalPlaceholder = () =>
        navigation.navigate('Clients', { initialFilter: 'renewals' });
    const goToClientsForWorkout = () =>
        navigation.navigate('Clients');
    const goToInsights = () =>
        navigation.navigate('Insights');

    if (loading) {
        return (
            <View style={[s.screen, s.centered]}>
                <ActivityIndicator size="large" color={palette.primary} />
                <Text style={s.loadingText}>Loading dashboard...</Text>
            </View>
        );
    }

    if (error && !dashboard) {
        return (
            <View style={[s.screen, s.centered]}>
                <Text style={s.errorText}>{error}</Text>
                <TouchableOpacity style={s.retryBtn} onPress={() => { setLoading(true); loadData(); }}>
                    <Text style={s.retryLabel}>Retry</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const expiring = revenue?.expiringSoon ?? 0;

    return (
        <View style={s.screen}>
            <StatusBar barStyle="light-content" backgroundColor={palette.primary} />
            <ScrollView
                contentContainerStyle={s.content}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#FFFFFF" />
                }
            >
                <View style={[s.hero, { paddingTop: insets.top + spacing.md }]}>
                    <Text style={[s.date, fontStyle(fonts.bodySemibold, '600')]}>{getTodayShort()}</Text>
                    <Text style={[s.greeting, fontStyle(fonts.heading, '700')]}>{greetingLine}</Text>
                    <Text style={[s.heroSub, fontStyle(fonts.body, '400')]}>{subtitle}</Text>
                </View>

                <View style={s.sheet}>
                    {pendingPayments > 0 && (
                        <View style={s.pendingBadge}>
                            <Text style={s.pendingText}>
                                {pendingPayments} payment{pendingPayments > 1 ? 's' : ''} to collect — tap Bookings to confirm
                            </Text>
                        </View>
                    )}

                    <SectionLabel title="BUSINESS OVERVIEW" action="Details" onAction={goToInsights} />

                    <View style={rv.tilesRow}>
                        <TouchableOpacity
                            onPress={showRevenuePlaceholder}
                            activeOpacity={0.78}
                            style={{ flex: 1 }}
                            accessibilityRole="button"
                            accessibilityLabel="Revenue this month"
                        >
                            <View style={[rv.tile, rv.tileGreen]}>
                                <Text style={[rv.tileCurrency, { color: '#15803D' }]}>SGD</Text>
                                <Text style={[rv.tileAmount, { color: '#15803D' }, fontStyle(fonts.heading, '800')]}>
                                    {(revenue?.actualRevenue ?? 0).toLocaleString()}
                                </Text>
                                <Text style={[rv.tileLabel, { color: '#166534' }]}>Revenue this month</Text>
                            </View>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={showRenewalPlaceholder}
                            activeOpacity={0.78}
                            style={{ flex: 1 }}
                            accessibilityRole="button"
                            accessibilityLabel="Projected renewals"
                        >
                            <View style={[rv.tile, rv.tileNavy]}>
                                <Text style={[rv.tileCurrency, { color: 'rgba(255,255,255,0.65)' }]}>SGD</Text>
                                <Text style={[rv.tileAmount, { color: '#fff' }, fontStyle(fonts.heading, '800')]}>
                                    {(revenue?.projectedRevenue ?? 0).toLocaleString()}
                                </Text>
                                <Text style={[rv.tileLabel, { color: 'rgba(255,255,255,0.7)' }]}>Projected renewals</Text>
                            </View>
                        </TouchableOpacity>
                    </View>

                    <View style={[rv.tilesRow, { marginTop: spacing.sm }]}>
                        <TouchableOpacity onPress={goToActivePlans} activeOpacity={0.78} style={{ flex: 1 }} accessibilityRole="button">
                            <View style={[rv.tile, rv.tileMuted]}>
                                <Text style={[rv.tileAmount, fontStyle(fonts.heading, '800')]}>{revenue?.activePlans ?? 0}</Text>
                                <Text style={rv.tileLabel}>Active plans</Text>
                            </View>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={goToExpiringSoon} activeOpacity={0.78} style={{ flex: 1 }} accessibilityRole="button">
                            <View style={[rv.tile, expiring > 0 ? rv.tileAmber : rv.tileMuted]}>
                                <Text style={[rv.tileAmount, { color: expiring > 0 ? '#92400E' : colors.textPrimary }, fontStyle(fonts.heading, '800')]}>
                                    {expiring}
                                </Text>
                                <Text style={[rv.tileLabel, { color: expiring > 0 ? '#92400E' : colors.textSecondary }]}>
                                    Expiring soon
                                </Text>
                            </View>
                        </TouchableOpacity>
                    </View>

                    <View style={[s.statsRow, { marginTop: spacing.sm }]}>
                        <TouchableOpacity onPress={goToAllClients} activeOpacity={0.75} style={{ flex: 1 }} accessibilityRole="button">
                            <StatTile label="Total clients" value={totalClients} variant="navy" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={goToFollowUp} activeOpacity={0.75} style={{ flex: 1 }} accessibilityRole="button">
                            <StatTile label="Need follow-up" value={followUpCount} variant={followUpCount > 0 ? 'urgent' : 'default'} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={goToBookings} activeOpacity={0.75} style={{ flex: 1 }} accessibilityRole="button">
                            <StatTile label="Sessions today" value={todayBookings.length} />
                        </TouchableOpacity>
                    </View>

                    <View style={s.section}>
                        <SectionLabel title="QUICK ACTIONS" />
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
                                <Text style={[qa.actionLabel, fontStyle(fonts.bodySemibold, '700')]}>Assign Workout</Text>
                                <Text style={qa.actionSub}>Choose a client to get started</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.55)" />
                        </TouchableOpacity>
                    </View>

                    {lowSessions.length > 0 && (
                        <View style={s.section}>
                            <SectionLabel title="RUNNING LOW · COLLECT PAYMENT" />
                            {lowSessions.map(item => (
                                <View key={item.client_id} style={s.alertRow}>
                                    <UserAvatar name={item.client_name} size={40} />
                                    <View style={s.alertLeft}>
                                        <Text style={s.alertName}>{item.client_name}</Text>
                                        <Text style={s.alertSub}>Expires {item.expiry_date}</Text>
                                    </View>
                                    <View style={s.sessionsBadge}>
                                        <Text style={s.sessionsBadgeNum}>{item.sessions_remaining} left</Text>
                                    </View>
                                </View>
                            ))}
                        </View>
                    )}

                    <View style={s.section}>
                        <SectionLabel title="TODAY'S SESSIONS" />
                        {todayBookings.length === 0 ? (
                            <EmptyPanel
                                icon="time-outline"
                                title="No sessions today"
                                subtitle="Open a slot so clients can book."
                            />
                        ) : (
                            <View style={s.listCard}>
                                {todayBookings.map((b, i) => {
                                    const pill = sessionLabel(b.status);
                                    return (
                                        <View key={b.booking_id}>
                                            <TouchableOpacity style={s.sessionRow} onPress={goToBookings} activeOpacity={0.8}>
                                                <UserAvatar name={b.client_name} size={40} />
                                                <View style={{ flex: 1 }}>
                                                    <Text style={s.alertName} numberOfLines={1}>{b.client_name}</Text>
                                                    <Text style={s.alertSub}>{b.start_time} – {b.end_time}</Text>
                                                </View>
                                                <View style={[s.statusPill, { backgroundColor: pill.bg }]}>
                                                    <Text style={[s.statusPillText, { color: pill.color }]}>{pill.label}</Text>
                                                </View>
                                            </TouchableOpacity>
                                            {i < todayBookings.length - 1 && <View style={s.divider} />}
                                        </View>
                                    );
                                })}
                            </View>
                        )}
                    </View>

                    <View style={s.section}>
                        <SectionLabel title="MISSED CHECK-INS TODAY" />
                        {missedCount === 0 ? (
                            <EmptyPanel
                                icon="checkmark-circle-outline"
                                title="Everyone has checked in"
                                subtitle="No action needed today."
                            />
                        ) : (
                            missedClients.map(client => (
                                <MissedRow
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

                    <View style={s.section}>
                        <SectionLabel title="RENEWALS TO FOLLOW UP" />
                        {(revenue?.expiringClients?.length ?? 0) === 0 ? (
                            <EmptyPanel
                                icon="calendar-outline"
                                title="No renewals due"
                                subtitle="Nothing in the next 30 days."
                            />
                        ) : (
                            <View style={s.listCard}>
                                {revenue!.expiringClients.map((c, i) => {
                                    const expired = c.expiresInDays < 0;
                                    const soon = c.expiresInDays <= 14;
                                    const dayColor = expired ? colors.criticalText : soon ? colors.amberText : colors.textSecondary;
                                    return (
                                        <View key={c.clientId}>
                                            <View style={rv.renewRow}>
                                                <UserAvatar
                                                    name={c.clientName}
                                                    size={40}
                                                    bgColor={expired ? colors.criticalBg : '#FEF3C7'}
                                                    textColor={expired ? colors.criticalText : colors.amberText}
                                                />
                                                <View style={rv.renewInfo}>
                                                    <Text style={rv.renewName} numberOfLines={1}>{c.clientName}</Text>
                                                    <Text style={[rv.renewSub, { color: dayColor }]}>
                                                        {c.planName} · expires in {c.expiresInDays} day{c.expiresInDays !== 1 ? 's' : ''}
                                                    </Text>
                                                </View>
                                                {c.renewalValue > 0 && (
                                                    <View style={rv.renewValueBadge}>
                                                        <Text style={rv.renewValueLabel}>SGD</Text>
                                                        <Text style={rv.renewValueText}>{c.renewalValue.toLocaleString()}</Text>
                                                        <Text style={rv.renewValueSub}>expected</Text>
                                                    </View>
                                                )}
                                            </View>
                                            {i < revenue!.expiringClients.length - 1 && <View style={s.divider} />}
                                        </View>
                                    );
                                })}
                            </View>
                        )}
                    </View>

                    {(revenue?.planBreakdown?.length ?? 0) > 0 && (
                        <View style={s.section}>
                            <SectionLabel title="PLAN MIX" />
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
                                                    <Text style={rv.breakPrice}>SGD {p.revenue.toLocaleString()}</Text>
                                                </View>
                                            </View>
                                        </View>
                                        {i < revenue!.planBreakdown.length - 1 && <View style={s.divider} />}
                                    </View>
                                ))}
                            </View>
                        </View>
                    )}

                    {doneClients.length > 0 && (
                        <View style={s.section}>
                            <SectionLabel title="CHECKED IN TODAY" />
                            <View style={s.listCard}>
                                {doneClients.map((c, i) => (
                                    <View key={c.clientId}>
                                        <View style={s.doneRow}>
                                            <UserAvatar name={c.clientName} size={36} />
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
                </View>
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
    content: { flexGrow: 1, paddingBottom: spacing.xxl },

    loadingText: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md },
    errorText: { ...typography.body, color: colors.criticalText, textAlign: 'center', marginBottom: spacing.md },
    retryBtn:  { backgroundColor: palette.primary, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.xl },
    retryLabel: { ...typography.label, color: '#FFF' },

    hero: {
        backgroundColor: palette.primary,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.xxl,
    },
    date: {
        fontSize: 12,
        letterSpacing: 0.8,
        color: 'rgba(255,255,255,0.7)',
        marginBottom: spacing.sm,
    },
    greeting: {
        fontSize: 28,
        color: '#FFFFFF',
        letterSpacing: -0.4,
        marginBottom: spacing.xs,
    },
    heroSub: { ...typography.body, color: 'rgba(255,255,255,0.78)' },

    sheet: {
        marginTop: -spacing.lg,
        paddingHorizontal: spacing.base,
    },

    pendingBadge: {
        marginBottom: spacing.lg,
        backgroundColor: colors.amberBg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.amberBorder,
        paddingVertical: 8,
        paddingHorizontal: spacing.md,
    },
    pendingText: { fontSize: 12, fontWeight: '600', color: colors.badgeWarningText },

    statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
    section: { marginBottom: spacing.xl },

    listCard: {
        backgroundColor: colors.surface, borderRadius: radius.card,
        borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...shadows.soft,
    },

    emptyCard: {
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        paddingVertical: spacing.lg,
        paddingHorizontal: spacing.base,
        ...shadows.card,
    },
    emptyIcon: {
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: colors.accentSubtle,
        alignItems: 'center', justifyContent: 'center',
        marginBottom: spacing.sm,
    },
    emptyTitle: { fontSize: 15, color: colors.textPrimary, textAlign: 'center' },
    emptySub: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: 2 },

    divider: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.base },

    alertRow: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        backgroundColor: colors.surface, borderRadius: radius.card,
        borderWidth: 1, borderColor: colors.border,
        paddingVertical: spacing.md, paddingHorizontal: spacing.base,
        marginBottom: spacing.sm, ...shadows.card,
    },
    alertLeft: { flex: 1 },
    alertName: { ...typography.label, color: colors.textPrimary },
    alertSub:  { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    sessionsBadge: {
        backgroundColor: colors.amberBg,
        borderRadius: radius.pill,
        paddingVertical: 4,
        paddingHorizontal: spacing.md,
        borderWidth: 1,
        borderColor: colors.amberBorder,
    },
    sessionsBadgeNum: { fontSize: 12, fontWeight: '700', color: colors.amberText },

    sessionRow: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        paddingVertical: spacing.md, paddingHorizontal: spacing.base,
    },
    statusPill: {
        borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: spacing.sm,
    },
    statusPillText: { fontSize: 11, fontWeight: '700' },

    doneRow: {
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: spacing.md, paddingHorizontal: spacing.base, gap: spacing.md,
    },
    doneName: { ...typography.label, color: colors.textPrimary, flex: 1 },
    donePill: {
        backgroundColor: colors.badgeSuccessBg, borderRadius: radius.pill,
        paddingVertical: 3, paddingHorizontal: spacing.sm,
    },
    donePillText: { fontSize: 11, fontWeight: '700', color: colors.badgeSuccessText },
});

const qa = StyleSheet.create({
    actionBtn: {
        flexDirection:   'row',
        alignItems:      'center',
        gap:             spacing.md,
        backgroundColor: palette.tealAction,
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
    actionLabel: { fontSize: 15, color: '#FFFFFF' },
    actionSub: {
        fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2,
    },
});

const rv = StyleSheet.create({
    tilesRow: { flexDirection: 'row', gap: spacing.sm },
    tile: {
        flex: 1,
        minHeight: 96,
        borderRadius: radius.card,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.sm,
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingLeft: spacing.md,
        ...shadows.card,
    },
    tileGreen: { backgroundColor: '#E7F6EC', borderWidth: 0 },
    tileNavy:  { backgroundColor: palette.primary, borderWidth: 0 },
    tileMuted: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    tileAmber: { backgroundColor: '#FFF6E0', borderWidth: 1, borderColor: colors.amberBorder },
    tileCurrency: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, marginBottom: 2 },
    tileAmount: { fontSize: 26, color: colors.textPrimary, letterSpacing: -0.5, lineHeight: 32 },
    tileLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginTop: 4 },

    renewRow: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        paddingVertical: spacing.md, paddingHorizontal: spacing.base,
    },
    renewInfo: { flex: 1 },
    renewName: { ...typography.label, color: colors.textPrimary },
    renewSub:  { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    renewValueBadge: {
        backgroundColor: colors.successBg, borderRadius: radius.md,
        borderWidth: 1, borderColor: colors.successBorder,
        paddingVertical: 4, paddingHorizontal: spacing.sm,
        alignItems: 'center',
    },
    renewValueLabel: { fontSize: 9, fontWeight: '700', color: '#15803D', letterSpacing: 0.6 },
    renewValueText:  { fontSize: 13, fontWeight: '800', color: '#15803D', lineHeight: 18 },
    renewValueSub:   { fontSize: 9, fontWeight: '500', color: '#15803D' },

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
