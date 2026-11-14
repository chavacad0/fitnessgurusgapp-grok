/**
 * One-off changes — open extra slots on a date, or mark a date closed.
 * Weekly hours stay as they are.
 */

import React, { useCallback, useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Modal,
    Alert,
    ActivityIndicator,
    TextInput,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { fontStyle, useKitFonts } from '../../theme/fonts';
import {
    addAvailabilityOverride,
    getAvailabilityRules,
    removeAvailabilityOverride,
} from '../../services/apiClient';
import { AvailabilityRules } from '../../types';
import MonthCalendar from '../../components/MonthCalendar';
import {
    AvailabilityHeader,
    InlineClock,
    MINT,
    NAVY,
    SAGE,
    ScreenBody,
    TEAL,
    formatRangeLabel,
    previewSlotCount,
    singaporeParts,
    todaySingapore,
} from './availabilityShared';

type Mode = 'extra' | 'closed' | null;

export default function OneOffChangesScreen() {
    const navigation = useNavigation<any>();
    const fonts = useKitFonts();
    const [rules, setRules] = useState<AvailabilityRules | null>(null);
    const [loading, setLoading] = useState(true);
    const [mode, setMode] = useState<Mode>(null);
    const [date, setDate] = useState(todaySingapore());
    const [start, setStart] = useState('08:00');
    const [end, setEnd] = useState('12:00');
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        getAvailabilityRules()
            .then(setRules)
            .catch(err => Alert.alert('Could not load changes', err.message ?? 'Please try again.'))
            .finally(() => setLoading(false));
    }, []);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const length = rules?.slot_length_minutes ?? 60;
    const buffer = rules?.buffer_minutes ?? 10;
    const preview = previewSlotCount(start, end, length, buffer);

    const closeSheet = () => {
        setMode(null);
        setNote('');
    };

    const save = async () => {
        if (mode === 'extra' && end <= start) {
            Alert.alert('Check the times', 'The end time has to be later on the same day.');
            return;
        }
        setSaving(true);
        try {
            if (mode === 'extra') {
                await addAvailabilityOverride({ date, kind: 'extra', ranges: [{ start, end }] });
            } else if (mode === 'closed') {
                await addAvailabilityOverride({
                    date,
                    kind: 'closed',
                    note: note.trim() || undefined,
                });
            }
            closeSheet();
            load();
        } catch (err: any) {
            Alert.alert('Could not save', err.message ?? 'Please try again.');
        } finally {
            setSaving(false);
        }
    };

    const remove = (id: string) => {
        Alert.alert('Remove this change?', 'Your weekly hours stay as they are.', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Remove',
                onPress: async () => {
                    try {
                        await removeAvailabilityOverride(id);
                        load();
                    } catch (err: any) {
                        Alert.alert('Could not remove', err.message ?? 'Please try again.');
                    }
                },
            },
        ]);
    };

    const overrides = rules?.overrides ?? [];

    return (
        <View style={s.root}>
            <AvailabilityHeader
                title="One-off changes"
                subtitle="Doesn't change your usual hours"
                onBack={() => navigation.goBack()}
            />
            {loading && !rules ? (
                <View style={s.centred}><ActivityIndicator color={TEAL} /></View>
            ) : (
                <ScreenBody>
                    {overrides.map(item => {
                        const parts = singaporeParts(item.date);
                        if (item.kind === 'extra') {
                            const range = item.ranges?.[0];
                            const title = `Open extra slots ${parts.weekday}`;
                            const detail = range
                                ? `${parts.weekday} ${parts.day} ${parts.month} · ${formatRangeLabel(range.start, range.end)} · ${item.slot_count ?? previewSlotCount(range.start, range.end, length, buffer)} slots`
                                : `${parts.weekday} ${parts.day} ${parts.month}`;
                            return (
                                <View key={item.id} style={s.card}>
                                    <View style={s.icon}><Ionicons name="add" size={18} color={TEAL} /></View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[s.cardTitle, fontStyle(fonts.headingSemibold, '600')]}>{title}</Text>
                                        <Text style={[s.cardSub, fontStyle(fonts.body, '400')]}>{detail}</Text>
                                    </View>
                                    <View style={s.badge}><Text style={[s.badgeText, fontStyle(fonts.bodySemibold, '600')]}>Extra</Text></View>
                                    <TouchableOpacity onPress={() => remove(item.id)} accessibilityRole="button" accessibilityLabel="Remove extra slots">
                                        <Ionicons name="close" size={16} color={SAGE} />
                                    </TouchableOpacity>
                                </View>
                            );
                        }
                        const title = `Closed ${parts.day} ${parts.month}`;
                        const detail = `${parts.weekdayLong} · all day${item.note ? ` · ${item.note}` : ''}`;
                        return (
                            <View key={item.id} style={s.card}>
                                <View style={s.icon}><Ionicons name="remove-circle-outline" size={18} color={TEAL} /></View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[s.cardTitle, fontStyle(fonts.headingSemibold, '600')]}>{title}</Text>
                                    <Text style={[s.cardSub, fontStyle(fonts.body, '400')]}>{detail}</Text>
                                </View>
                                <View style={s.badge}><Text style={[s.badgeText, fontStyle(fonts.bodySemibold, '600')]}>Closed</Text></View>
                                <TouchableOpacity onPress={() => remove(item.id)} accessibilityRole="button" accessibilityLabel="Remove closed date">
                                    <Ionicons name="close" size={16} color={SAGE} />
                                </TouchableOpacity>
                            </View>
                        );
                    })}

                    <View style={s.actions}>
                        <TouchableOpacity style={s.action} onPress={() => { setDate(todaySingapore()); setMode('extra'); }} accessibilityRole="button">
                            <Text style={[s.actionText, fontStyle(fonts.bodySemibold, '600')]}>+ Open extra slots</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.action} onPress={() => { setDate(todaySingapore()); setMode('closed'); }} accessibilityRole="button">
                            <Text style={[s.actionText, fontStyle(fonts.bodySemibold, '600')]}>Mark closed</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={s.note}>
                        <Ionicons name="information-circle-outline" size={18} color={TEAL} />
                        <Text style={[s.noteText, fontStyle(fonts.body, '400')]}>
                            Use this for a one-time Saturday, or a holiday close, without editing your weekly hours.
                        </Text>
                    </View>
                </ScreenBody>
            )}

            <Modal visible={mode !== null} animationType="slide" onRequestClose={closeSheet}>
                <AvailabilityHeader
                    title={mode === 'closed' ? 'Mark closed' : 'Open extra slots'}
                    subtitle="Doesn't change your usual hours"
                    onBack={closeSheet}
                />
                <ScreenBody>
                    <MonthCalendar selectedDate={date} onSelectDate={setDate} />
                    {mode === 'extra' && (
                        <View style={s.form}>
                            <Text style={[s.formLabel, fontStyle(fonts.bodySemibold, '600')]}>Start</Text>
                            <InlineClock value={start} onChange={setStart} />
                            <Text style={[s.formLabel, fontStyle(fonts.bodySemibold, '600')]}>End</Text>
                            <InlineClock value={end} onChange={setEnd} />
                            <Text style={[s.preview, fontStyle(fonts.body, '400')]}>
                                {preview === 1 ? '1 slot' : `${preview} slots`}
                            </Text>
                        </View>
                    )}
                    {mode === 'closed' && (
                        <TextInput
                            style={[s.input, fontStyle(fonts.body, '400')]}
                            value={note}
                            onChangeText={setNote}
                            placeholder="public holiday"
                            placeholderTextColor="#9CA3AF"
                            accessibilityLabel="Note, optional"
                        />
                    )}
                    <TouchableOpacity
                        style={[s.save, saving && { opacity: 0.55 }]}
                        onPress={save}
                        disabled={saving}
                        accessibilityRole="button"
                    >
                        <Text style={[s.saveText, fontStyle(fonts.bodySemibold, '600')]}>
                            {mode === 'closed' ? 'Mark closed' : 'Open extra slots'}
                        </Text>
                    </TouchableOpacity>
                </ScreenBody>
            </Modal>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#F7F8FA' },
    centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 14,
        marginBottom: 10,
    },
    icon: {
        width: 36, height: 36, borderRadius: 12,
        backgroundColor: MINT, alignItems: 'center', justifyContent: 'center',
    },
    cardTitle: { color: NAVY, fontSize: 15 },
    cardSub: { color: SAGE, fontSize: 12, marginTop: 2 },
    badge: {
        backgroundColor: MINT,
        borderRadius: 20,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    badgeText: { color: TEAL, fontSize: 12 },
    actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
    action: {
        flex: 1,
        borderWidth: 1,
        borderColor: '#D1D5DB',
        borderRadius: 14,
        backgroundColor: '#FFFFFF',
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 8,
    },
    actionText: { color: NAVY, fontSize: 13, textAlign: 'center' },
    note: {
        flexDirection: 'row',
        gap: 8,
        backgroundColor: MINT,
        borderRadius: 16,
        padding: 14,
        marginTop: 12,
    },
    noteText: { flex: 1, color: SAGE, fontSize: 13, lineHeight: 18 },
    form: { marginTop: 12 },
    formLabel: { color: SAGE, fontSize: 13, marginTop: 12, marginBottom: 8 },
    preview: { color: TEAL, fontSize: 13, marginTop: 12 },
    input: {
        marginTop: 16,
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        color: NAVY,
        fontSize: 15,
    },
    save: {
        marginTop: 16,
        backgroundColor: TEAL,
        borderRadius: 14,
        minHeight: 52,
        alignItems: 'center',
        justifyContent: 'center',
    },
    saveText: { color: '#FFFFFF', fontSize: 16 },
});
