import React, { useEffect, useState, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Alert,
    ScrollView, ActivityIndicator, Clipboard,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { getDashboard, getInviteCode } from '../services/apiClient';
import { colors, spacing, radius, typography, shadows } from '../theme/theme';
import { DashboardSummary } from '../types';

/**
 * CoachProfileScreen — professional coaching dashboard identity.
 *
 * Client profile  → consumes service: shows plan, progress, contact coach.
 * Coach profile   → manages service: shows client count, operational quick-links,
 *                   and account details. The Overview section makes the coach feel
 *                   in control of their business, not just a user of the app.
 *
 * Data: getDashboard() is already fetched on the Dashboard screen — we call it
 *       here too (lightweight, cached by server) to keep this screen self-contained.
 */
export default function CoachProfileScreen() {
    const { user, logout } = useAuth();

    const [dashboard,    setDashboard]    = useState<DashboardSummary | null>(null);
    const [dashLoading,  setDashLoading]  = useState(true);
    const [inviteCode,   setInviteCode]   = useState<string | null>(null);
    const [inviteMsg,    setInviteMsg]    = useState<string>('');
    const [codeLoading,  setCodeLoading]  = useState(true);
    const [codeCopied,   setCodeCopied]   = useState(false);

    useEffect(() => {
        getDashboard()
            .then(data => setDashboard(data))
            .catch(() => setDashboard(null))
            .finally(() => setDashLoading(false));

        getInviteCode()
            .then(data => { setInviteCode(data.inviteCode); setInviteMsg(data.shareMessage); })
            .catch(() => setInviteCode(null))
            .finally(() => setCodeLoading(false));
    }, []);

    const handleCopyCode = useCallback(() => {
        if (!inviteCode) return;
        Clipboard.setString(inviteCode);
        setCodeCopied(true);
        setTimeout(() => setCodeCopied(false), 2000);
    }, [inviteCode]);

    const handleLogout = () => {
        Alert.alert(
            'Sign out',
            'Are you sure you want to sign out?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Sign out',
                    style: 'destructive',
                    onPress: async () => {
                        await logout();
                        // RootNavigator reacts to token=null automatically
                    },
                },
            ]
        );
    };

    return (
        <ScrollView style={s.list} contentContainerStyle={s.content}>

            {/* ── Hero ──────────────────────────────────────────────────────── */}
            <View style={s.hero}>
                <View style={s.avatar}>
                    <Text style={s.avatarInitials}>{getInitials(user?.name ?? '?')}</Text>
                </View>
                <Text style={s.name}>{user?.name ?? '—'}</Text>
                <Text style={s.email}>{user?.email ?? '—'}</Text>
                <View style={s.rolePill}>
                    <Text style={s.roleText}>Coach account</Text>
                </View>
            </View>

            {/* ── Overview (coach-specific) ──────────────────────────────────── */}
            <Text style={s.sectionLabel}>Overview</Text>
            {dashLoading ? (
                <View style={s.loadingCard}>
                    <ActivityIndicator size="small" color={colors.accent} />
                </View>
            ) : (
                <View style={s.statRow}>
                    <StatTile
                        value={dashboard?.total_clients ?? 0}
                        label="Total Clients"
                        icon="👥"
                    />
                    <StatTile
                        value={dashboard?.today_bookings?.length ?? 0}
                        label="Today's Sessions"
                        icon="📅"
                    />
                    <StatTile
                        value={dashboard?.pending_payments_count ?? 0}
                        label="Pending Payments"
                        icon="💳"
                        highlight={
                            (dashboard?.pending_payments_count ?? 0) > 0
                        }
                    />
                </View>
            )}

            {/* ── Invite Code ───────────────────────────────────────────────── */}
            <Text style={s.sectionLabel}>Client Invite Code</Text>
            <View style={s.infoCard}>
                {codeLoading ? (
                    <View style={ic.loading}>
                        <ActivityIndicator size="small" color={colors.accent} />
                    </View>
                ) : inviteCode ? (
                    <View style={ic.body}>
                        <Text style={ic.hint}>Share this code with new clients so they can register and join your program.</Text>
                        <View style={ic.codeRow}>
                            <Text style={ic.code}>{inviteCode}</Text>
                            <TouchableOpacity
                                style={[ic.copyBtn, codeCopied && ic.copyBtnSuccess]}
                                onPress={handleCopyCode}
                                activeOpacity={0.8}
                                accessibilityRole="button"
                                accessibilityLabel="Copy invite code"
                            >
                                <Text style={ic.copyTxt}>{codeCopied ? '✓ Copied' : 'Copy'}</Text>
                            </TouchableOpacity>
                        </View>
                        <TouchableOpacity
                            style={ic.shareBtn}
                            onPress={() => {
                                Clipboard.setString(inviteMsg);
                                Alert.alert('Message copied!', 'Paste it into WhatsApp to share with your client.');
                            }}
                            accessibilityRole="button"
                        >
                            <Text style={ic.shareTxt}>📋  Copy WhatsApp share message</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={ic.loading}>
                        <Text style={ic.hint}>Could not load invite code. Pull to refresh.</Text>
                    </View>
                )}
            </View>

            {/* ── Account ───────────────────────────────────────────────────── */}
            <Text style={s.sectionLabel}>Account</Text>
            <View style={s.infoCard}>
                <InfoRow label="Name"  value={user?.name  ?? '—'} />
                <InfoRow label="Email" value={user?.email ?? '—'} last />
            </View>

            {/* ── App ───────────────────────────────────────────────────────── */}
            <Text style={s.sectionLabel}>App</Text>
            <View style={s.infoCard}>
                <InfoRow label="Role"    value="Coach" />
                <InfoRow label="Version" value="FitnessGuruSG 1.0" last />
            </View>

            {/* ── Sign out ──────────────────────────────────────────────────── */}
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
    );
}

