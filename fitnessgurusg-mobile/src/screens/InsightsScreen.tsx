/**
 * InsightsScreen — Business Intelligence Dashboard for FitnessGuruSG Coach
 *
 * Four sections, all powered by EXISTING endpoints (no backend changes):
 *
 *  1. Business Insights      ← GET /api/coach/revenue-summary
 *     Revenue This Month · Projected Renewals · Active Plans · Expiring Soon
 *
 *  2. Renewals to Follow Up  ← same revenue-summary (expiringClients[])
 *     Per-client name · plan · days until expiry · SGD value expected
 *     Empty state when none due in 30 days
 *
 *  3. Booking Performance    ← GET /api/coach/dashboard (today_bookings)
 *     Booked · Done · Missed · Booking rate (booked / (booked+open))
 *
 *  4. Client Attention       ← GET /api/clients/status
 *     No check-in today · Low sessions (≤3) · Plan expiring soon
 *     Sorted: most urgent first
 *
 * Safety: Zero changes to payment/booking/check-in/auth/plan logic.
 */

import React, { useCallback, useState } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius, typography, shadows, palette } from '../theme/theme';
import { fontStyle, useKitFonts } from '../theme/fonts';
import {
    getRevenueSummary,
    getDashboard,
    getClientStatus,
    getAvailability,
    RevenueSummary,
} from '../services/apiClient';
import { ClientStatusItem, DashboardSummary } from '../types';

// ─── Constants ────────────────────────────────────────────────────────────────

const NAVY  = '#183A4A';  // Primary Navy — per spec
const GREEN = '#16A34A';  // Success Green
const RED   = '#DC2626';  // Danger Red — critical only (expired / serious)
const AMBER = '#B45309';  // Deep amber — follow-up / attention (not emergency)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sgd(amount: number): string {
    return `SGD ${amount.toLocaleString()}`;
}

function todaySGT(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

function currentMonth(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' }).slice(0, 7);
}

/** Days between two YYYY-MM-DD strings (positive = future) */
function daysUntil(dateStr: string): number {
    const todayStr = todaySGT();
    const today = new Date(`${todayStr}T00:00:00+08:00`);
    const target = new Date(`${dateStr}T00:00:00+08:00`);
    return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Styled section label */
function SectionLabel({ title }: { title: string }) {
    return <Text style={s.sectionLabel}>{title}</Text>;
}

/** Full-width divider inside a card */
function Divider() {
    return <View style={s.divider} />;
}

/** Error inline card with retry */
function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <View style={s.errorCard}>
            <Text style={s.errorMsg}>{message}</Text>
            <TouchableOpacity style={s.retryBtn} onPress={onRetry}>
                <Text style={s.retryTxt}>Retry</Text>
            </TouchableOpacity>
        </View>
    );
}

// ─── Section 1: Business Insights ─────────────────────────────────────────────

interface BusinessTileProps {
    label: string;
    value: string;
    variant: 'green' | 'navy' | 'muted' | 'amber';
}

function BusinessTile({ label, value, variant }: BusinessTileProps) {
    const bg    = variant === 'green' ? '#F0FDF4'
                : variant === 'navy'  ? NAVY
                : variant === 'amber' ? '#FEF3C7'
                : colors.surface;
    const valClr = variant === 'navy'  ? '#fff'
                 : variant === 'green' ? '#15803D'
                 : variant === 'amber' ? AMBER
                 : colors.textPrimary;
    const lblClr = variant === 'navy'  ? 'rgba(255,255,255,0.7)'
                 : variant === 'green' ? '#166534'
                 : variant === 'amber' ? AMBER
                 : colors.textSecondary;
    const border = variant === 'green' ? '#BBF7D0'
                 : variant === 'amber' ? '#FCD34D'
                 : variant === 'muted' ? colors.border
                 : 'transparent';

    return (
        <View style={[t.tile, { backgroundColor: bg, borderColor: border }]}>
            <Text style={[t.value, { color: valClr }]}>{value}</Text>
            <Text style={[t.label, { color: lblClr }]}>{label}</Text>
        </View>
    );
}

const t = StyleSheet.create({
    tile: {
        flex: 1, borderRadius: radius.card, borderWidth: 1,
        paddingVertical: spacing.md, paddingHorizontal: spacing.sm,
        alignItems: 'center', ...shadows.card,
    },
    value: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, lineHeight: 26 },
    label: { fontSize: 10, fontWeight: '600', textAlign: 'center', marginTop: 3, letterSpacing: 0.2 },
});

