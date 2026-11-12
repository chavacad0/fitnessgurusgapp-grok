/**
 * SessionTypeIcon — the six session kinds from the design board.
 *
 * Each one is a teal icon on a pale rounded square. Pass showLabel to put
 * the name underneath. These are Ionicons, not custom artwork.
 *
 *   <SessionTypeIcon type="inPerson" showLabel />
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, tints, radius, spacing } from '../theme/theme';
import { fontStyle, useKitFonts } from '../theme/fonts';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export type SessionType =
    | 'inPerson'
    | 'online'
    | 'assessment'
    | 'ptSession'
    | 'consultation'
    | 'followUp';

const SESSION_TYPES: Record<SessionType, { label: string; icon: IoniconName }> = {
    inPerson:     { label: 'In-Person',    icon: 'person-outline' },
    online:       { label: 'Online',       icon: 'videocam-outline' },
    assessment:   { label: 'Assessment',   icon: 'clipboard-outline' },
    ptSession:    { label: 'PT Session',   icon: 'calendar-outline' },
    consultation: { label: 'Consultation', icon: 'chatbubble-ellipses-outline' },
    followUp:     { label: 'Follow-Up',    icon: 'time-outline' },
};

interface SessionTypeIconProps {
    type: SessionType;
    size?: 'sm' | 'md';
    /** Show the session name under the icon. */
    showLabel?: boolean;
}

const TILE = { sm: 40, md: 48 } as const;
const ICON = { sm: 18, md: 22 } as const;

export default function SessionTypeIcon({
    type,
    size = 'md',
    showLabel = false,
}: SessionTypeIconProps) {
    const fonts = useKitFonts();
    const item = SESSION_TYPES[type];
    const tile = TILE[size];

    return (
        <View
            style={[s.wrap, showLabel && s.labeled]}
            accessible
            accessibilityLabel={item.label}
        >
            <View
                style={[
                    s.tile,
                    { width: tile, height: tile, borderRadius: radius.md },
                ]}
            >
                <Ionicons name={item.icon} size={ICON[size]} color={palette.teal} />
            </View>
            {showLabel ? (
                <Text
                    style={[s.label, fontStyle(fonts.bodyMedium, '500')]}
                    numberOfLines={2}
                >
                    {item.label}
                </Text>
            ) : null}
        </View>
    );
}

const s = StyleSheet.create({
    wrap: {
        alignItems: 'center',
    },
    labeled: {
        width: 76,
    },
    tile: {
        backgroundColor: tints.tealSoft,
        alignItems: 'center',
        justifyContent: 'center',
    },
    label: {
        marginTop: spacing.xs,
        fontSize: 11,
        lineHeight: 14,
        color: palette.gray600,
        textAlign: 'center',
    },
});
