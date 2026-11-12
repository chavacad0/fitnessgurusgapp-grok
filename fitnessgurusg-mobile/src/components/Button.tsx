/**
 * Button — primary and secondary actions from the design kit.
 *
 *   primary   — navy fill, white label (the Primary swatch)
 *   secondary — white fill, navy label, grey border
 *
 *   <Button label="Save" onPress={save} />
 *   <Button label="Cancel" variant="secondary" onPress={cancel} />
 */

import React from 'react';
import {
    TouchableOpacity,
    Text,
    ActivityIndicator,
    StyleSheet,
    StyleProp,
    ViewStyle,
    View,
} from 'react-native';
import { palette, radius, spacing, componentSize } from '../theme/theme';
import { fontStyle, useKitFonts } from '../theme/fonts';

interface ButtonProps {
    label: string;
    onPress: () => void;
    variant?: 'primary' | 'secondary';
    disabled?: boolean;
    /** Shows a spinner and ignores presses. The label stays put so the button does not shrink. */
    loading?: boolean;
    /** Stretch to the width of the parent. */
    fullWidth?: boolean;
    style?: StyleProp<ViewStyle>;
    accessibilityLabel?: string;
}

export default function Button({
    label,
    onPress,
    variant = 'primary',
    disabled = false,
    loading = false,
    fullWidth = false,
    style,
    accessibilityLabel,
}: ButtonProps) {
    const fonts = useKitFonts();
    const isPrimary = variant === 'primary';
    const inactive = disabled || loading;

    return (
        <TouchableOpacity
            style={[
                s.base,
                isPrimary ? s.primary : s.secondary,
                fullWidth && s.fullWidth,
                inactive && s.inactive,
                style,
            ]}
            onPress={onPress}
            disabled={inactive}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityState={{ disabled: inactive, busy: loading }}
        >
            <View style={s.labelWrap}>
                <Text
                    style={[
                        s.label,
                        isPrimary ? s.primaryLabel : s.secondaryLabel,
                        fontStyle(fonts.bodySemibold, '600'),
                        loading && s.hiddenLabel,
                    ]}
                    numberOfLines={1}
                >
                    {label}
                </Text>
                {loading && (
                    <ActivityIndicator
                        style={s.spinner}
                        color={isPrimary ? palette.white : palette.primary}
                    />
                )}
            </View>
        </TouchableOpacity>
    );
}

const s = StyleSheet.create({
    base: {
        minHeight: componentSize.button,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'flex-start',
    },
    fullWidth: {
        alignSelf: 'stretch',
    },
    primary: {
        backgroundColor: palette.primary,
    },
    secondary: {
        backgroundColor: palette.white,
        borderWidth: 1,
        borderColor: palette.gray300,
    },
    inactive: {
        opacity: 0.45,
    },
    labelWrap: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    label: {
        fontSize: 16,
        includeFontPadding: false,
    },
    primaryLabel: {
        color: palette.white,
    },
    secondaryLabel: {
        color: palette.primary,
    },
    hiddenLabel: {
        opacity: 0,
    },
    spinner: {
        position: 'absolute',
    },
});