function PlanMix({ items }: { items: RevenueSummary['planBreakdown'] }) {
    const swatches = ['#A7F3D0', '#0F766E', '#183A4A', '#6B7280'];
    return (
        <View style={s.listCard}>
            <View style={s.mixBar}>
                {items.map((p, i) => (
                    <View
                        key={p.planName}
                        style={{ flex: Math.max(p.count, 1), backgroundColor: swatches[i % swatches.length] }}
                    />
                ))}
            </View>
            {items.map((p, i) => (
                <View key={`${p.planName}-row`} style={s.mixRow}>
                    <View style={[s.mixDot, { backgroundColor: swatches[i % swatches.length] }]} />
                    <Text style={s.mixName}>{p.planName}</Text>
                    <Text style={s.mixCount}>{p.count}</Text>
                </View>
            ))}
        </View>
    );
}

function BusinessInsights({ revenue }: { revenue: RevenueSummary }) {
    const expiring = revenue.expiringSoon ?? 0;
    return (
        <>
            <View style={s.tileRow}>
                <BusinessTile
                    variant="green"
                    value={sgd(revenue.actualRevenue ?? 0)}
                    label="Revenue This Month"
                />
                <BusinessTile
                    variant="navy"
                    value={sgd(revenue.projectedRevenue ?? 0)}
                    label="Projected Renewals"
                />
            </View>
            <View style={[s.tileRow, { marginTop: spacing.sm }]}>
                <BusinessTile
                    variant="muted"
                    value={String(revenue.activePlans ?? 0)}
                    label="Active Plans"
                />
                <BusinessTile
                    variant={expiring > 0 ? 'amber' : 'muted'}
                    value={String(expiring)}
                    label="Expiring Soon"
                />
            </View>
        </>
    );
}

// ─── Section 2: Renewals to Follow Up ─────────────────────────────────────────

function RenewalsSection({ revenue }: { revenue: RevenueSummary }) {
    const clients = revenue.expiringClients ?? [];

    if (clients.length === 0) {
        return (
            <View style={s.emptyCard}>
                <Ionicons name="calendar-outline" size={22} color={colors.textSecondary} />
                <Text style={s.emptyText}>No renewals due in the next 30 days.</Text>
            </View>
        );
    }

    return (
        <View style={s.listCard}>
            {clients.map((c, i) => {
                const expired = c.expiresInDays < 0;
                const soon    = c.expiresInDays <= 14;
                const dayClr  = expired ? RED : soon ? AMBER : colors.textSecondary;
                return (
                    <View key={c.clientId}>
                        <View style={s.renewRow}>
                            <View style={[s.avatar, expired && s.avatarUrgent]}>
                                <Text style={[s.avatarTxt, expired && s.avatarTxtUrgent]}>
                                    {c.clientName.charAt(0).toUpperCase()}
                                </Text>
                            </View>
                            <View style={s.renewInfo}>
                                <Text style={s.renewName} numberOfLines={1}>{c.clientName}</Text>
                                <Text style={[s.renewSub, { color: dayClr }]}>
                                    {c.planName} · expires in {c.expiresInDays} day{c.expiresInDays !== 1 ? 's' : ''}
                                </Text>
                            </View>
                            {c.renewalValue > 0 && (
                                <View style={s.renewBadge}>
                                    <Text style={s.renewBadgeCurr}>SGD</Text>
                                    <Text style={s.renewBadgeAmt}>{c.renewalValue.toLocaleString()}</Text>
                                    <Text style={s.renewBadgeSub}>expected</Text>
                                </View>
                            )}
                        </View>
                        {i < clients.length - 1 && <Divider />}
                    </View>
                );
            })}
        </View>
    );
}

// ─── Section 3: Booking Performance ───────────────────────────────────────────

interface BookingStats {
    booked:    number;
    done:      number;
    missed:    number;
    openSlots: number;
}

