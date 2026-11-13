import React, { useEffect, useState, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Alert,
    ScrollView, ActivityIndicator, Clipboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { getDashboard, getInviteCode } from '../services/apiClient';
import { colors, spacing, radius, typography, shadows, palette } from '../theme/theme';
import { fontStyle, useKitFonts } from '../theme/fonts';
import UserAvatar from '../components/UserAvatar';
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
    const insets = useSafeAreaInsets();
    const fonts = useKitFonts();
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

    const displayName = user?.name?.trim() || '—';

    return (
        <ScrollView style={s.list} contentContainerStyle={s.content}>
            <View style={[s.hero, { paddingTop: insets.top + spacing.md }]}>
                <Text style={[s.heroTitle, fontStyle(fonts.heading, '700')]}>Profile</Text>
                <View style={s.identity}>
                    <UserAvatar name={displayName === '—' ? '?' : displayName} size={64} bgColor="rgba(255,255,255,0.16)" textColor="#FFFFFF" />
                    <View style={{ flex: 1 }}>
                        <Text style={[s.name, fontStyle(fonts.heading, '700')]}>{displayName}</Text>
                        <Text style={s.email}>{user?.email ?? '—'}</Text>
                        <View style={s.rolePill}>
                            <Text style={s.roleText}>Coach account</Text>
                        </View>
                    </View>
                </View>
            </View>

            <View style={s.sheet}>
            <View style={s.infoCard}>
                {codeLoading ? (
                    <View style={ic.loading}>
                        <ActivityIndicator size="small" color={colors.accent} />
                    </View>
                ) : inviteCode ? (
                    <View style={ic.body}>
                        <Text style={ic.kicker}>CLIENT INVITE CODE</Text>
                        <Text style={ic.hint}>New clients enter this when they sign up.</Text>
                        <View style={ic.codeBox}>
                            <Text style={[ic.code, fontStyle(fonts.heading, '700')]}>{inviteCode}</Text>
                            <TouchableOpacity
                                style={[ic.copyBtn, codeCopied && ic.copyBtnSuccess]}
                                onPress={handleCopyCode}
                                activeOpacity={0.8}
                                accessibilityRole="button"
                                accessibilityLabel="Copy invite code"
                            >
                                <Ionicons name="copy-outline" size={14} color="#FFFFFF" />
                                <Text style={ic.copyTxt}>{codeCopied ? 'Copied' : 'Copy'}</Text>
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
                            <Ionicons name="logo-whatsapp" size={16} color={palette.primary} />
                            <Text style={ic.shareTxt}>Copy WhatsApp share message</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={ic.loading}>
                        <Text style={ic.hint}>Could not load invite code. Pull to refresh.</Text>
                    </View>
                )}
            </View>

            <Text style={s.sectionLabel}>Overview</Text>
            {dashLoading ? (
                <View style={s.loadingCard}>
                    <ActivityIndicator size="small" color={colors.accent} />
                </View>
            ) : (
                <View style={s.statRow}>
                    <StatTile
                        value={dashboard?.total_clients ?? 0}
                        label="Total clients"
                        highlight={false}
                        navy
                    />
                    <StatTile
                        value={dashboard?.today_bookings?.length ?? 0}
                        label="Today's sessions"
                    />
                    <StatTile
                        value={dashboard?.pending_payments_count ?? 0}
                        label="Pending payments"
                        highlight={(dashboard?.pending_payments_count ?? 0) > 0}
                    />
                </View>
            )}

            <Text style={s.sectionLabel}>Account</Text>
            <View style={s.infoCard}>
                <InfoRow label="Name"  value={user?.name  ?? '—'} />
                <InfoRow label="Email" value={user?.email ?? '—'} />
                <InfoRow label="Role"  value="Coach" />
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
            </View>

        </ScrollView>
    );
}

// ── StatTile — overview metric tile ──────────────────────────────────────────

function StatTile({
    value, label, highlight = false, navy = false,
}: {
    value: number;
    label: string;
    highlight?: boolean;
    navy?: boolean;
}) {
    const fonts = useKitFonts();
    return (
        <View style={[st.tile, highlight && st.tileHighlight, navy && st.tileNavy]}>
            <Text style={[st.value, highlight && st.valueHighlight, navy && st.valueNavy, fontStyle(fonts.heading, '800')]}>
                {value}
            </Text>
            <Text style={[st.label, navy && st.labelNavy]}>{label}</Text>
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
    tileNavy: { backgroundColor: palette.primary, borderWidth: 0 },
    valueNavy: { color: '#FFFFFF' },
    labelNavy: { color: 'rgba(255,255,255,0.75)' },
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
    kicker: {
        fontSize: 11, fontWeight: '700', letterSpacing: 0.8, color: colors.textSecondary,
    },
    hint: {
        ...typography.caption,
        color: colors.textSecondary,
        lineHeight: 18,
    },
    codeBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: palette.teal,
        backgroundColor: colors.accentSubtle,
        borderRadius: radius.md,
        padding: spacing.md,
    },
    code: {
        fontSize: 22,
        color: palette.primary,
        letterSpacing: 1,
        flex: 1,
    },
    copyBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: palette.teal,
        borderRadius: radius.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
    },
    copyBtnSuccess: {
        backgroundColor: '#DCFCE7',
    },
    copyTxt: {
        ...typography.label,
        color: '#FFFFFF',
        fontWeight: '700',
    },
    shareBtn: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: spacing.sm,
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

const s = StyleSheet.create({
    list:    { flex: 1, backgroundColor: colors.background },
    content: { paddingBottom: spacing.section },
    hero: {
        backgroundColor: palette.primary,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.xxl,
    },
    heroTitle: { fontSize: 28, color: '#FFFFFF', marginBottom: spacing.md },
    identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
    sheet: {
        marginTop: -spacing.lg,
        paddingHorizontal: spacing.base,
    },
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
        color: '#FFFFFF',
        marginBottom: 2,
    },
    email: {
        ...typography.body,
        color: 'rgba(255,255,255,0.75)',
        marginBottom: spacing.sm,
    },
    rolePill: {
        alignSelf: 'flex-start',
        backgroundColor: 'rgba(255,255,255,0.14)',
        borderRadius: radius.pill,
        paddingHorizontal: spacing.md,
        paddingVertical: 4,
    },
    roleText: { ...typography.label, color: '#FFFFFF' },

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
