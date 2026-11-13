/**
 * ClientsScreen — Coach Command Center Dashboard
 *
 * ─── Data Flow ────────────────────────────────────────────────────────────────
 *
 *  Step 1:  GET /api/clients/status?date=YYYY-MM-DD
 *           → Returns all clients with hasCheckedInToday, streak, plan data.
 *
 *  Step 2:  GET /api/clients/:clientId/redflags  (parallel, one per client)
 *           → Returns unresolved red flags for each client.
 *
 *  Step 3:  Frontend aggregation — classify each client into:
 *           • needsAttention  = has unresolved redflags OR energy <= 4 OR missed today
 *           • checkedInToday  = hasCheckedInToday === true
 *           • missed          = !hasCheckedInToday
 *
 * ─── UX Principle ────────────────────────────────────────────────────────────
 *  "Do not make the coach think."
 *  Coach opens the screen → instantly sees who needs help and who is on track.
 *
 * ─── Backend Endpoints Used ──────────────────────────────────────────────────
 *   GET /api/clients/status      → via getClientStatus()
 *   GET /api/clients/:id/redflags → via getRedFlags()
 *
 *  No new endpoints created. No coach-side check-in forms.
 */

import React, { useState, useLayoutEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    FlatList,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
    RefreshControl,
    TextInput,
    Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getClientStatus, getRedFlags } from '../services/apiClient';
import { useAuth } from '../context/AuthContext';
import { ClientStatusItem, RedFlag, PlanStatus } from '../types';
import { colors, spacing, radius, typography, shadows, palette } from '../theme/theme';
import { fontStyle, useKitFonts } from '../theme/fonts';
import UserAvatar from '../components/UserAvatar';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Clients with any unresolved flag of HIGH severity get an urgent badge */
const HIGH_SEVERITY_TYPES = ['LOW_ENERGY', 'MISSED_CHECKIN'];

/** Energy threshold below which a client is flagged as needing attention */
const LOW_ENERGY_THRESHOLD = 4;

/** Brand navy used as the dashboard's primary accent — per spec */
const NAVY = '#183A4A';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Enriched client record: base status + fetched redflags + computed attention flag.
 */
interface EnrichedClient extends ClientStatusItem {
    /** Unresolved red flags fetched from GET /api/clients/:id/redflags */
    redFlags: RedFlag[];
    /** True if this client needs the coach's immediate attention */
    needsAttention: boolean;
    /**
     * Primary reason text shown under the client's name in the attention section.
     * Derived from redflags → low energy → missed check-in (priority order).
     */
    alertReason: string;
    /** Compact energy value from today's check-in (if available via redflags) */
    latestEnergy?: number;
}



// ─── Helpers: date ────────────────────────────────────────────────────────────

function getTodayISO(): string {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function getGreeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

function getTodayLong(): string {
    try {
        return new Date().toLocaleDateString('en-SG', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        });
    } catch {
        return new Date().toLocaleDateString();
    }
}

