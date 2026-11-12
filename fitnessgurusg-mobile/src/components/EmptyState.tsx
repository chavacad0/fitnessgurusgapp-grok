/**
 * EmptyState — simple placeholder for a list with nothing in it.
 *
 * A circle and an icon stand in for an illustration. No photos.
 *
 *   <EmptyState preset="noBookings" />
 *   <EmptyState
 *     preset="noClients"
 *     actionLabel="Add a client"
 *     onAction={openAdd}
 *   />
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, tints, spacing } from '../theme/theme';
import { fontStyle, useKitFonts } from '../theme/fonts';
import Button from './Button';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export type EmptyPreset = 'noBookings' | 'noSessions' | 'noClients';

const PRESETS: Record<EmptyPreset, { icon: IoniconName; title: string; subtitle: string }> = {
    noBookings: {
        icon: 'calendar-outline',
        title: 'No bookings yet',
        subtitle: 'Pick a session and start your journey.',
    },
    noSessions: {
        icon: 'calendar-outline',
        title: 'No sessions today',
        subtitle: 'Enjoy your day! You\'re all caught up.',
    },
    noClients: {
        icon: 'clipboard-outline',
        title: 'No clients yet',
        subtitle: 'Add your first client to get started.',
    },
};

type EmptyStateProps = {
    /** Overrides the preset icon. */
    icon?: IoniconName;
    /** Overrides the preset subtitle. */
    subtitle?: string;
    actionLabel?: string;
    onAction?: () => void;
    /** Grow to fill the parent and centre the message. Useful inside a list. */
    fill?: boolean;
    /** A short row for a section that is empty, instead of a tall centred block. */
    compact?: boolean;
} & (
    | { preset: EmptyPreset; title?: string }
    | { preset?: undefined; title: string }
);

export default function EmptyState(props: EmptyStateProps) {
    const fonts = useKitFonts();
    const preset = props.preset ? PRESETS[props.preset] : undefined;
    const icon = props.icon ?? preset?.icon ?? 'file-tray-outline';
    const title = props.title ?? preset?.title ?? '';
    const subtitle = props.subtitle ?? preset?.subtitle;
    const showAction = Boolean(props.actionLabel && props.onAction);
    const compact = props.compact ?? false;

    return (
        <View
            style={[s.wrap, compact && s.wrapCompact, props.fill && s.fill]}
            accessible
            accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
        >
            <View style={[s.iconCircle, compact && s.iconCircleCompact]} importantForAccessibility="no">
                <Ionicons name={icon} size={compact ? 20 : 32} color={palette.teal} />
            </View>
            <View style={compact ? s.compactText : undefined}>
                <Text style={[compact ? s.titleCompact : s.title, fontStyle(fonts.headingSemibold, '600')]}>
                    {title}
                </Text>
                {subtitle ? (
                    <Text style={[s.subtitle, compact && s.subtitleCompact, fontStyle(fonts.body, '400')]}>
                        {subtitle}
                    </Text>
                ) : null}
            </View>
            {showAction ? (
                <View style={s.action}>
                    <Button label={props.actionLabel!} onPress={props.onAction!} />
                </View>
            ) : null}
        </View>
    );
}

const s = StyleSheet.create({
    wrap: {
        alignItems: 'center',
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.xxl,
    },
    fill: {
        flex: 1,
        justifyContent: 'center',
    },
    wrapCompact: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.base,
        paddingVertical: spacing.base,
    },
    iconCircleCompact: {
        width: 40,
        height: 40,
        borderRadius: 20,
        marginBottom: 0,
        marginRight: spacing.md,
    },
    compactText: {
        flex: 1,
    },
    titleCompact: {
        fontSize: 15,
        color: palette.gray900,
        textAlign: 'left',
    },
    subtitleCompact: {
        textAlign: 'left',
        fontSize: 13,
        lineHeight: 18,
        marginTop: 2,
    },
    iconCircle: {
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: tints.tealSoft,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.base,
    },
    title: {
        fontSize: 18,
        color: palette.gray900,
        textAlign: 'center',
        marginBottom: spacing.xs,
    },
    subtitle: {
        fontSize: 15,
        lineHeight: 22,
        color: palette.gray600,
        textAlign: 'center',
    },
    action: {
        marginTop: spacing.lg,
    },
});
