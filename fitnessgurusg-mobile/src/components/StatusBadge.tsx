/**
 * StatusBadge — Reusable status pill for FitnessGuruSG.
 *
 * Renders a colored pill badge for client/plan/booking statuses.
 *
 * Presets:
 *   'active'   → green (checked-in, active plan, on-track)
 *   'warning'  → amber (follow-up, low sessions, expiring soon)
 *   'danger'   → red   (expired, missed, failed)
 *   'info'     → blue  (booked, informational)
 *   'neutral'  → gray  (no plan, paused, default)
 *   'accent'   → teal  (special highlights)
 *
 * Usage:
 *   <StatusBadge status="active" label="Active Plan" />
 *   <StatusBadge status="warning" label="Follow-up" />
 *   <StatusBadge status="danger" label="Expired" />
 *   <StatusBadge status="neutral" label="Paused" />
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, spacing, typography } from '../theme/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BadgeStatus = 'active' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';

interface StatusBadgeProps {
    /** Visual status preset */
    status: BadgeStatus;
    /** Text displayed inside the badge */
    label: string;
    /** Optional compact mode — reduces padding */
    compact?: boolean;
}

// ─── Color map ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<BadgeStatus, { bg: string; text: string; border: string }> = {
    active: {
        bg:     colors.badgeSuccessBg,
        text:   colors.badgeSuccessText,
        border: colors.successBorder,
    },
    warning: {
        bg:     colors.badgeWarningBg,
        text:   colors.badgeWarningText,
        border: colors.amberBorder,
    },
    danger: {
        bg:     colors.errorBg,
        text:   colors.errorText,
        border: colors.errorBorder,
    },
    info: {
        bg:     colors.infoBg,
        text:   colors.infoText,
        border: colors.infoBorder,
    },
    neutral: {
        bg:     colors.badgeNeutralBg,
        text:   colors.badgeNeutralText,
        border: colors.border,
    },
    accent: {
        bg:     colors.accentSubtle,
        text:   colors.accent,
        border: colors.accent + '33', // 20% opacity
    },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function StatusBadge({ status, label, compact = false }: StatusBadgeProps) {
    const palette = STATUS_COLORS[status];

    return (
        <View
            style={[
                s.pill,
                {
                    backgroundColor: palette.bg,
                    borderColor: palette.border,
                },
                compact && s.pillCompact,
            ]}
            accessibilityRole="text"
            accessibilityLabel={label}
        >
            <Text
                style={[
                    s.label,
                    { color: palette.text },
                    compact && s.labelCompact,
                ]}
                numberOfLines={1}
            >
                {label}
            </Text>
        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    pill: {
        borderRadius: radius.pill,
        borderWidth: 1,
        paddingHorizontal: spacing.sm,
        paddingVertical: 3,
        alignSelf: 'flex-start',
    },
    pillCompact: {
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    label: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.3,
    },
    labelCompact: {
        fontSize: 10,
    },
});
