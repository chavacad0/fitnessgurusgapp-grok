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

    return (
        <View
            style={[s.wrap, props.fill && s.fill]}
            accessible
            accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
        >
            <View style={s.iconCircle} importantForAccessibility="no">
                <Ionicons name={icon} size={32} color={palette.teal} />
            </View>
            <Text style={[s.title, fontStyle(fonts.headingSemibold, '600')]}>
                {title}
            </Text>
            {subtitle ? (
                <Text style={[s.subtitle, fontStyle(fonts.body, '400')]}>
                    {subtitle}
                </Text>
            ) : null}
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
