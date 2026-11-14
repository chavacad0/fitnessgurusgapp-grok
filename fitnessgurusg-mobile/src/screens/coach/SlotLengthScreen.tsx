/**
 * Session length and the buffer after each session.
 * Existing bookings are not moved when these numbers change.
 */

import React, { useCallback, useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Alert,
    ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { fontStyle, useKitFonts } from '../../theme/fonts';
import { getAvailabilityRules, saveSlotSettings } from '../../services/apiClient';
import {
    AvailabilityHeader,
    MINT,
    NAVY,
    SAGE,
    SaveBar,
    ScreenBody,
    TEAL,
    formatTimeLabel,
} from './availabilityShared';

const LENGTHS = [30, 45, 60, 90] as const;
const BUFFERS = [0, 10, 15] as const;

function freesAt(length: number, buffer: number): string {
    const total = 10 * 60 + length + buffer;
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return formatTimeLabel(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
}

export default function SlotLengthScreen() {
    const navigation = useNavigation<any>();
    const fonts = useKitFonts();
    const [length, setLength] = useState<number>(60);
    const [buffer, setBuffer] = useState<number>(10);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useFocusEffect(useCallback(() => {
        let alive = true;
        setLoading(true);
        getAvailabilityRules()
            .then(res => {
                if (!alive) return;
                if (LENGTHS.includes(res.slot_length_minutes as 30)) setLength(res.slot_length_minutes);
                if (BUFFERS.includes(res.buffer_minutes as 0)) setBuffer(res.buffer_minutes);
            })
            .catch(err => {
                if (alive) Alert.alert('Could not load slot settings', err.message ?? 'Please try again.');
            })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, []));

    const save = async () => {
        setSaving(true);
        try {
            await saveSlotSettings(length, buffer);
            Alert.alert('Slot settings saved', 'Existing bookings stay as they are.');
            navigation.goBack();
        } catch (err: any) {
            Alert.alert('Could not save', err.message ?? 'Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <View style={s.root}>
            <AvailabilityHeader
                title="Slot length"
                subtitle="Used with your working hours"
                onBack={() => navigation.goBack()}
            />
            {loading ? (
                <View style={s.centred}><ActivityIndicator color={TEAL} /></View>
            ) : (
                <>
                    <ScreenBody>
                        <View style={s.card}>
                            <Text style={[s.cardTitle, fontStyle(fonts.headingSemibold, '600')]}>Session length</Text>
                            <View style={s.row}>
                                {LENGTHS.map(item => {
                                    const on = item === length;
                                    return (
                                        <TouchableOpacity
                                            key={item}
                                            style={[s.choice, on && s.choiceOn]}
                                            onPress={() => setLength(item)}
                                            accessibilityRole="button"
                                            accessibilityState={{ selected: on }}
                                        >
                                            <Text style={[s.choiceText, on && s.choiceTextOn, fontStyle(fonts.bodySemibold, '600')]}>
                                                {item} min
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </View>

                        <View style={s.card}>
                            <Text style={[s.cardTitle, fontStyle(fonts.headingSemibold, '600')]}>Buffer after each session</Text>
                            <View style={s.row}>
                                {BUFFERS.map(item => {
                                    const on = item === buffer;
                                    return (
                                        <TouchableOpacity
                                            key={item}
                                            style={[s.choice, on && s.choiceOn]}
                                            onPress={() => setBuffer(item)}
                                            accessibilityRole="button"
                                            accessibilityState={{ selected: on }}
                                        >
                                            <Text style={[s.choiceText, on && s.choiceTextOn, fontStyle(fonts.bodySemibold, '600')]}>
                                                {item} min
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </View>

                        <View style={s.note}>
                            <View style={s.noteIcon}>
                                <Ionicons name="information-circle-outline" size={18} color={TEAL} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={[s.noteTitle, fontStyle(fonts.headingSemibold, '600')]}>How this reads</Text>
                                <Text style={[s.noteBody, fontStyle(fonts.body, '400')]}>
                                    A {length} min session with a {buffer} buffer means a 10:00 AM booking frees you at {freesAt(length, buffer)}.
                                </Text>
                                <Text style={[s.noteBody, fontStyle(fonts.body, '400')]}>
                                    Existing bookings stay as they are.
                                </Text>
                            </View>
                        </View>
                    </ScreenBody>
                    <SaveBar label="Save slot settings" onPress={save} disabled={saving} />
                </>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#F7F8FA' },
    centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 14,
        marginBottom: 12,
    },
    cardTitle: { color: NAVY, fontSize: 16, marginBottom: 12 },
    row: { flexDirection: 'row', gap: 8 },
    choice: {
        flex: 1,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRadius: 12,
        paddingVertical: 12,
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
    },
    choiceOn: { backgroundColor: NAVY, borderColor: NAVY },
    choiceText: { color: NAVY, fontSize: 13 },
    choiceTextOn: { color: '#FFFFFF' },
    note: {
        flexDirection: 'row',
        gap: 10,
        backgroundColor: MINT,
        borderRadius: 16,
        padding: 14,
    },
    noteIcon: {
        width: 28, height: 28, borderRadius: 14,
        backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    },
    noteTitle: { color: NAVY, fontSize: 15, marginBottom: 4 },
    noteBody: { color: SAGE, fontSize: 13, lineHeight: 18, marginTop: 2 },
});
