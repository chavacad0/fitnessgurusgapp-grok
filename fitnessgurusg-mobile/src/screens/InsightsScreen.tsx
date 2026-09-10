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
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radius, typography, shadows } from '../theme/theme';
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
                <Text style={s.emptyIcon}>🗓</Text>
                <Text style={s.emptyText}>No renewals due in the next 30 days.</Text>
            </View>
        );
    }

    return (
        <View style={s.listCard}>
            {clients.map((c, i) => {
                const urgent = c.expiresInDays <= 7;
                const soon   = c.expiresInDays <= 14;
                const dayClr = urgent ? RED : soon ? AMBER : colors.textSecondary;
                return (
                    <View key={c.clientId}>
                        <View style={s.renewRow}>
                            <View style={[s.avatar, urgent && s.avatarUrgent]}>
                                <Text style={[s.avatarTxt, urgent && s.avatarTxtUrgent]}>
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
    const total = stats.booked + stats.done + stats.missed + stats.openSlots;
    const bookedTotal = stats.booked + stats.done + stats.missed;
    const rate  = total > 0 ? Math.round((bookedTotal / total) * 100) : 0;

    const rows: Array<{ icon: string; color: string; label: string; value: string }> = [
        { icon: 'calendar-outline',       color: GREEN,            label: 'Open slots today',    value: String(stats.openSlots) },
        { icon: 'checkmark-circle-outline', color: '#4F46E5',       label: 'Booked sessions',     value: String(stats.booked) },
        { icon: 'checkmark-done-outline', color: GREEN,            label: 'Completed',           value: String(stats.done) },
        { icon: 'close-circle-outline',   color: RED,              label: 'Missed / Cancelled',  value: String(stats.missed) },
        { icon: 'stats-chart-outline',    color: NAVY,             label: 'Utilisation rate',    value: `${rate}%` },
    ];

    return (
        <View style={s.listCard}>
            {rows.map((r, i) => (
                <View key={r.label}>
                    <View style={s.bookRow}>
                        <View style={[s.bookIconWrap, { backgroundColor: r.color + '18' }]}>
                            <Ionicons name={r.icon as any} size={16} color={r.color} />
                        </View>
                        <Text style={s.bookLabel}>{r.label}</Text>
                        <Text style={[s.bookValue, { color: r.color }]}>{r.value}</Text>
                    </View>
                    {i < rows.length - 1 && <Divider />}
                </View>
            ))}
        </View>
    );
}

// ─── Section 4: Client Attention ──────────────────────────────────────────────

interface AttentionItem {
    clientId:   string;
    name:       string;
    reason:     string;
    urgency:    'high' | 'medium' | 'low';
}

function buildAttentionList(clients: ClientStatusItem[]): AttentionItem[] {
    const items: AttentionItem[] = [];
    const today = todaySGT();

    for (const c of clients) {
        // No check-in today
        if (!c.hasCheckedInToday) {
            items.push({
                clientId: c.clientId,
                name:     c.clientName,
                reason:   'No check-in today',
                urgency:  'medium',
            });
        }
        // Very low sessions (≤2)
        if (c.sessions_remaining != null && c.sessions_remaining <= 2 && c.plan_status === 'active') {
            items.push({
                clientId: c.clientId,
                name:     c.clientName,
                reason:   `${c.sessions_remaining} session${c.sessions_remaining !== 1 ? 's' : ''} remaining`,
                urgency:  'high',
            });
        } else if (c.sessions_remaining != null && c.sessions_remaining <= 4 && c.plan_status === 'active') {
            // Moderate low (3-4)
            items.push({
                clientId: c.clientId,
                name:     c.clientName,
                reason:   `${c.sessions_remaining} sessions remaining`,
                urgency:  'low',
            });
        }
        // Plan expiring within 7 days
        if (c.expiry_date) {
            const days = daysUntil(c.expiry_date);
            if (days >= 0 && days <= 7) {
                items.push({
                    clientId: c.clientId,
                    name:     c.clientName,
                    reason:   `Plan expires in ${days} day${days !== 1 ? 's' : ''}`,
                    urgency:  days <= 3 ? 'high' : 'medium',
                });
            }
        }
        // No plan at all
        if (c.plan_status === 'none' || c.plan_status === 'expired') {
            items.push({
                clientId: c.clientId,
                name:     c.clientName,
                reason:   c.plan_status === 'expired' ? 'Plan expired — renewal needed' : 'No active plan',
                urgency:  'high',
            });
        }
    }

    // Sort: high → medium → low, deduplicate per clientId+reason
    const seen = new Set<string>();
    return items
        .filter(item => {
            const key = `${item.clientId}:${item.reason}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => {
            const order = { high: 0, medium: 1, low: 2 };
            return order[a.urgency] - order[b.urgency];
        });
}

const URGENCY_COLOR: Record<string, string> = {
    high:   RED,
    medium: AMBER,
    low:    colors.textSecondary,
};

function ClientAttentionSection({ clients }: { clients: ClientStatusItem[] }) {
    const items = buildAttentionList(clients);

    if (items.length === 0) {
        return (
            <View style={s.emptyCard}>
                <Text style={s.emptyIcon}>✅</Text>
                <Text style={s.emptyText}>All clients are on track. Nothing needs attention.</Text>
            </View>
        );
    }

    return (
        <View style={s.listCard}>
            {items.map((item, i) => {
                const clr = URGENCY_COLOR[item.urgency];
                return (
                    <View key={`${item.clientId}:${item.reason}`}>
                        <View style={s.attRow}>
                            <View style={[s.avatar, { backgroundColor: clr + '18' }]}>
                                <Text style={[s.avatarTxt, { color: clr }]}>
                                    {item.name.charAt(0).toUpperCase()}
                                </Text>
                            </View>
                            <View style={s.attInfo}>
                                <Text style={s.attName} numberOfLines={1}>{item.name}</Text>
                                <Text style={[s.attReason, { color: clr }]}>{item.reason}</Text>
                            </View>
                            <View style={[s.urgencyDot, { backgroundColor: clr }]} />
                        </View>
                        {i < items.length - 1 && <Divider />}
                    </View>
                );
            })}
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
                    tintColor={colors.accent}
                />
            }
        >
            {/* ── Header ───────────────────────────────────────────────────── */}
            <View style={s.header}>
                <Text style={s.screenTitle}>Business Insights</Text>
                <Text style={s.screenSub}>
                    {new Date().toLocaleDateString('en-SG', {
                        weekday: 'short', day: 'numeric', month: 'long',
                        timeZone: 'Asia/Singapore',
                    })}
                </Text>
            </View>

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
                            <BusinessInsights revenue={data.revenue} />
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
                        <ClientAttentionSection clients={data.clients} />
                    </View>
                </>
            )}

            <View style={{ height: 48 }} />
        </ScrollView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    root:    { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.base, paddingBottom: 80 },

    // ── Header ────────────────────────────────────────────────────────────────
    header:      { marginBottom: spacing.xl },
    screenTitle: { fontSize: 26, fontWeight: '800', color: NAVY, letterSpacing: -0.4 },
    screenSub:   { ...typography.body, color: colors.textSecondary, marginTop: 2 },

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
