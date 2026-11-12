/**
 * StatusBadge — coloured pill for plan, booking, and check-in states.
 *
 * Named variants match the design board. Pass `label` to override the words.
 *
 *   <StatusBadge variant="activePlan" />
 *   <StatusBadge variant="booked" label="Upcoming" />
 *
 * The older `status` + `label` form still works:
 *   <StatusBadge status="active" label="Active Plan" />
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { badgeColors, radius, spacing } from '../theme/theme';
import { fontStyle, useKitFonts } from '../theme/fonts';

export type BadgeVariant =
    | 'activePlan'
    | 'followUp'
    | 'noPlan'
    | 'missedCheckIn'
    | 'completed'
    | 'cancelled'
    | 'open'
    | 'booked'
    | 'expiringSoon';

/** Older presets. Each one maps onto a design-board variant. */
export type BadgeStatus = 'active' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';

const VARIANT_LABELS: Record<BadgeVariant, string> = {
    activePlan:    'Active Plan',
    followUp:      'Follow-Up',
    noPlan:        'No Plan',
    missedCheckIn: 'Missed Check-In',
    completed:     'Completed',
    cancelled:     'Cancelled',
    open:          'Open',
    booked:        'Booked',
    expiringSoon:  'Expiring Soon',
};

const LEGACY_TO_VARIANT: Record<BadgeStatus, BadgeVariant> = {
    active:  'completed',
    warning: 'followUp',
    danger:  'missedCheckIn',
    info:    'booked',
    neutral: 'noPlan',
    accent:  'open',
};

type StatusBadgeProps = {
    compact?: boolean;
} & (
    | { variant: BadgeVariant; label?: string; status?: never }
    | { status: BadgeStatus; label: string; variant?: never }
);

function resolve(props: StatusBadgeProps): { variant: BadgeVariant; label: string } {
    if (props.variant) {
        return {
            variant: props.variant,
            label: props.label ?? VARIANT_LABELS[props.variant],
        };
    }
    return {
        variant: LEGACY_TO_VARIANT[props.status],
        label: props.label,
    };
}

export default function StatusBadge(props: StatusBadgeProps) {
    const fonts = useKitFonts();
    const { variant, label } = resolve(props);
    const colors = badgeColors[variant];
    const compact = props.compact ?? false;

    return (
        <View
            style={[
                s.pill,
                { backgroundColor: colors.background },
                compact && s.pillCompact,
            ]}
            accessibilityRole="text"
            accessibilityLabel={label}
        >
            <Text
                style={[
                    s.label,
                    { color: colors.text },
                    fontStyle(fonts.bodySemibold, '600'),
                    compact && s.labelCompact,
                ]}
                numberOfLines={1}
            >
                {label}
            </Text>
        </View>
    );
}

const s = StyleSheet.create({
    pill: {
        borderRadius: radius.pill,
        paddingHorizontal: spacing.sm + 2,
        paddingVertical: 4,
        alignSelf: 'flex-start',
    },
    pillCompact: {
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    label: {
        fontSize: 11,
        letterSpacing: 0.2,
        includeFontPadding: false,
    },
    labelCompact: {
        fontSize: 10,
    },
});