function formatDateSG(dateStr: string | null): string {
    if (!dateStr) return 'No check-ins yet';
    try {
        const d = new Date(`${dateStr}T00:00:00`);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

// ─── Helpers: aggregation ─────────────────────────────────────────────────────

/**
 * buildAlertReason — derive a human-readable reason string from:
 *   1. Unresolved red flags (highest priority)
 *   2. Low energy detected from flag type hint
 *   3. Missed check-in (fallback)
 */
function buildAlertReason(client: ClientStatusItem, flags: RedFlag[]): string {
    const unresolvedFlags = flags.filter(f => !f.resolved);

    if (unresolvedFlags.length > 0) {
        const highSeverity = unresolvedFlags.find(f => f.severity === 'high');
        const flag = highSeverity ?? unresolvedFlags[0];

        // Map backend flag type to a friendly label
        switch (flag.type) {
            case 'LOW_ENERGY':     return `Low energy flagged`;
            case 'MISSED_CHECKIN': return `Missed check-in`;
            default:               return flag.type.replace(/_/g, ' ').toLowerCase();
        }
    }

    if (!client.hasCheckedInToday) {
        return 'Missed check-in today';
    }

    return 'Flagged';
}

/**
 * classifyClients — enriches the raw ClientStatusItem list with:
 *   - fetched redflags per client
 *   - computed needsAttention boolean
 *   - derived alertReason string
 *
 * Attention rules (any ONE true → needsAttention = true):
 *   • has unresolved red flags
 *   • missed check-in today
 */
function classifyClients(
    clients: ClientStatusItem[],
    flagsMap: Record<string, RedFlag[]>,
): EnrichedClient[] {
    return clients.map(client => {
        const flags = flagsMap[client.clientId] ?? [];
        const unresolvedFlags = flags.filter(f => !f.resolved);

        const hasFlags = unresolvedFlags.length > 0;
        const missedToday = !client.hasCheckedInToday;

        const needsAttention = hasFlags || missedToday;
        const alertReason = buildAlertReason(client, flags);

        return {
            ...client,
            redFlags: flags,
            needsAttention,
            alertReason,
        };
    });
}

// ─── Helpers: plan badges ─────────────────────────────────────────────────────

function daysUntilExpiry(expiryDate: string): number {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const exp = new Date(`${expiryDate}T00:00:00`);
    return Math.round((exp.getTime() - today.getTime()) / 86_400_000);
}

function expiryLabel(expiryDate?: string): string {
    if (!expiryDate) return '';
    const days = daysUntilExpiry(expiryDate);
    if (days < 0)       return `Expired ${Math.abs(days)}d ago`;
    if (days === 0)     return 'Expires today';
    if (days <= 7)      return `Expires in ${days}d`;
    return '';
}

/** Threshold values for the Renewals filter */
const RENEWAL_LOW_SESSIONS   = 2;  // sessions_remaining <= this → Low sessions
const RENEWAL_EXPIRY_DAYS    = 30; // expiry within this many days → Expiring soon

/**
 * getRenewalBadge — returns a badge descriptor if this client needs renewal
 * follow-up, or null if the client is in good standing OR has no plan at all.
 *
 * Scope: clients whose EXISTING package is ending or has run out.
 * Clients with no plan (plan_status === 'none' / absent) belong in the
 * "No Plan" filter, NOT here — so they are intentionally excluded.
 *
 * Priority order (highest → lowest):
 *   1. plan_status === 'expired'          → 'Plan expired'
 *   2. sessions_remaining === 0           → '0 sessions left'
 *   3. sessions_remaining <= 2            → 'Low sessions'
 *   4. expiry within RENEWAL_EXPIRY_DAYS  → 'Expiring Soon'
 *
 * Returns null for:
 *   • healthy active clients
 *   • clients with no plan (no plan_status / plan_status === 'none')
 */
function getRenewalBadge(
    client: EnrichedClient,
): { bg: string; border: string; text: string; label: string } | null {
    // ── Priority 1: plan explicitly expired ───────────────────────────────────
    if (client.plan_status === 'expired') {
        return { bg: '#FEE2E2', border: '#FECACA', text: '#DC2626', label: 'Plan expired' };
    }

    // ── Priority 2 & 3: session count exhausted or critically low ─────────────
    if (client.sessions_remaining != null) {
        if (client.sessions_remaining === 0) {
            return { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E', label: '0 sessions left' };
        }
        if (client.sessions_remaining <= RENEWAL_LOW_SESSIONS) {
            return { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E', label: 'Low sessions' };
        }
    }

    // ── Priority 4: expiry date is within the renewal window ──────────────────
    if (client.expiry_date) {
        const daysLeft = daysUntilExpiry(client.expiry_date);
        if (daysLeft >= 0 && daysLeft <= RENEWAL_EXPIRY_DAYS) {
            return { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E', label: 'Expiring Soon' };
        }
    }

    // Client is in good standing, or has no plan (→ belongs in No Plan filter)
    return null;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * OverviewTile — one of the four stat tiles in the Today Overview section.
 */
function OverviewTile({
    label, value, dark, accent,
}: {
    label: string;
    value: number | string;
    dark?: boolean;
    accent?: string;
}) {
    return (
        <View style={[
            ot.tile,
            dark ? { backgroundColor: NAVY } : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
        ]}>
            <Text style={[ot.value, { color: dark ? '#FFF' : (accent ?? colors.textPrimary) }]}>
                {value}
            </Text>
            <Text style={[ot.label, { color: dark ? '#9AAFC4' : colors.textSecondary }]}>{label}</Text>
        </View>
    );
}

const ot = StyleSheet.create({
    tile: {
        flex: 1,
        borderRadius: radius.card,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.sm,
        alignItems: 'center',
        ...shadows.card,
    },
    value: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
    label: { ...typography.micro, marginTop: 3, textAlign: 'center' },
});

/**
 * SectionHeader — emoji + title + count pill.
 */
function SectionHeader({
    emoji, title, count, pillarColor,
}: {
    emoji: string;
    title: string;
    count: number;
    pillarColor?: string;
}) {
    return (
        <View style={sh.row}>
            <View style={[sh.pillar, { backgroundColor: pillarColor ?? colors.accent }]} />
            <Text style={sh.emoji}>{emoji}</Text>
            <Text style={sh.title}>{title}</Text>
            <View style={[sh.pill, { backgroundColor: pillarColor ? `${pillarColor}22` : colors.accentSubtle }]}>
                <Text style={[sh.pillText, { color: pillarColor ?? colors.accent }]}>{count}</Text>
            </View>
        </View>
    );
}

const sh = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
    pillar: { width: 3, height: 20, borderRadius: 2 },
    emoji: { fontSize: 16 },
    title: { ...typography.h3, color: colors.textPrimary, flex: 1 },
    pill: {
        minWidth: 26,
        height: 22,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.sm,
    },
    pillText: { fontSize: 12, fontWeight: '700' },
});

/**
 * AttentionCard — card shown in "Needs Attention" section.
 * Red left strip + alert reason + action buttons.
 */
function AttentionCard({
    client,
    onPress,
    onReminder,
}: {
    client: EnrichedClient;
    onPress: () => void;
    onReminder: () => void;
}) {
    const flagCount = client.redFlags.filter(f => !f.resolved).length;

    return (
        <TouchableOpacity
            style={ac.card}
            onPress={onPress}
            activeOpacity={0.76}
            accessibilityRole="button"
            accessibilityLabel={`${client.clientName} — ${client.alertReason}`}
        >
            {/* Left accent strip */}
            <View style={ac.strip} />

            <View style={ac.body}>
                {/* Top row: name + flag badge */}
                <View style={ac.topRow}>
                    <Text style={ac.name} numberOfLines={1}>{client.clientName}</Text>
                    {flagCount > 0 && (
                        <View style={ac.flagBadge}>
                            <Ionicons name="flag" size={10} color={colors.urgentText} />
                            <Text style={ac.flagText}>{flagCount} flag{flagCount > 1 ? 's' : ''}</Text>
                        </View>
                    )}
                    {client.streak > 0 && (
                        <View style={ac.streakBadge}>
                            <Text style={ac.streakText}>🔥 {client.streak}d</Text>
                        </View>
                    )}
                </View>

                {/* Alert reason */}
                <Text style={ac.reason}>{client.alertReason}</Text>

                {/* Plan expiry warning */}
                {client.expiry_date && expiryLabel(client.expiry_date) !== '' && (
                    <Text style={ac.planWarn}>⚠ {expiryLabel(client.expiry_date)}</Text>
                )}

                {/* Session pills */}
                {client.sessions_remaining != null && (
                    <Text style={ac.sessionText}>
                        {client.sessions_remaining}/{client.sessions_total ?? '?'} sessions remaining
                    </Text>
                )}

                {/* Action row */}
                <View style={ac.actions}>
                    <TouchableOpacity
                        style={ac.reminderBtn}
                        onPress={onReminder}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Ionicons name="paper-plane-outline" size={13} color={colors.textSecondary} />
                        <Text style={ac.reminderText}>WhatsApp</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={ac.viewBtn} onPress={onPress}>
                        <Text style={ac.viewText}>Payments →</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </TouchableOpacity>
    );
}

const ac = StyleSheet.create({
    card: {
        flexDirection: 'row',
        backgroundColor: colors.urgentBg,
        borderWidth: 1,
        borderColor: colors.urgentBorder,
        borderRadius: radius.card,
        marginBottom: spacing.sm,
        overflow: 'hidden',
        ...shadows.card,
    },
    strip: {
        width: 4,
        backgroundColor: colors.urgentText,
    },
    body: {
        flex: 1,
        padding: spacing.base,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        marginBottom: 3,
    },
    name: {
        ...typography.h3,
        color: colors.textPrimary,
        flex: 1,
    },
    flagBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: colors.errorBg,
        borderRadius: radius.pill,
        paddingHorizontal: 7,
        paddingVertical: 2,
    },
    flagText: { fontSize: 10, fontWeight: '700', color: colors.urgentText },
    streakBadge: {
        backgroundColor: colors.accentSubtle,
        borderRadius: radius.pill,
        paddingHorizontal: 7,
        paddingVertical: 2,
    },
    streakText: { fontSize: 10, fontWeight: '600', color: colors.accent },
    reason: { ...typography.caption, color: colors.urgentText, marginBottom: 3 },
    planWarn: { ...typography.caption, color: colors.badgeWarningText, marginBottom: 3 },
    sessionText: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: spacing.xs,
        paddingTop: spacing.sm,
        borderTopWidth: 1,
        borderTopColor: colors.urgentBorder,
    },
    reminderBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    reminderText: { ...typography.caption, color: colors.textSecondary },
    viewBtn: {
        backgroundColor: NAVY,
        borderRadius: radius.md,
        paddingVertical: 6,
        paddingHorizontal: spacing.md,
    },
    viewText: { ...typography.caption, color: '#FFF', fontWeight: '700' },
});

/**
 * CheckedInRow — compact row for clients who have checked in.
 */
function CheckedInRow({
    client,
    onPress,
}: {
    client: EnrichedClient;
    onPress: () => void;
}) {
    return (
        <TouchableOpacity
            style={cr.row}
            onPress={onPress}
            activeOpacity={0.76}
            accessibilityRole="button"
            accessibilityLabel={`${client.clientName} — checked in`}
        >
            {/* Avatar */}
            <View style={cr.avatar}>
                <Text style={cr.avatarText}>{client.clientName.charAt(0).toUpperCase()}</Text>
            </View>

            {/* Name + meta */}
            <View style={cr.textBlock}>
                <Text style={cr.name}>{client.clientName}</Text>
                <Text style={cr.meta}>
                    {client.streak >= 3 ? `🔥 ${client.streak}-day streak · ` : ''}
                    Last: {formatDateSG(client.lastCheckInDate)}
                </Text>
                {client.sessions_remaining != null && (
                    <Text style={cr.sessionsMeta}>
                        {client.sessions_remaining}/{client.sessions_total ?? '?'} sessions
                        {client.expiry_date && expiryLabel(client.expiry_date) ? ` · ${expiryLabel(client.expiry_date)}` : ''}
                    </Text>
                )}
            </View>

            {/* Status badge */}
            <View style={cr.badge}>
                <Text style={cr.badgeText}>✅ Done</Text>
            </View>
        </TouchableOpacity>
    );
}

const cr = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.base,
        gap: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    avatar: {
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: colors.accentSubtle,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarText: { fontSize: 16, fontWeight: '700', color: colors.accent },
    textBlock: { flex: 1 },
    name: { ...typography.label, color: colors.textPrimary, marginBottom: 2 },
    meta: { ...typography.caption, color: colors.textSecondary },
    sessionsMeta: { ...typography.caption, color: colors.badgeWarningText, marginTop: 1 },
    badge: {
        backgroundColor: colors.badgeSuccessBg,
        borderRadius: radius.pill,
        paddingVertical: 4,
        paddingHorizontal: spacing.sm,
        borderWidth: 1,
        borderColor: colors.successBorder,
    },
    badgeText: { fontSize: 11, fontWeight: '700', color: colors.badgeSuccessText },
});

/**
 * AllClientsRow — compact row for the client flat list.
 *
 * Badge visibility rules (by activeFilter):
 *   'all'        → calm directory view. Only show a badge for URGENT plan issues
 *                  (expired plan, no plan ever). Normal missed check-ins are hidden.
 *   'attention'  → show the full attention/follow-up badge (red flag or missed)
 *   'missed'     → show the missed check-in badge
 *   'activePlan' → show a plan-status badge (expiring soon highlighted)
 *   'noPlan'     → show a "No Plan" badge so coach sees why this client is here
 */
function statusLine(client: EnrichedClient): string {
    if (client.check_in_status === 'paused') return 'Check-ins paused';
    if (client.plan_status === 'expired') return 'Plan expired';
    if (!client.hasCheckedInToday) {
        return client.alertReason && client.alertReason !== 'Flagged'
            ? client.alertReason
            : 'Missed check-in today';
    }
    if (client.plan_name) return client.plan_name;
    return 'Checked in';
}

function AllClientsRow({
    client,
    onPress,
    activeFilter,
}: {
    client: EnrichedClient;
    onPress: () => void;
    activeFilter: ClientFilterKey;
}) {
    const fonts = useKitFonts();
    type BadgeStyle = { bg: string; border: string; text: string; label: string };

    const missedBadge: BadgeStyle = {
        bg: colors.badgeWarningBg, border: colors.warningBorder,
        text: colors.badgeWarningText, label: 'Follow-Up',
    };
    const noPlanBadge: BadgeStyle = {
        bg: '#F3F4F6', border: '#E5E7EB',
        text: '#6B7280', label: 'No Plan',
    };
    const pausedBadge: BadgeStyle = {
        bg: '#F3F4F6', border: '#E5E7EB',
        text: '#6B7280', label: 'Paused',
    };
    const expiredPlanBadge: BadgeStyle = {
        bg: '#FEE2E2', border: '#FECACA',
        text: '#DC2626', label: 'Plan expired',
    };
    const expiringSoonBadge: BadgeStyle = {
        bg: colors.badgeWarningBg, border: colors.warningBorder,
        text: colors.badgeWarningText, label: 'Expiring Soon',
    };
    const activeBadge: BadgeStyle = {
        bg: colors.badgeSuccessBg, border: colors.successBorder,
        text: colors.badgeSuccessText, label: 'Active Plan',
    };

    const renewal = getRenewalBadge(client);
    let badgeToRender: BadgeStyle | null = null;

    switch (activeFilter) {
        case 'all':
            if (client.check_in_status === 'paused') badgeToRender = pausedBadge;
            else if (client.plan_status === 'expired') badgeToRender = expiredPlanBadge;
            else if (!client.plan_status || client.plan_status === 'none') badgeToRender = noPlanBadge;
            else if (renewal) badgeToRender = renewal.label === 'Expiring Soon' ? expiringSoonBadge : renewal;
            else if (!client.hasCheckedInToday) badgeToRender = missedBadge;
            else badgeToRender = activeBadge;
            break;
        case 'followUp':
            badgeToRender = renewal;
            break;
        case 'missed':
            if (client.check_in_status !== 'paused') badgeToRender = missedBadge;
            break;
        case 'activePlan':
            badgeToRender = client.plan_status === 'expiring_soon' ? expiringSoonBadge : activeBadge;
            break;
        case 'noPlan':
            badgeToRender = noPlanBadge;
            break;
    }

    const line = activeFilter === 'followUp'
        ? (renewal?.label ?? statusLine(client))
        : statusLine(client);
    const lineAmber = activeFilter === 'followUp' || (!client.hasCheckedInToday && client.plan_status !== 'expired');
    const showRemind = activeFilter === 'followUp';

    const remind = () => {
        const today = new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
        Share.share({
            message: `Hi ${client.clientName}, just a gentle reminder to submit your daily check-in for today (${today}). Thank you!`,
        }).catch(() => {});
    };

    return (
        <TouchableOpacity
            style={ar.row}
            onPress={onPress}
            activeOpacity={0.76}
            accessibilityRole="button"
            accessibilityLabel={`${client.clientName}${badgeToRender ? ', ' + badgeToRender.label : ''}`}
        >
            <UserAvatar name={client.clientName} size={44} />
            <View style={ar.clientInfo}>
                <Text style={[ar.name, fontStyle(fonts.bodySemibold, '600')]} numberOfLines={1}>{client.clientName}</Text>
                <Text style={[ar.metaText, lineAmber && ar.metaWithExpiry, fontStyle(fonts.body, '400')]} numberOfLines={2}>
                    {line}
                </Text>
            </View>
            {showRemind ? (
                <TouchableOpacity
                    style={ar.remindBtn}
                    onPress={remind}
                    accessibilityRole="button"
                    accessibilityLabel={`Remind ${client.clientName}`}
                >
                    <Text style={[ar.remindText, fontStyle(fonts.bodySemibold, '600')]}>Remind</Text>
                </TouchableOpacity>
            ) : badgeToRender ? (
                <View style={[ar.badge, { backgroundColor: badgeToRender.bg }]}>
                    <Text style={[ar.badgeText, { color: badgeToRender.text }]}>{badgeToRender.label}</Text>
                </View>
            ) : null}
        </TouchableOpacity>
    );
}

const ar = StyleSheet.create({
    row: {
        flexDirection:     'row',
        alignItems:        'center',
        paddingVertical:   14,
        paddingHorizontal: 14,
        gap:               12,
        backgroundColor:   colors.surface,
        borderRadius:      radius.card,
        borderWidth:       1,
        borderColor:       colors.border,
        marginBottom:      10,
        ...shadows.card,
    },
    clientInfo: { flex: 1, minWidth: 0 },
    name: { fontSize: 16, color: colors.textPrimary },
    metaText: { fontSize: 13, color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
    metaWithExpiry: { color: colors.amberText },
    badge: {
        borderRadius: radius.pill,
        paddingVertical: 4,
        paddingHorizontal: 10,
        alignSelf: 'center',
    },
    badgeText: { fontSize: 11, fontWeight: '700' },
    remindBtn: {
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.border,
        paddingVertical: 6,
        paddingHorizontal: 12,
        backgroundColor: colors.surface,
    },
    remindText: { fontSize: 13, color: palette.primary },
});

// ─── Mock data (UI testing) ───────────────────────────────────────────────────
//
// Set USE_MOCK = true  → dashboard renders instantly from local data (no API).
// Set USE_MOCK = false → real backend data flows in (production mode).
//
// ⚠️  PRODUCTION MODE — real backend data only. Set back to true only for UI development.

const USE_MOCK = false;

const TODAY_ISO = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

/**
 * MOCK_CLIENTS — realistic Singapore coaching scenario.
 * Shape matches exactly what classifyClients() produces from the real API,
 * so the UI renders identically in both mock and live modes.
 */
const MOCK_CLIENTS: EnrichedClient[] = [
    // ── Action Required — missed check-in ──────────────────────────────────
    {
        clientId:          'mock-001',
        clientName:        'John Tan',
        hasCheckedInToday: false,
        lastCheckInDate:   '2026-04-14',
        streak:            0,
        plan_name:         'Elite',
        plan_status:       'active',
        sessions_total:    20,
        sessions_used:     12,
        sessions_remaining: 8,
        expiry_date:       '2026-05-20',
        redFlags:          [],
        needsAttention:    true,
        alertReason:       'Missed check-in today',
    },
    // ── Action Required — low energy red flag ───────────────────────────────
    {
        clientId:          'mock-002',
        clientName:        'Sarah Lim',
        hasCheckedInToday: true,
        lastCheckInDate:   TODAY_ISO,
        streak:            3,
        plan_name:         'Progress',
        plan_status:       'active',
        sessions_total:    12,
        sessions_used:     7,
        sessions_remaining: 5,
        expiry_date:       '2026-04-25',
        redFlags: [
            {
                _id:       'flag-001',
                client_id: 'mock-002',  // snake_case — matches RedFlag type
                coach_id:  'coach-001', // snake_case — matches RedFlag type
                type:      'LOW_ENERGY',
                severity:  'high',
                resolved:  false,
                date:      TODAY_ISO,
                createdAt: TODAY_ISO,
            },
        ],
        needsAttention: true,
        alertReason:    'Low energy flagged',
        latestEnergy:   3,
    },
    // ── Action Required — inactive / no data in days ─────────────────────────
    {
        clientId:          'mock-003',
        clientName:        'Wei Ming',
        hasCheckedInToday: false,
        lastCheckInDate:   '2026-04-12',
        streak:            0,
        plan_name:         'Starter',
        plan_status:       'expiring_soon',
        sessions_total:    8,
        sessions_used:     7,
        sessions_remaining: 1,
        expiry_date:       '2026-04-18',
        redFlags:          [],
        needsAttention:    true,
        alertReason:       'Missed check-in today',
    },
    // ── Completed Today ──────────────────────────────────────────────────────
    {
        clientId:          'mock-004',
        clientName:        'Mark Lee',
        hasCheckedInToday: true,
        lastCheckInDate:   TODAY_ISO,
        streak:            7,
        plan_name:         'Elite',
        plan_status:       'active',
        sessions_total:    20,
        sessions_used:     8,
        sessions_remaining: 12,
        expiry_date:       '2026-06-01',
        redFlags:          [],
        needsAttention:    false,
        alertReason:       '',
    },
    {
        clientId:          'mock-005',
        clientName:        'Ana Pereira',
        hasCheckedInToday: true,
        lastCheckInDate:   TODAY_ISO,
        streak:            14,
        plan_name:         'Progress',
        plan_status:       'active',
        sessions_total:    12,
        sessions_used:     4,
        sessions_remaining: 8,
        expiry_date:       '2026-05-10',
        redFlags:          [],
        needsAttention:    false,
        alertReason:       '',
    },
];

// ─── Main Screen ──────────────────────────────────────────────────────────────

// ─── Route param type ────────────────────────────────────────────────────────
//
// Filter key meanings (canonical definitions):
//   'all'        — every client
//   'followUp'   — payment/session renewal follow-up:
//                   plan expired | 0 sessions | ≤2 sessions | expiry ≤30d
//                   (no-plan clients are NOT included — they belong in 'noPlan')
//   'activePlan' — clients with an active or expiring-soon session plan
//                   (plan_status === 'active' | 'expiring_soon')
//   'noPlan'     — clients with no plan assigned (plan_status absent or 'none')
//   'missed'     — clients who have not checked in today
//
export type ClientFilterKey = 'all' | 'followUp' | 'activePlan' | 'noPlan' | 'missed';

export type ClientsScreenParams = {
    initialFilter?: ClientFilterKey;
};

export default function ClientsScreen({ navigation, route }: any) {
    const { logout } = useAuth();
    const insets = useSafeAreaInsets(); // dynamic notch / status-bar height
    const fonts = useKitFonts();

    const [enrichedClients, setEnrichedClients] = useState<EnrichedClient[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // ── Search + filter state ─────────────────────────────────────────────────
    const [searchQuery,  setSearchQuery]  = useState('');
    const [activeFilter, setActiveFilter] = useState<ClientFilterKey>('all');

    // Apply initialFilter param from dashboard navigation (one-shot on focus).
    // We read and immediately clear it so repeated manual tab-taps don't re-apply.
    useFocusEffect(useCallback(() => {
        const params = route?.params as ClientsScreenParams | undefined;
        if (params?.initialFilter) {
            setActiveFilter(params.initialFilter);
            // Clear the param so the next focus (manual tab tap) starts on 'all'
            navigation.setParams({ initialFilter: undefined });
        }
    }, [route?.params, navigation]));

    // ── Logout button in header ───────────────────────────────────────────────
    const handleLogout = useCallback(() => {
        Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign Out', style: 'destructive', onPress: async () => { await logout(); } },
        ]);
    }, [logout]);

    useLayoutEffect(() => {
        navigation.setOptions({
            headerShown: false, // we have our own greeting header
        });
    }, [navigation]);

    // ── Data loading ─────────────────────────────────────────────────────────
    /**
     * loadDashboard
     *
     * Step 1: GET /api/clients/status          → base client list + check-in status
     * Step 2: GET /api/clients/:id/redflags    → parallel, one per client
     * Step 3: classifyClients()                → compute needsAttention, alertReason
     */
    const loadDashboard = useCallback(async () => {
        // ── Mock mode bypass — flip USE_MOCK = false when backend is ready ———————
        if (USE_MOCK) {
            setLoading(false);
            setError(null);
            setEnrichedClients(MOCK_CLIENTS);
            return;
        }
        // ────────────────────────────────────────────────────────────────

        setLoading(true);
        setError(null);
        try {
            // ── Step 1: Fetch all clients with their check-in status ──────────
            const statusResult = await getClientStatus(getTodayISO());
            const clients = statusResult.clients;

            if (clients.length === 0) {
                setEnrichedClients([]);
                return;
            }

            // ── Step 2: Fetch red flags for each client in parallel ───────────
            // Promise.allSettled so one failing call doesn't block the whole screen.
            const flagResults = await Promise.allSettled(
                clients.map(c => getRedFlags(c.clientId))
            );

            // Build a map: clientId → RedFlag[]
            const flagsMap: Record<string, RedFlag[]> = {};
            clients.forEach((c, idx) => {
                const result = flagResults[idx];
                flagsMap[c.clientId] = result.status === 'fulfilled'
                    ? result.value.redflags
                    : []; // gracefully degrade — no flags if fetch failed
            });

            // ── Step 3: Classify clients ──────────────────────────────────────
            const enriched = classifyClients(clients, flagsMap);
            setEnrichedClients(enriched);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unable to load clients';
            if (msg.toLowerCase().includes('expired')) { await logout(); return; }
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [logout]);

    // Reload every time the Clients tab comes into focus
    useFocusEffect(useCallback(() => { loadDashboard(); }, [loadDashboard]));
    // Note: the initialFilter useFocusEffect above also runs on focus — order of
    // useFocusEffect calls is stable (filter is set synchronously before the
    // async loadDashboard completes, so the list renders with the correct filter).

    // ── Navigation helpers ────────────────────────────────────────────────────
    const goToClient = (client: EnrichedClient) =>
        navigation.navigate('ClientPayments', { clientId: client.clientId, clientName: client.clientName });

    // ── Computed sections ─────────────────────────────────────────────────────
    const totalClients = enrichedClients.length;

    // Apply search query filter
    const searched = enrichedClients.filter(c =>
        c.clientName.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Apply tab filter on top of search
    //
    // Filter semantics — must match the definitions in ClientsScreenParams:
    //   'followUp'   — payment/session renewal follow-up (plan expired, 0/low sessions, expiry ≤30d)
    //   'activePlan' — has a currently-running session plan (active OR expiring_soon)
    //   'noPlan'     — no plan assigned (plan_status absent or 'none')
    //   'missed'     — has not checked in today
    //   'all'        — every client
    const visibleClients = searched.filter(c => {
        switch (activeFilter) {
            case 'followUp':   return getRenewalBadge(c) !== null;
            case 'activePlan': return c.plan_status === 'active' || c.plan_status === 'expiring_soon';
            case 'noPlan':     return !c.plan_status || c.plan_status === 'none';
            case 'missed':     return !c.hasCheckedInToday && c.check_in_status !== 'paused';
            default:           return true; // 'all'
        }
    });

    // ── Full-screen loading ───────────────────────────────────────────────────
    if (loading && enrichedClients.length === 0) {
        return (
            <View style={s.loadingScreen}>
                <ActivityIndicator color={NAVY} size="large" />
                <Text style={s.loadingText}>Loading your clients…</Text>
            </View>
        );
    }

    // ── Filter counts ─────────────────────────────────────────────────────────
    // Computed from enrichedClients (full set, not searched/filtered) so counts
    // are stable regardless of the active filter or search query.
    const filterCounts: Record<ClientFilterKey, number> = {
        all:        enrichedClients.length,
        followUp:   enrichedClients.filter(c => getRenewalBadge(c) !== null).length,
        activePlan: enrichedClients.filter(c => c.plan_status === 'active' || c.plan_status === 'expiring_soon').length,
        noPlan:     enrichedClients.filter(c => !c.plan_status || c.plan_status === 'none').length,
        missed:     enrichedClients.filter(c => !c.hasCheckedInToday && c.check_in_status !== 'paused').length,
    };

    // Filter pill config — label includes count for quick orientation.
    // Order: All · Follow-Up · Active Plan · No Plan · Missed
    const FILTERS: { key: ClientFilterKey; label: string }[] = [
        { key: 'all',        label: `All ${filterCounts.all}` },
        { key: 'activePlan', label: `Active ${filterCounts.activePlan}` },
        { key: 'followUp',   label: `Follow-Up ${filterCounts.followUp}` },
        { key: 'noPlan',     label: `No Plan ${filterCounts.noPlan}` },
        { key: 'missed',     label: `Missed ${filterCounts.missed}` },
    ];

    return (
        <View style={s.screen}>

            {/* ── TOP CHROME — fixed, never scrolls ───────────────────────── */}
            <View style={[s.hero, { paddingTop: insets.top + 12 }]}>
                <View style={s.greetingRow}>
                    <View style={{ flex: 1 }}>
                        <Text style={[s.greeting, fontStyle(fonts.heading, '700')]}>My Clients</Text>
                        <Text style={[s.date, fontStyle(fonts.body, '400')]}>
                            {totalClients} client{totalClients !== 1 ? 's' : ''}
                            {filterCounts.followUp > 0
                                ? ` · ${filterCounts.followUp} need follow-up`
                                : ''}
                        </Text>
                    </View>
                    <TouchableOpacity onPress={handleLogout} style={s.logoutBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Sign out">
                        <Ionicons name="log-out-outline" size={20} color="#FFFFFF" />
                    </TouchableOpacity>
                </View>
            </View>

            <View style={s.chrome}>
                {/* Error banner */}
                {error && (
                    <View style={s.errorBanner}>
                        <Ionicons name="alert-circle-outline" size={16} color={colors.errorText} />
                        <Text style={s.errorText}>{error}</Text>
                        <TouchableOpacity onPress={loadDashboard}>
                            <Text style={s.retryText}>Retry</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Search bar */}
                <View style={s.searchWrap}>
                    <Ionicons name="search-outline" size={16} color={colors.placeholder} style={s.searchIcon} />
                    <TextInput
                        style={s.searchInput}
                        placeholder="Search clients…"
                        placeholderTextColor={colors.placeholder}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        returnKeyType="search"
                        clearButtonMode="while-editing"
                        autoCapitalize="none"
                        autoCorrect={false}
                        accessibilityLabel="Search clients"
                    />
                </View>

                {/* Filter pills */}
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={s.filterRow}
                    style={s.filterScroll}
                    keyboardShouldPersistTaps="handled"
                >
                    {FILTERS.map(f => {
                        const isActive = activeFilter === f.key;
                        return (
                            <TouchableOpacity
                                key={f.key}
                                style={[s.filterTab, isActive && s.filterTabActive]}
                                onPress={() => setActiveFilter(f.key)}
                                activeOpacity={0.76}
                                accessibilityRole="button"
                                accessibilityLabel={`Filter: ${f.label}`}
                            >
                                <Text style={[s.filterTabText, isActive && s.filterTabTextActive]}>
                                    {f.label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
            </View>

            {/* ── CLIENT LIST — fills remaining space ──────────────────────── */}
            <FlatList
                style={s.list}
                data={visibleClients}
                keyExtractor={item => item.clientId}
                renderItem={({ item }) => (
                    <AllClientsRow
                        client={item}
                        onPress={() => goToClient(item)}
                        activeFilter={activeFilter}
                    />
                )}
                ItemSeparatorComponent={null}   // rows use borderBottom — no separator needed
                contentContainerStyle={s.listContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                refreshControl={
                    <RefreshControl
                        refreshing={loading}
                        onRefresh={loadDashboard}
                        tintColor={NAVY}
                    />
                }
                ListEmptyComponent={
                    !loading ? (
                        totalClients === 0 ? (
                            // No clients at all — show add-client card
                            <View style={s.emptyScreen}>
                                <View style={s.emptyCard}>
                                    <View style={s.emptyIconWrap}>
                                        <Ionicons name="people-outline" size={36} color={NAVY} />
                                    </View>
                                    <Text style={s.emptyTitle}>No clients yet</Text>
                                    <Text style={s.emptyMsg}>
                                        Your client list is empty. Add clients from the menu icon in Clients.
                                    </Text>
                                    <TouchableOpacity
                                        style={s.emptyBtn}
                                        activeOpacity={0.82}
                                        onPress={() => Alert.alert(
                                            'How to Add a Client',
                                            'Go to Clients \u2192 tap the + icon or use the top-right menu to add a new client profile.',
                                            [{ text: 'Got it', style: 'default' }]
                                        )}
                                        accessibilityRole="button"
                                        accessibilityLabel="How to add a client"
                                    >
                                        <Text style={s.emptyBtnText}>How to add a client</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        ) : (
                            // Clients exist but filter/search returns nothing
                            <View style={s.emptyInlineCard}>
                                <Text style={s.emptyCardText}>
                                    {searchQuery
                                        ? `No clients match "${searchQuery}" — try a shorter name`
                                        : activeFilter === 'followUp'
                                            ? 'All clients have healthy plans ✅'
                                            : activeFilter === 'activePlan'
                                                ? 'No clients have an active plan'
                                                : activeFilter === 'noPlan'
                                                    ? 'All clients have an active plan'
                                                    : activeFilter === 'missed'
                                                        ? 'All clients have checked in today ✅'
                                                        : 'No clients in this category'}
                                </Text>
                            </View>
                        )
                    ) : null
                }
                ListFooterComponent={<View style={{ height: 24 }} />}
            />

        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({

    // ── Layout ────────────────────────────────────────────────────────────────
    screen: {
        flex: 1,
        backgroundColor: colors.background,
    },
    // ── Chrome (non-scrolling top section) ──────────────────────────────────
    hero: {
        backgroundColor: palette.primary,
        paddingHorizontal: 20,
        paddingBottom: 22,
    },
    chrome: {
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 8,
        backgroundColor: colors.background,
    },

    // ── FlatList (fills remaining screen height) ──────────────────────────────
    list: {
        flex: 1,
        backgroundColor: colors.background,
    },
    listContent: {
        paddingHorizontal: 16,
        paddingTop: 4,
    },

    // ── Full-screen loading ───────────────────────────────────────────────────
    loadingScreen: {
        flex: 1,
        backgroundColor: colors.background,
        justifyContent: 'center',
        alignItems: 'center',
        gap: spacing.md,
    },
    loadingText: { ...typography.body, color: colors.textSecondary },

    // ── Greeting block ────────────────────────────────────────────────────────
    greetingBlock: { marginBottom: 8 },
    greetingRow: { flexDirection: 'row', alignItems: 'flex-start' },
    greeting: {
        fontSize: 28,
        color: '#FFFFFF',
        letterSpacing: -0.4,
        marginBottom: 4,
    },
    date: { ...typography.body, color: 'rgba(255,255,255,0.78)' },
    logoutBtn: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: 'rgba(255,255,255,0.12)',
        alignItems: 'center', justifyContent: 'center',
    },

    // ── Error banner ──────────────────────────────────────────────────────────
    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        backgroundColor: colors.errorBg,
        borderWidth: 1,
        borderColor: colors.errorBorder,
        borderRadius: radius.md,
        padding: spacing.md,
        marginBottom: spacing.lg,
    },
    errorText: { ...typography.caption, color: colors.errorText, flex: 1 },
    retryText: { ...typography.label, color: NAVY },

    // ── Sections ──────────────────────────────────────────────────────────────
    section: { marginBottom: 8 },
    sectionLabel: {
        ...typography.micro,
        color: colors.textSecondary,
        letterSpacing: 1,
        fontWeight: '700',
        marginBottom: spacing.md,
    },

    // ── Search bar ────────────────────────────────────────────────────────────
    searchWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: spacing.md,
        marginBottom: 8,    // tight gap between search and pills
        height: 44,
    },
    searchIcon: { marginRight: spacing.xs },
    searchInput: {
        flex: 1,
        fontSize: 15,
        color: colors.textPrimary,
        paddingVertical: 0,
    },

    // ── Filter tabs — compact pill controls ─────────────────────────────────
    filterScroll: {
        marginBottom: 8,
    },
    filterRow: { gap: 7, paddingRight: 4 },
    filterTab: {
        height:           36,            // explicit height — never grows from parent
        paddingHorizontal: 14,
        borderRadius:      50,           // full pill
        justifyContent:   'center',     // vertical centering of text within fixed height
        alignItems:       'center',
        alignSelf:        'flex-start', // critical: shrink-wraps to content width, no vertical fill
        backgroundColor:   colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
    },
    filterTabActive: {
        backgroundColor: NAVY,
        borderColor: NAVY,
    },
    filterTabText: {
        fontSize:   13,
        fontWeight: '600',
        color:      '#6B7280',
        lineHeight: 18,                 // prevents text from pulling height
    },
    filterTabTextActive: {
        color: '#FFFFFF',
    },

    // ── Overview row ──────────────────────────────────────────────────────────
    overviewRow: {
        flexDirection: 'row',
        gap: spacing.sm,
    },

    // ── Card list wrapper ─────────────────────────────────────────────────────
    listCard: {
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
        ...shadows.card,
    },
    lastRowFix: {
        // Hides the bottom border of the last row inside a listCard
        backgroundColor: colors.surface,
        height: 1,
        marginHorizontal: spacing.base,
    },

    // ── Empty states ──────────────────────────────────────────────────────────

    // Centering shell — sits below the header, fills remaining height
    emptyScreen: {
        // No flex:1 here — flexGrow:1 on the ScrollView contentContainer does the work.
        // justifyContent:'center' centres the card in the remaining available space.
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingVertical: 48,
    },

    // Premium white card wrapping the empty state content
    emptyCard: {
        width: '100%',
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 28,
        alignItems: 'center',
        gap: 14,
        ...shadows.cardElevated,
    },

    // Icon circle
    emptyIconWrap: {
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: colors.accentSubtle,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 4,
    },

    emptyTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: NAVY,
        letterSpacing: -0.3,
        textAlign: 'center',
    },
    emptyMsg: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
        lineHeight: 22,
    },

    // Full-width primary CTA
    emptyBtn: {
        width: '100%',
        height: 52,
        backgroundColor: NAVY,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 6,
    },
    emptyBtnText: {
        fontSize: 16,
        fontWeight: '700',
        color: '#FFFFFF',
        letterSpacing: 0.2,
    },

    // Inline empty card used inside sections (e.g. "All clients on track today")
    emptyInlineCard: {
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.successBorder,
        paddingVertical: spacing.md,
        alignItems: 'center',
        ...shadows.card,
    },
    emptyCardText: { ...typography.body, color: colors.badgeSuccessText },
});

