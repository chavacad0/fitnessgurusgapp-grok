import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography } from '../theme/theme';

/**
 * CheckInCard — shared component used by both roles:
 *
 *  COACH VIEW: InsightsScreen renders a client's check-in record when reviewing.
 *  CLIENT VIEW: ClientProgressScreen renders the client's own historical check-ins.
 *
 * WHY a shared component?
 *   The data shape is identical regardless of who's viewing it.
 *   One component = one source of truth for how a check-in is displayed.
 *   If the UI changes (e.g. new metric field), it updates for both roles at once.
 *
 * Props are intentionally minimal — pass only what you have.
 * The card gracefully omits fields that are null/undefined.
 */

export interface CheckInCardData {
    date: string;                  // display string e.g. "01 Apr 2026"
    energy: number;                // 1–10
    hunger: number;                // 1–10
    steps?: number | null;
    notes?: string | null;
    detectedFlagCount?: number;    // coach view: show red flag badge if > 0
    clientName?: string;           // coach view only: show whose check-in this is
}

interface Props {
    data: CheckInCardData;
    /** If true, renders in a compact single-line style (e.g. in a FlatList). Default false. */
    compact?: boolean;
}

export default function CheckInCard({ data, compact = false }: Props) {
    const hasFlags = (data.detectedFlagCount ?? 0) > 0;

    return (
        <View style={[s.card, compact && s.cardCompact]}>
            {/* ── Header row ────────────────────────────────────────────── */}
            <View style={s.header}>
                <View style={s.headerLeft}>
                    {data.clientName ? (
                        <Text style={s.clientName}>{data.clientName}</Text>
                    ) : null}
                    <Text style={s.date}>{data.date}</Text>
                </View>

                {hasFlags ? (
                    <View style={s.flagBadge}>
                        <Text style={s.flagText}>
                            ⚠ {data.detectedFlagCount} flag{data.detectedFlagCount! > 1 ? 's' : ''}
                        </Text>
                    </View>
                ) : (
                    <View style={s.okBadge}>
                        <Text style={s.okText}>✓ OK</Text>
                    </View>
                )}
            </View>

            {/* ── Metrics row ───────────────────────────────────────────── */}
            {!compact ? (
                <View style={s.metricsRow}>
                    <MetricPill label="Energy" value={data.energy} total={10} accent={colors.accent} />
                    {/* UI label is "Appetite," but data field remains `hunger` for backward compatibility. */}
                    <MetricPill label="Appetite" value={data.hunger} total={10} accent={'#F59E0B'} />
                    {data.steps != null ? (
                        <MetricPill label="Steps" value={data.steps} total={null} />
                    ) : null}
                </View>
            ) : (
                /* Compact: one-liner metrics */
                <Text style={s.compactMetrics}>
                    Energy {data.energy}/10 · Appetite {data.hunger}/10
                    {data.steps != null ? ` · ${data.steps.toLocaleString()} steps` : ''}
                </Text>
            )}

            {/* ── Notes ─────────────────────────────────────────────────── */}
            {data.notes && !compact ? (
                <View style={s.notesBox}>
                    <Text style={s.notesLabel}>Notes</Text>
                    <Text style={s.notesText}>{data.notes}</Text>
                </View>
            ) : null}
        </View>
    );
}

// ── Sub-component: MetricPill ─────────────────────────────────────────────────

interface MetricPillProps {
    label: string;
    value: number;
    total: number | null;
    accent?: string;
}

function MetricPill({ label, value, total, accent = colors.textSecondary }: MetricPillProps) {
    return (
        <View style={mp.pill}>
            <Text style={mp.label}>{label}</Text>
            <Text style={[mp.value, { color: accent }]}>
                {total != null ? `${value}/${total}` : value.toLocaleString()}
            </Text>
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    card: {
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.base,
        marginBottom: spacing.sm,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 3,
        elevation: 1,
    },
    cardCompact: {
        paddingVertical: spacing.sm,
    },

    // Header
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: spacing.sm,
    },
    headerLeft: { flex: 1 },
    clientName: {
        ...typography.label,
        color: colors.textPrimary,
        fontWeight: '600',
        marginBottom: 2,
    },
    date: {
        ...typography.caption,
        color: colors.textSecondary,
    },

    // Badges
    flagBadge: {
        backgroundColor: colors.errorBg,
        borderWidth: 1,
        borderColor: colors.errorBorder,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.sm,
        paddingVertical: 3,
    },
    flagText: {
        fontSize: 11,
        fontWeight: '600',
        color: colors.errorText,
    },
    okBadge: {
        backgroundColor: colors.successBg ?? '#ECFDF5',
        borderWidth: 1,
        borderColor: colors.successBorder ?? '#6EE7B7',
        borderRadius: radius.pill,
        paddingHorizontal: spacing.sm,
        paddingVertical: 3,
    },
    okText: {
        fontSize: 11,
        fontWeight: '600',
        color: '#059669',
    },

    // Metrics
    metricsRow: {
        flexDirection: 'row',
        gap: spacing.sm,
        marginBottom: spacing.sm,
    },
    compactMetrics: {
        ...typography.caption,
        color: colors.textSecondary,
    },

    // Notes
    notesBox: {
        backgroundColor: colors.background,
        borderRadius: radius.md,
        padding: spacing.sm,
        borderWidth: 1,
        borderColor: colors.border,
    },
    notesLabel: {
        ...typography.micro,
        color: colors.textSecondary,
        textTransform: 'uppercase',
        marginBottom: 2,
    },
    notesText: {
        ...typography.caption,
        color: colors.textPrimary,
    },
});

const mp = StyleSheet.create({
    pill: {
        flex: 1,
        backgroundColor: colors.background,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.sm,
        alignItems: 'center',
    },
    label: {
        ...typography.micro,
        color: colors.textSecondary,
        textTransform: 'uppercase',
        marginBottom: 2,
    },
    value: {
        ...typography.bodyLg,
        fontWeight: '700',
    },
});
