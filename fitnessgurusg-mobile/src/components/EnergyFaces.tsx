/**
 * Five one-tap energy faces for the daily check-in.
 * Drawn with Views. No extra packages, and no character or mascot.
 * A tap saves 2, 4, 6, 8, or 10 on the existing energy field.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, radius, shadows } from '../theme/theme';
import { fontStyle, useKitFonts } from '../theme/fonts';
import {
    ENERGY_FACES,
    EnergyFaceId,
    nearestEnergyFace,
} from '../checkin/scale';

const TEAL = '#0F766E';

const RAY_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

interface FaceArt {
    fill: string;
    ink: string;
    eyes: 'tired' | 'open';
    mouth: 'frown' | 'soft' | 'flat' | 'smile' | 'wide';
}

/**
 * Drained is a cool blue-grey, not purple.
 * Low is sage, Okay is cream, Good is light green,
 * Great is golden yellow with small sun rays.
 */
const FACE_ART: Record<EnergyFaceId, FaceArt> = {
    drained: { fill: '#C5D0D8', ink: '#5C6E7C', eyes: 'tired', mouth: 'frown' },
    low:     { fill: '#D5E6DF', ink: '#4F7F71', eyes: 'open',  mouth: 'soft' },
    okay:    { fill: '#F8EED9', ink: '#8C7350', eyes: 'open',  mouth: 'flat' },
    good:    { fill: '#D9F2DE', ink: '#3E7D55', eyes: 'open',  mouth: 'smile' },
    great:   { fill: '#F8DC6E', ink: '#8A6210', eyes: 'open',  mouth: 'wide' },
};

function SunRays() {
    return (
        <View pointerEvents="none" style={styles.rayLayer}>
            {RAY_ANGLES.map(angle => (
                <View
                    key={angle}
                    style={[styles.rayPivot, { transform: [{ rotate: `${angle}deg` }] }]}
                >
                    <View style={styles.ray} />
                </View>
            ))}
        </View>
    );
}

function Mouth({ kind, color }: { kind: FaceArt['mouth']; color: string }) {
    if (kind === 'flat') {
        return <View style={[styles.mouthFlat, { backgroundColor: color }]} />;
    }
    const frown = kind === 'frown' || kind === 'soft';
    const wide = kind === 'frown' || kind === 'wide';
    return (
        <View
            style={{
                width: wide ? 16 : 12,
                height: kind === 'soft' ? 6 : 8,
                backgroundColor: 'transparent',
                borderColor: color,
                ...(frown
                    ? {
                        borderTopWidth: 2,
                        borderLeftWidth: 2,
                        borderRightWidth: 2,
                        borderTopLeftRadius: 10,
                        borderTopRightRadius: 10,
                    }
                    : {
                        borderBottomWidth: 2,
                        borderLeftWidth: 2,
                        borderRightWidth: 2,
                        borderBottomLeftRadius: 10,
                        borderBottomRightRadius: 10,
                    }),
            }}
        />
    );
}

function FaceMark({ id, selected }: { id: EnergyFaceId; selected: boolean }) {
    const art = FACE_ART[id];
    return (
        <View style={styles.stage}>
            {id === 'great' ? <SunRays /> : null}
            <View
                style={[
                    styles.face,
                    {
                        backgroundColor: art.fill,
                        borderColor: selected ? TEAL : art.fill,
                    },
                ]}
            >
                <View style={styles.eyes}>
                    {art.eyes === 'tired' ? (
                        <>
                            <View style={[styles.eyeBar, { backgroundColor: art.ink }]} />
                            <View style={[styles.eyeBar, { backgroundColor: art.ink }]} />
                        </>
                    ) : (
                        <>
                            <View style={[styles.eyeDot, { backgroundColor: art.ink }]} />
                            <View style={[styles.eyeDot, { backgroundColor: art.ink }]} />
                        </>
                    )}
                </View>
                <Mouth kind={art.mouth} color={art.ink} />
            </View>
        </View>
    );
}

export default function EnergyFaces({
    value,
    onChange,
}: {
    value: number;
    onChange: (next: number) => void;
}) {
    const fonts = useKitFonts();
    const selectedValue = nearestEnergyFace(value);

    return (
        <View style={styles.card}>
            <Text style={[styles.title, fontStyle(fonts.headingSemibold, '600')]}>Energy</Text>
            <Text style={[styles.question, fontStyle(fonts.body, '400')]}>
                How's your energy right now?
            </Text>
            <View style={styles.row}>
                {ENERGY_FACES.map(face => {
                    const selected = face.value === selectedValue;
                    return (
                        <TouchableOpacity
                            key={face.id}
                            style={styles.cell}
                            onPress={() => onChange(face.value)}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            accessibilityLabel={`Energy, ${face.label}`}
                            accessibilityState={{ selected }}
                        >
                            <FaceMark id={face.id} selected={selected} />
                            <Text
                                style={[
                                    styles.label,
                                    fontStyle(fonts.bodyMedium, '500'),
                                    selected && styles.labelOn,
                                ]}
                                numberOfLines={1}
                                adjustsFontSizeToFit
                                minimumFontScale={0.8}
                            >
                                {face.label}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.base,
        marginBottom: spacing.base,
        ...shadows.card,
    },
    title: {
        fontSize: 16,
        color: colors.textPrimary,
        marginBottom: 2,
    },
    question: {
        fontSize: 13,
        color: colors.textSecondary,
        marginBottom: spacing.md,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
    },
    cell: {
        flex: 1,
        alignItems: 'center',
        minHeight: 78,
        paddingVertical: 2,
    },
    stage: {
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 4,
    },
    rayLayer: {
        ...StyleSheet.absoluteFillObject,
    },
    rayPivot: {
        position: 'absolute',
        width: 4,
        height: 48,
        left: 22,
        top: 0,
        alignItems: 'center',
    },
    ray: {
        width: 3,
        height: 5,
        borderRadius: 2,
        backgroundColor: '#E2B340',
        marginTop: 1,
    },
    face: {
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 2.5,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1,
    },
    eyes: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 3,
    },
    eyeDot: {
        width: 4,
        height: 4,
        borderRadius: 2,
    },
    eyeBar: {
        width: 8,
        height: 2,
        borderRadius: 1,
    },
    mouthFlat: {
        width: 12,
        height: 2,
        borderRadius: 1,
    },
    label: {
        fontSize: 11,
        color: colors.textSecondary,
        textAlign: 'center',
    },
    labelOn: {
        color: TEAL,
    },
});