// ── StatTile — overview metric tile ──────────────────────────────────────────

function StatTile({
    value, label, icon, highlight = false,
}: {
    value: number;
    label: string;
    icon: string;
    highlight?: boolean;
}) {
    return (
        <View style={[st.tile, highlight && st.tileHighlight]}>
            <Text style={st.icon}>{icon}</Text>
            <Text style={[st.value, highlight && st.valueHighlight]}>
                {value}
            </Text>
            <Text style={st.label}>{label}</Text>
        </View>
    );
}

const st = StyleSheet.create({
    tile: {
        flex: 1,
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        paddingVertical: spacing.base,
        alignItems: 'center',
        ...shadows.card,
    },
    tileHighlight: {
        borderColor: colors.warningBorder,
        backgroundColor: colors.warningBg,
    },
    icon:  { fontSize: 20, marginBottom: spacing.xs },
    value: {
        ...typography.h2,
        color: colors.textPrimary,
        marginBottom: 2,
    },
    valueHighlight: { color: colors.badgeWarningText },
    label: {
        ...typography.micro,
        color: colors.textSecondary,
        textAlign: 'center',
        lineHeight: 14,
    },
});

// ── ic — Invite code card styles ──────────────────────────────────────────────

const ic = StyleSheet.create({
    loading: {
        padding: spacing.base,
        alignItems: 'center',
    },
    body: {
        padding: spacing.base,
        gap: spacing.sm,
    },
    hint: {
        ...typography.label,
        color: colors.textSecondary,
        fontWeight: '400',
        lineHeight: 18,
    },
    codeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    code: {
        ...typography.h2,
        color: colors.accent,
        letterSpacing: 4,
        fontWeight: '800',
        flex: 1,
    },
    copyBtn: {
        backgroundColor: colors.accentSubtle,
        borderRadius: radius.md,
        paddingHorizontal: spacing.base,
        paddingVertical: spacing.sm,
    },
    copyBtnSuccess: {
        backgroundColor: '#DCFCE7',
    },
    copyTxt: {
        ...typography.label,
        color: colors.accent,
        fontWeight: '700',
    },
    shareBtn: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.md,
        paddingHorizontal: spacing.base,
        paddingVertical: spacing.sm,
        alignItems: 'center',
    },
    shareTxt: {
        ...typography.label,
        color: colors.textPrimary,
        fontWeight: '600',
    },
});

// ── InfoRow — label / value row ───────────────────────────────────────────────

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
    return (
        <View style={[ir.row, !last && ir.divider]}>
            <Text style={ir.label}>{label}</Text>
            <Text style={ir.value} numberOfLines={1}>{value}</Text>
        </View>
    );
}

const ir = StyleSheet.create({
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: spacing.base,
        paddingVertical: spacing.md,
    },
    divider: {
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    label: { ...typography.body, color: colors.textSecondary },
    value: {
        ...typography.body,
        color: colors.textPrimary,
        fontWeight: '500',
        maxWidth: '60%',
        textAlign: 'right',
    },
});


// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    list:    { flex: 1, backgroundColor: colors.background },
    content: {
        paddingTop: spacing.xl,
        paddingHorizontal: spacing.base,
        paddingBottom: spacing.section,
    },

    // Hero
    hero: { alignItems: 'center', marginBottom: spacing.xxl },
    avatar: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: colors.statBg,   // deep navy-teal — authority
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.base,
        ...shadows.cardElevated,
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
    roleText: { ...typography.label, color: colors.accent },

    // Section label
    sectionLabel: {
        ...typography.micro,
        color: colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: spacing.sm,
        marginTop: spacing.xs,
    },

    // Stat tiles row
    statRow: {
        flexDirection: 'row',
        gap: spacing.sm,
        marginBottom: spacing.xl,
    },

    // Loading placeholder for stats
    loadingCard: {
        height: 90,
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.xl,
    },

    // Info / nav card
    infoCard: {
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        marginBottom: spacing.xl,
        ...shadows.card,
    },

    // Sign out
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
