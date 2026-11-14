/**
 * Away dates. The coach will not see this client on Good for for these days.
 * Booked sessions are not cancelled.
 */

import React, { useCallback, useState } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { fontStyle, useKitFonts } from '../../theme/fonts';
import { addAwayDates, getMyBestTimes, removeAwayDates } from '../../services/apiClient';
import { BestTimes } from '../../types';
import MonthCalendar from '../../components/MonthCalendar';
import {
    AvailabilityHeader, MINT, NAVY, SAGE, ScreenBody, TEAL, todaySingapore,
} from '../coach/availabilityShared';

function rangeLabel(start: string, end: string): string {
    const part = (iso: string) => {
        const date = new Date(`${iso}T12:00:00+08:00`);
        return {
            day: date.toLocaleDateString('en-SG', { day: 'numeric', timeZone: 'Asia/Singapore' }),
            month: date.toLocaleDateString('en-SG', { month: 'short', timeZone: 'Asia/Singapore' }),
        };
    };
    const a = part(start);
    const b = part(end);
    if (start === end) return `${a.day} ${a.month}`;
    if (a.month === b.month) return `${a.day}–${b.day} ${a.month}`;
    return `${a.day} ${a.month}–${b.day} ${b.month}`;
}

export default function ClientAwayDatesScreen() {
    const navigation = useNavigation<any>();
    const fonts = useKitFonts();
    const [loading, setLoading] = useState(true);
    const [best, setBest] = useState<BestTimes | null>(null);
    const [adding, setAdding] = useState(false);
    const [start, setStart] = useState(todaySingapore());
    const [end, setEnd] = useState(todaySingapore());
    const [picking, setPicking] = useState<'start' | 'end'>('start');

    const load = useCallback(() => {
        setLoading(true);
        getMyBestTimes()
            .then(setBest)
            .catch(err => Alert.alert('Could not load away dates', err.message ?? 'Please try again.'))
            .finally(() => setLoading(false));
    }, []);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const save = async () => {
        try {
            const next = await addAwayDates(start, end);
            setBest(next);
            setAdding(false);
        } catch (err: any) {
            Alert.alert('Could not add those dates', err.message ?? 'Please try again.');
        }
    };

    const coach = best?.coach_name || 'your coach';

    return (
        <View style={s.root}>
            <AvailabilityHeader
                title="Away dates"
                subtitle="So your coach doesn’t offer these days"
                onBack={() => adding ? setAdding(false) : navigation.goBack()}
            />
            {loading && !best ? <View style={s.centred}><ActivityIndicator color={TEAL} /></View> : adding ? (
                <ScreenBody>
                    <View style={s.pickRow}>
                        <TouchableOpacity style={[s.pick, picking === 'start' && s.pickOn]} onPress={() => setPicking('start')}>
                            <Text style={s.pickLabel}>Start</Text>
                            <Text style={s.pickValue}>{start}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[s.pick, picking === 'end' && s.pickOn]} onPress={() => setPicking('end')}>
                            <Text style={s.pickLabel}>End</Text>
                            <Text style={s.pickValue}>{end}</Text>
                        </TouchableOpacity>
                    </View>
                    <MonthCalendar
                        selectedDate={picking === 'start' ? start : end}
                        onSelectDate={iso => {
                            if (picking === 'start') {
                                setStart(iso);
                                if (iso > end) setEnd(iso);
                                setPicking('end');
                            } else {
                                setEnd(iso < start ? start : iso);
                            }
                        }}
                    />
                    <TouchableOpacity style={s.save} onPress={save} accessibilityRole="button">
                        <Text style={s.saveText}>Add away dates</Text>
                    </TouchableOpacity>
                </ScreenBody>
            ) : (
                <ScreenBody>
                    {(best?.away ?? []).map(item => (
                        <View key={item.id} style={s.card}>
                            <View style={s.icon}><Ionicons name="calendar-outline" size={18} color={TEAL} /></View>
                            <View style={{ flex: 1 }}>
                                <Text style={[s.title, fontStyle(fonts.headingSemibold, '600')]}>{rangeLabel(item.start, item.end)}</Text>
                                <Text style={s.sub}>
                                    {item.days} {item.days === 1 ? 'day' : 'days'} · {coach} won’t be offered these dates.
                                </Text>
                            </View>
                            <View style={s.badge}><Text style={s.badgeText}>{item.badge}</Text></View>
                            <TouchableOpacity
                                onPress={async () => {
                                    try {
                                        setBest(await removeAwayDates(item.id));
                                    } catch (err: any) {
                                        Alert.alert('Could not remove', err.message ?? 'Please try again.');
                                    }
                                }}
                                accessibilityLabel="Remove these away dates"
                            >
                                <Ionicons name="close" size={16} color={SAGE} />
                            </TouchableOpacity>
                        </View>
                    ))}
                    <TouchableOpacity style={s.add} onPress={() => setAdding(true)} accessibilityRole="button">
                        <Text style={[s.addText, fontStyle(fonts.bodySemibold, '600')]}>+ Add away dates</Text>
                    </TouchableOpacity>
                    <View style={s.note}>
                        <Ionicons name="information-circle-outline" size={18} color={TEAL} />
                        <Text style={s.noteText}>
                            This is for travel or days you already know you can’t train. It doesn’t cancel a session that’s already booked.
                        </Text>
                    </View>
                </ScreenBody>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#F7F8FA' },
    centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    card: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, marginBottom: 10,
    },
    icon: { width: 36, height: 36, borderRadius: 12, backgroundColor: MINT, alignItems: 'center', justifyContent: 'center' },
    title: { color: NAVY, fontSize: 16 },
    sub: { color: SAGE, fontSize: 12, marginTop: 2 },
    badge: { backgroundColor: MINT, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4 },
    badgeText: { color: TEAL, fontSize: 12, fontWeight: '700' },
    add: {
        borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 14, backgroundColor: '#FFFFFF',
        minHeight: 48, alignItems: 'center', justifyContent: 'center',
    },
    addText: { color: NAVY, fontSize: 15 },
    note: { flexDirection: 'row', gap: 8, backgroundColor: MINT, borderRadius: 16, padding: 14, marginTop: 12 },
    noteText: { flex: 1, color: SAGE, fontSize: 13, lineHeight: 18 },
    pickRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    pick: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#E5E7EB' },
    pickOn: { borderColor: TEAL },
    pickLabel: { color: SAGE, fontSize: 12 },
    pickValue: { color: NAVY, fontWeight: '700', marginTop: 2 },
    save: { marginTop: 16, backgroundColor: TEAL, borderRadius: 14, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
    saveText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
