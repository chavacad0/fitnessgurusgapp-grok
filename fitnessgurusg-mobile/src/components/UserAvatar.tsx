/**
 * UserAvatar — photo, or initials when there is no photo.
 *
 * If the photo address is missing or the image fails to load, the initials
 * stay visible. A one-word name uses its first letter. Two or more words
 * use the first and last initials ("Ava Gonzales" → "AG").
 *
 *   <UserAvatar name="Ava Gonzales" />
 *   <UserAvatar name="Ava Gonzales" imageUri={photoUrl} size={80} />
 *
 * `Avatar` is the same component.
 */

import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { colors, componentSize } from '../theme/theme';
import { fontStyle, useKitFonts } from '../theme/fonts';

type AvatarSize = 'sm' | 'md' | 'lg';

interface UserAvatarProps {
    /** Display name. Initials are taken from this. */
    name: string;
    /** Preset, or a width and height in pixels. */
    size?: AvatarSize | number;
    /** Remote or local image address. Initials show when this is empty or fails. */
    imageUri?: string | null;
    /** Override the circle colour. */
    bgColor?: string;
    /** Override the initials colour. */
    textColor?: string;
    accessibilityLabel?: string;
    style?: StyleProp<ViewStyle>;
}

const SIZE_MAP: Record<AvatarSize, number> = {
    sm: componentSize.avatarSm,
    md: componentSize.avatar,
    lg: componentSize.avatarLg,
};

const FONT_MAP: Record<AvatarSize, number> = {
    sm: 13,
    md: 15,
    lg: 20,
};

export function getInitials(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return '?';
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    const first = parts[0].charAt(0);
    const last = parts[parts.length - 1].charAt(0);
    return (first + last).toUpperCase();
}

function UserAvatar({
    name,
    size = 'md',
    imageUri,
    bgColor = colors.avatarBg,
    textColor = colors.avatarText,
    accessibilityLabel,
    style,
}: UserAvatarProps) {
    const fonts = useKitFonts();
    const dimension = typeof size === 'number' ? size : SIZE_MAP[size];
    const fontSize = typeof size === 'number'
        ? Math.max(12, Math.round(dimension * 0.35))
        : FONT_MAP[size];
    const initials = getInitials(name);
    const uri = imageUri?.trim() ?? '';
    const [failedUri, setFailedUri] = useState<string | null>(null);
    const showPhoto = uri.length > 0 && failedUri !== uri;

    return (
        <View
            style={[
                s.circle,
                {
                    width: dimension,
                    height: dimension,
                    borderRadius: dimension / 2,
                    backgroundColor: bgColor,
                },
                style,
            ]}
            accessible
            accessibilityRole="image"
            accessibilityLabel={accessibilityLabel ?? (name.trim() ? `${name.trim()}'s photo` : 'Avatar')}
        >
            <Text
                style={[
                    s.initials,
                    { fontSize, color: textColor },
                    fontStyle(fonts.headingSemibold, '600'),
                ]}
            >
                {initials}
            </Text>
            {showPhoto ? (
                <Image
                    source={{ uri }}
                    style={s.photo}
                    onError={() => setFailedUri(uri)}
                    accessibilityIgnoresInvertColors
                />
            ) : null}
        </View>
    );
}

export default UserAvatar;
export { UserAvatar as Avatar };

const s = StyleSheet.create({
    circle: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    initials: {
        includeFontPadding: false,
    },
    photo: {
        ...StyleSheet.absoluteFillObject,
    },
});
