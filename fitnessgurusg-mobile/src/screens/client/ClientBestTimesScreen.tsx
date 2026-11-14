/**
 * My best times — usual windows and exact times.
 * Saving this does not book a session. Only this client and their coach can see it.
 */

import React, { useCallback, useState } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Modal, TextInput,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { fontStyle, useKitFonts } from '../../theme/fonts';
import { getMyBestTimes, saveMyBestTimes } from '../../services/apiClient';
import { BestWindow } from '../../types';
import {
    AvailabilityHeader, InlineClock, MINT, NAVY, SAGE, SaveBar, ScreenBody, TEAL, formatTimeLabel,
} from '../coach/availabilityShared';

const CHOICES: Array<{ id: BestWindow; title: string; sub: string }> = [
    { id: 'weekday_mornings', title: 'Weekday mornings', sub: '6–8 AM' },
    { id: 'lunch', title: 'Lunch', sub: '12–2 PM' },
    { id: 'after_work', title: 'After work', sub: '6–9 PM' },
    { id: 'weekends', title: 'Weekends', sub: 'Sat or Sun' },
];

const DAYS = [
    { id: 'mon', label: 'Mon' }, { id: 'tue', label: 'Tue' }, { id: 'wed', label: 'Wed' },
    { id: 'thu', label: 'Thu' }, { id: 'fri', label: 'Fri' }, { id: 'sat', label: 'Sat' },
    { id: 'sun', label: 'Sun' },
];

interface Exact { id?: string; day: string; time: string; note?: string }