function BookingPerformance({ stats }: { stats: BookingStats }) {
    const fonts = useKitFonts();
    const total = stats.booked + stats.done + stats.missed + stats.openSlots;
    const bookedTotal = stats.booked + stats.done;
    const rate = total > 0 ? Math.round((bookedTotal / total) * 100) : 0;

    return (
        <View style={s.utilCard}>
            <View style={s.ring}>
                <Text style={[s.ringValue, fontStyle(fonts.heading, '800')]}>{rate}%</Text>
            </View>
            <View style={{ flex: 1 }}>
                <Text style={[s.utilTitle, fontStyle(fonts.bodySemibold, '700')]}>Utilisation</Text>
                <Text style={s.utilSub}>
                    {total === 0
                        ? 'No slots today'
                        : `${bookedTotal} of ${total} slots booked today`}
                </Text>
                <View style={s.utilPills}>
                    <Text style={[s.utilPill, { backgroundColor: '#E7EEF2', color: NAVY }]}>{stats.booked} upcoming</Text>
                    <Text style={[s.utilPill, { backgroundColor: '#DCFCE7', color: GREEN }]}>{stats.done} done</Text>
                    <Text style={[s.utilPill, { backgroundColor: '#F3F4F6', color: colors.textSecondary }]}>{stats.missed} missed</Text>
                </View>
            </View>
        </View>
    );
}

// ─── Section 4: Client Attention ──────────────────────────────────────────────