export default function ClientBestTimesScreen() {
    const navigation = useNavigation<any>();
    const fonts = useKitFonts();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [coachName, setCoachName] = useState('your coach');
    const [windows, setWindows] = useState<BestWindow[]>([]);
    const [exact, setExact] = useState<Exact[]>([]);
    const [adding, setAdding] = useState(false);
    const [day, setDay] = useState('thu');
    const [time, setTime] = useState('19:00');
    const [note, setNote] = useState('');

    useFocusEffect(useCallback(() => {
        let alive = true;
        setLoading(true);
        getMyBestTimes()
            .then(res => {
                if (!alive) return;
                setCoachName(res.coach_name || 'your coach');
                setWindows(res.windows ?? []);
                setExact(res.exact_times ?? []);
            })
            .catch(err => { if (alive) Alert.alert('Could not load best times', err.message ?? 'Please try again.'); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, []));

    const toggle = (id: BestWindow) => {
        setWindows(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
    };

    const who = coachName === 'your coach' ? 'Your coach' : coachName;

    const save = async () => {
        setSaving(true);
        try {
            await saveMyBestTimes({ windows, exact_times: exact });
            Alert.alert('Saved', 'This doesn’t book a session.');
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
                title="My best times"
                subtitle="Usual windows, plus any exact times"
                onBack={() => navigation.goBack()}
            />
            {loading ? <View style={s.centred}><ActivityIndicator color={TEAL} /></View> : (
                <>
                    <ScreenBody>
                        <View style={s.grid}>
                            {CHOICES.map(choice => {
                                const on = windows.includes(choice.id);
                                return (
                                    <TouchableOpacity
                                        key={choice.id}
                                        style={[s.window, on && s.windowOn]}
                                        onPress={() => toggle(choice.id)}
                                        accessibilityRole="button"
                                        accessibilityState={{ selected: on }}
                                    >
                                        <Text style={[s.windowTitle, fontStyle(fonts.headingSemibold, '600')]}>{choice.title}</Text>
                                        <Text style={[s.windowSub, fontStyle(fonts.body, '400')]}>{choice.sub}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                        <View style={s.exactHead}>
                            <Text style={[s.exactLabel, fontStyle(fonts.bodySemibold, '600')]}>EXACT TIMES</Text>
                            <TouchableOpacity onPress={() => setAdding(true)} accessibilityRole="button">
                                <Text style={[s.add, fontStyle(fonts.bodySemibold, '600')]}>+ Add a time</Text>
                            </TouchableOpacity>
                        </View>
                        {exact.map(item => (
                            <View key={item.id ?? `${item.day}-${item.time}`} style={s.exactCard}>
                                <View style={{ flex: 1 }}>
                                    <Text style={[s.exactTime, fontStyle(fonts.headingSemibold, '600')]}>
                                        {DAYS.find(d => d.id === item.day)?.label} {formatTimeLabel(item.time)}
                                    </Text>
                                    {!!item.note && <Text style={s.exactNote}>{item.note}</Text>}
                                </View>
                                <TouchableOpacity
                                    onPress={() => setExact(prev => prev.filter(row => row !== item))}
                                    accessibilityLabel="Remove this time"
                                >
                                    <Ionicons name="close" size={18} color={SAGE} />
                                </TouchableOpacity>
                            </View>
                        ))}
                        <View style={s.note}>
                            <Ionicons name="information-circle-outline" size={18} color={TEAL} />
                            <Text style={[s.noteText, fontStyle(fonts.body, '400')]}>
                                {who} uses this to suggest times and tag open slots as a good fit. You can still request something else. This doesn’t book a session.
                            </Text>
                        </View>
                    </ScreenBody>
                    <SaveBar label="Save my best times" onPress={save} disabled={saving} />
                </>
            )}
            <Modal visible={adding} animationType="slide" onRequestClose={() => setAdding(false)}>
                <AvailabilityHeader title="Add a time" subtitle="Usual windows, plus any exact times" onBack={() => setAdding(false)} />
                <ScreenBody>
                    <View style={s.days}>
                        {DAYS.map(item => (
                            <TouchableOpacity key={item.id} style={[s.day, day === item.id && s.dayOn]} onPress={() => setDay(item.id)}>
                                <Text style={[s.dayText, day === item.id && s.dayTextOn]}>{item.label}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                    <InlineClock value={time} onChange={setTime} />
                    <TextInput
                        style={s.input}
                        value={note}
                        onChangeText={setNote}
                        placeholder="Note, optional"
                        placeholderTextColor="#9CA3AF"
                    />
                    <TouchableOpacity
                        style={s.addBtn}
                        onPress={() => {
                            setExact(prev => [...prev, { day, time, note: note.trim() || undefined }]);
                            setNote('');
                            setAdding(false);
                        }}
                    >
                        <Text style={s.addBtnText}>Add a time</Text>
                    </TouchableOpacity>
                </ScreenBody>
            </Modal>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#F7F8FA' },
    centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    window: {
        width: '48%', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14,
        borderWidth: 1, borderColor: '#E5E7EB',
    },
    windowOn: { backgroundColor: MINT, borderColor: TEAL },
    windowTitle: { color: NAVY, fontSize: 15 },
    windowSub: { color: SAGE, fontSize: 13, marginTop: 4 },
    exactHead: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, marginBottom: 8 },
    exactLabel: { color: SAGE, fontSize: 12, letterSpacing: 0.6 },
    add: { color: TEAL, fontSize: 14 },
    exactCard: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
        borderRadius: 14, padding: 14, marginBottom: 8,
    },
    exactTime: { color: NAVY, fontSize: 16 },
    exactNote: { color: SAGE, fontSize: 12, marginTop: 2 },
    note: { flexDirection: 'row', gap: 8, backgroundColor: MINT, borderRadius: 16, padding: 14, marginTop: 8 },
    noteText: { flex: 1, color: SAGE, fontSize: 13, lineHeight: 18 },
    days: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    day: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#FFFFFF' },
    dayOn: { backgroundColor: NAVY, borderColor: NAVY },
    dayText: { color: NAVY, fontSize: 13 },
    dayTextOn: { color: '#FFFFFF' },
    input: {
        marginTop: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB',
        borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: NAVY,
    },
    addBtn: { marginTop: 16, backgroundColor: TEAL, borderRadius: 14, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    addBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