function ClientAttentionSection({
    clients,
    onOpen,
}: {
    clients: ClientStatusItem[];
    onOpen: (filter: 'missed' | 'followUp') => void;
}) {
    const noCheckIn = clients.filter(c => !c.hasCheckedInToday).length;
    const lowSessions = clients.filter(c =>
        c.sessions_remaining != null && c.sessions_remaining <= 2 && c.plan_status === 'active',
    ).length;
    const expiring = clients.filter(c => {
        if (!c.expiry_date) return false;
        const days = daysUntil(c.expiry_date);
        return days >= 0 && days <= 30;
    }).length;

    const rows: Array<{ label: string; count: number; filter: 'missed' | 'followUp' }> = [
        { label: 'No check-in today', count: noCheckIn, filter: 'missed' },
        { label: 'Low sessions (2 or fewer)', count: lowSessions, filter: 'followUp' },
        { label: 'Plan expiring in 30 days', count: expiring, filter: 'followUp' },
    ];

    return (
        <View style={s.listCard}>
            {rows.map((row, i) => (
                <View key={row.label}>
                    <TouchableOpacity style={s.attRow} onPress={() => onOpen(row.filter)} accessibilityRole="button">
                        <View style={[s.attIcon, { backgroundColor: row.count > 0 ? '#FEF3C7' : colors.surfaceMuted }]}>
                            <Ionicons
                                name={row.filter === 'missed' ? 'time-outline' : 'calendar-outline'}
                                size={16}
                                color={row.count > 0 ? AMBER : colors.textSecondary}
                            />
                        </View>
                        <Text style={[s.attName, { flex: 1 }]} numberOfLines={1}>{row.label}</Text>
                        <Text style={s.attCount}>{row.count}</Text>
                        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                    {i < rows.length - 1 && <Divider />}
                </View>
            ))}
        </View>
    );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

interface ScreenData {
    revenue:  RevenueSummary | null;
    dashboard: DashboardSummary | null;
    clients:  ClientStatusItem[];
    openSlotsToday: number;
}

export default function InsightsScreen() {
    const insets = useSafeAreaInsets();
    const fonts = useKitFonts();
    const navigation = useNavigation<any>();
    const [data,       setData]       = useState<ScreenData>({ revenue: null, dashboard: null, clients: [], openSlotsToday: 0 });
    const [loading,    setLoading]    = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error,      setError]      = useState<string | null>(null);

    const loadAll = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else           setLoading(true);
        setError(null);

        try {
            const today = todaySGT();
            const month = currentMonth();

            const [revRes, dashRes, clientRes, availRes] = await Promise.all([
                getRevenueSummary(month),
                getDashboard(today),
                getClientStatus(today),
                getAvailability(today),
            ]);

            // Count open (non-blocked, non-booked) slots for today
            const openToday = (availRes.slots ?? []).filter(
                (sl: any) => sl.date === today && !sl.is_booked && sl.status !== 'blocked'
            ).length;

            setData({
                revenue:       revRes,
                dashboard:     dashRes,
                clients:       clientRes.clients ?? [],
                openSlotsToday: openToday,
            });
        } catch (err: any) {
            setError(err.message ?? 'Failed to load insights.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useFocusEffect(useCallback(() => { loadAll(); }, [loadAll]));

    // ── Derived booking stats from dashboard ──────────────────────────────────
    const bookingStats: BookingStats = {
        booked:    (data.dashboard?.today_bookings ?? []).filter(b => b.status === 'booked').length,
        done:      (data.dashboard?.today_bookings ?? []).filter(b => b.status === 'completed').length,
        missed:    (data.dashboard?.today_bookings ?? []).filter(b => b.status === 'cancelled').length,
        openSlots: data.openSlotsToday,
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <ScrollView
            style={s.root}
            contentContainerStyle={s.content}
            showsVerticalScrollIndicator={false}
            refreshControl={
                <RefreshControl
                    refreshing={refreshing}
                    onRefresh={() => loadAll(true)}
                    tintColor="#FFFFFF"
                />
            }
        >
            <View style={[s.hero, { paddingTop: insets.top + spacing.md }]}>
                <Text style={[s.screenTitle, fontStyle(fonts.heading, '700')]}>Business Insights</Text>
                <Text style={s.screenSub}>
                    {new Date().toLocaleDateString('en-SG', {
                        weekday: 'short', day: 'numeric', month: 'long',
                        timeZone: 'Asia/Singapore',
                    })}
                </Text>
            </View>
            <View style={s.sheet}>

            {/* ── Full screen loading ───────────────────────────────────────── */}
            {loading && (
                <View style={s.centred}>
                    <ActivityIndicator size="large" color={colors.accent} />
                    <Text style={s.loadingTxt}>Loading insights…</Text>
                </View>
            )}

            {/* ── Full screen error ─────────────────────────────────────────── */}
            {!loading && error && (
                <SectionError message={error} onRetry={() => loadAll()} />
            )}

            {/* ── Content ──────────────────────────────────────────────────── */}
            {!loading && !error && (
                <>
                    {/* ── 1. Business Insights ─────────────────────────────── */}
                    <View style={s.section}>
                        <SectionLabel title="BUSINESS INSIGHTS" />
                        {data.revenue ? (
                            <>
                                <BusinessInsights revenue={data.revenue} />
                                {(data.revenue.planBreakdown?.length ?? 0) > 0 && (
                                    <View style={{ marginTop: spacing.md }}>
                                        <SectionLabel title="PLAN MIX" />
                                        <PlanMix items={data.revenue.planBreakdown} />
                                    </View>
                                )}
                            </>
                        ) : (
                            <View style={s.emptyCard}>
                                <Text style={s.emptyText}>Revenue data unavailable.</Text>
                            </View>
                        )}
                    </View>

                    {/* ── 2. Renewals to Follow Up ─────────────────────────── */}
                    <View style={s.section}>
                        <SectionLabel title="RENEWALS TO FOLLOW UP" />
                        {data.revenue ? (
                            <RenewalsSection revenue={data.revenue} />
                        ) : (
                            <View style={s.emptyCard}>
                                <Text style={s.emptyText}>Renewal data unavailable.</Text>
                            </View>
                        )}
                    </View>

                    {/* ── 3. Booking Performance ────────────────────────────── */}
                    <View style={s.section}>
                        <SectionLabel title="BOOKING PERFORMANCE — TODAY" />
                        <BookingPerformance stats={bookingStats} />
                    </View>

                    {/* ── 4. Client Attention ───────────────────────────────── */}
                    <View style={s.section}>
                        <SectionLabel title="CLIENT ATTENTION" />
                        <ClientAttentionSection
                            clients={data.clients}
                            onOpen={(filter) => navigation.navigate('Clients', { initialFilter: filter })}
                        />
                    </View>
                </>
            )}

            <View style={{ height: 48 }} />
            </View>
        </ScrollView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    root:    { flex: 1, backgroundColor: colors.background },
    content: { paddingBottom: 80 },
    hero: {
        backgroundColor: NAVY,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.xxl,
    },
    sheet: {
        marginTop: -spacing.lg,
        paddingHorizontal: spacing.base,
    },
    screenTitle: { fontSize: 28, color: '#FFFFFF', letterSpacing: -0.4 },
    screenSub:   { ...typography.body, color: 'rgba(255,255,255,0.78)', marginTop: 4 },
    utilCard: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        backgroundColor: colors.surface, borderRadius: radius.card,
        borderWidth: 1, borderColor: colors.border, padding: spacing.base, ...shadows.card,
    },
    ring: {
        width: 72, height: 72, borderRadius: 36,
        borderWidth: 8, borderColor: palette.teal,
        alignItems: 'center', justifyContent: 'center',
    },
    ringValue: { fontSize: 16, color: NAVY },
    utilTitle: { fontSize: 16, color: colors.textPrimary },
    utilSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    utilPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
    utilPill: { overflow: 'hidden', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontWeight: '700' },
    mixBar: { flexDirection: 'row', height: 10, borderRadius: 6, overflow: 'hidden', margin: spacing.base },
    mixRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.base, paddingBottom: spacing.sm },
    mixDot: { width: 8, height: 8, borderRadius: 4 },
    mixName: { ...typography.body, color: colors.textPrimary, flex: 1 },
    mixCount: { ...typography.label, color: colors.textSecondary },
    attIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    attCount: { ...typography.h3, color: colors.textPrimary, marginRight: 4 },

    // ── States ────────────────────────────────────────────────────────────────
    centred:    { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.base },
    loadingTxt: { ...typography.body, color: colors.textSecondary },

    errorCard: {
        backgroundColor: colors.errorBg, borderRadius: radius.card,
        borderWidth: 1, borderColor: colors.errorBorder,
        padding: spacing.base, gap: spacing.sm,
    },
    errorMsg:  { ...typography.body, color: colors.errorText },
    retryBtn:  {
        alignSelf: 'flex-start', backgroundColor: colors.accent,
        borderRadius: radius.md, paddingHorizontal: spacing.base, paddingVertical: spacing.sm,
    },
    retryTxt:  { fontSize: 13, fontWeight: '700', color: '#fff' },

    // ── Section ───────────────────────────────────────────────────────────────
    section:      { marginBottom: spacing.xl },
    sectionLabel: {
        fontSize: 10, fontWeight: '800', letterSpacing: 1.2,
        color: colors.textSecondary, marginBottom: spacing.sm,
    },

    // ── Tile row ──────────────────────────────────────────────────────────────
    tileRow: { flexDirection: 'row', gap: spacing.sm },

    // ── Shared card ───────────────────────────────────────────────────────────
    listCard: {
        backgroundColor: colors.surface, borderRadius: radius.card,
        borderWidth: 1, borderColor: colors.border,
        overflow: 'hidden', ...shadows.card,
    },
    divider: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.base },

    // ── Empty state ───────────────────────────────────────────────────────────
    emptyCard: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        backgroundColor: colors.surface, borderRadius: radius.card,
        borderWidth: 1, borderColor: colors.border,
        paddingVertical: spacing.lg, paddingHorizontal: spacing.base,
        ...shadows.card,
    },
    emptyIcon: { fontSize: 20 },
    emptyText: { ...typography.body, color: colors.textSecondary, fontWeight: '500', flex: 1 },

    // ── Avatar ────────────────────────────────────────────────────────────────
    avatar: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center',
    },
    avatarUrgent:    { backgroundColor: '#FEE2E2' },
    avatarTxt:       { fontSize: 14, fontWeight: '700', color: AMBER },
    avatarTxtUrgent: { color: RED },

    // ── Renewals rows ─────────────────────────────────────────────────────────
    renewRow:  {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        paddingVertical: spacing.md, paddingHorizontal: spacing.base,
    },
    renewInfo: { flex: 1 },
    renewName: { ...typography.label, color: colors.textPrimary },
    renewSub:  { ...typography.caption, color: colors.textSecondary },
    renewBadge: {
        backgroundColor: '#F0FDF4', borderRadius: radius.md,
        borderWidth: 1, borderColor: '#BBF7D0',
        paddingVertical: 4, paddingHorizontal: spacing.sm,
        alignItems: 'center',
    },
    renewBadgeCurr: { fontSize: 9,  fontWeight: '700', color: GREEN, letterSpacing: 0.6 },
    renewBadgeAmt:  { fontSize: 13, fontWeight: '800', color: GREEN, lineHeight: 18 },
    renewBadgeSub:  { fontSize: 9,  fontWeight: '500', color: GREEN },

    // ── Booking rows ──────────────────────────────────────────────────────────
    bookRow: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        paddingVertical: spacing.md, paddingHorizontal: spacing.base,
    },
    bookIconWrap: {
        width: 30, height: 30, borderRadius: 8,
        alignItems: 'center', justifyContent: 'center',
    },
    bookLabel: { ...typography.body, color: colors.textPrimary, flex: 1 },
    bookValue: { fontSize: 18, fontWeight: '800' },

    // ── Attention rows ────────────────────────────────────────────────────────
    attRow: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        paddingVertical: spacing.md, paddingHorizontal: spacing.base,
    },
    attInfo:   { flex: 1 },
    attName:   { ...typography.label, color: colors.textPrimary },
    attReason: { ...typography.caption, fontWeight: '600' },
    urgencyDot: { width: 8, height: 8, borderRadius: 4 },
});
