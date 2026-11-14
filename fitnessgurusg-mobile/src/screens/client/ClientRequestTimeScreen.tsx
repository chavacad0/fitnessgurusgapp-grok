/**
 * Request a time. Sending this does not book a session.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, TextInput, ScrollView,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { fontStyle, useKitFonts } from '../../theme/fonts';
import { getMyBestTimes, getMyTimeRequests, sendTimeRequest } from '../../services/apiClient';
import { BestWindow, TimeRequestItem } from '../../types';
import {
    AvailabilityHeader, InlineClock, MINT, NAVY, SAGE, ScreenBody, TEAL, formatTimeLabel, todaySingapore,
} from '../coach/availabilityShared';

const WINDOW_HOURS: Record<BestWindow, { label: string; days: string[]; hours: number[] }> = {
    weekday_mornings: { label: 'Weekday mornings', days: ['mon', 'tue', 'wed', 'thu', 'fri'], hours: [6, 7] },
    lunch: { label: 'Lunch', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], hours: [12, 13] },
    after_work: { label: 'After work', days: ['mon', 'tue', 'wed', 'thu', 'fri'], hours: [18, 19, 20] },
    weekends: { label: 'Weekends', days: ['sat', 'sun'], hours: [9, 10, 11] },
};

function addDays(iso: string, days: number): string {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function weekdayKey(iso: string): string {
    const label = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Singapore' })
        .format(new Date(`${iso}T12:00:00+08:00`));
    return ({ Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun' } as Record<string, string>)[label] ?? 'mon';
}

function dayChip(iso: string): { dow: string; num: string } {
    const date = new Date(`${iso}T12:00:00+08:00`);
    return {
        dow: date.toLocaleDateString('en-SG', { weekday: 'short', timeZone: 'Asia/Singapore' }),
        num: date.toLocaleDateString('en-SG', { day: 'numeric', timeZone: 'Asia/Singapore' }),
    };
}

export default function ClientRequestTimeScreen() {
    const navigation = useNavigation<any>();
    const fonts = useKitFonts();
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [coachName, setCoachName] = useState('your coach');
    const [coachFirst, setCoachFirst] = useState('Your coach');
    const [length, setLength] = useState(60);
    const [windows, setWindows] = useState<BestWindow[]>([]);
    const [date, setDate] = useState(addDays(todaySingapore(), 1));
    const [time, setTime] = useState<string | null>(null);
    const [note, setNote] = useState('');
    const [requests, setRequests] = useState<TimeRequestItem[]>([]);
    const dates = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(todaySingapore(), i)), []);

    const load = useCallback(() => {
        setLoading(true);
        Promise.all([getMyBestTimes(), getMyTimeRequests()])
            .then(([best, mine]) => {
                setCoachName(best.coach_name || 'your coach');
                setCoachFirst(best.coach_first_name || 'Your coach');
                setLength(best.slot_length_minutes || 60);
                setWindows(best.windows ?? []);
                setRequests(mine.requests ?? []);
            })
            .catch(err => Alert.alert('Could not load', err.message ?? 'Please try again.'))
            .finally(() => setLoading(false));
    }, []);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const day = weekdayKey(date);
    const chips = useMemo(() => {
        const hours = new Set<number>();
        for (const id of windows) {
            const spec = WINDOW_HOURS[id];
            if (spec.days.includes(day)) spec.hours.forEach(hour => hours.add(hour));
        }
        return [...hours].sort((a, b) => a - b).map(hour => `${String(hour).padStart(2, '0')}:00`);
    }, [windows, day]);

    const sitting = windows
        .map(id => WINDOW_HOURS[id])
        .find(spec => time && spec.days.includes(day) && spec.hours.includes(Number(time.slice(0, 2))));

    const heading = new Date(`${date}T12:00:00+08:00`).toLocaleDateString('en-SG', {
        weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Singapore',
    });

    const send = async () => {
        if (!time) {
            Alert.alert('Choose a time', 'Pick one of the times, or set the clock.');
            return;
        }
        setSending(true);
        try {
            await sendTimeRequest({ date, start_time: time, note: note.trim() || undefined });
            Alert.alert('Request sent', 'Nothing is booked until your coach confirms.');
            setNote('');
            load();
        } catch (err: any) {
            Alert.alert('Could not send', err.message ?? 'Please try again.');
        } finally {
            setSending(false);
        }
    };

    return (
        <View style={s.root}>
            <AvailabilityHeader
                title="Request a time"
                subtitle={`With ${coachName}`}
                onBack={() => navigation.goBack()}
            />
            {loading ? <View style={s.centred}><ActivityIndicator color={TEAL} /></View> : (
                <ScreenBody>
                    <Text style={[s.kicker, fontStyle(fonts.bodySemibold, '600')]}>DATE</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.dates}>
                        {dates.map(iso => {
                            const chip = dayChip(iso);
                            const on = iso === date;
                            return (
                                <TouchableOpacity key={iso} style={[s.date, on && s.dateOn]} onPress={() => { setDate(iso); setTime(null); }}>
                                    <Text style={[s.dateDow, on && s.dateOnText]}>{chip.dow}</Text>
                                    <Text style={[s.dateNum, on && s.dateOnText]}>{chip.num}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                    <Text style={[s.dateTitle, fontStyle(fonts.headingSemibold, '600')]}>{heading}</Text>
                    {sitting && <Text style={s.sits}>This sits in your {sitting.label} window</Text>}

                    <Text style={[s.kicker, fontStyle(fonts.bodySemibold, '600')]}>TIME</Text>
                    <View style={s.chips}>
                        {chips.map(item => {
                            const on = item === time;
                            return (
                                <TouchableOpacity key={item} style={[s.chip, on && s.chipOn]} onPress={() => setTime(item)}>
                                    <Text style={[s.chipText, on && s.chipTextOn]}>{formatTimeLabel(item)}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                    <InlineClock value={time ?? '19:00'} onChange={setTime} />
                    <Text style={s.length}>{length} min session · you can add a note below</Text>

                    <View style={s.confirm}>
                        <Ionicons name="information-circle-outline" size={18} color={TEAL} />
                        <View style={{ flex: 1 }}>
                            <Text style={[s.confirmTitle, fontStyle(fonts.headingSemibold, '600')]}>
                                Nothing is booked until your coach confirms
                            </Text>
                            <Text style={s.confirmBody}>
                                {coachFirst} will accept, suggest another time, or decline. You’ll get a note either way.
                            </Text>
                        </View>
                    </View>

                    <TextInput
                        style={s.input}
                        value={note}
                        onChangeText={setNote}
                        placeholder="Note for your coach (optional)"
                        placeholderTextColor="#9CA3AF"
                        multiline
                    />
                    <TouchableOpacity style={[s.send, sending && { opacity: 0.55 }]} onPress={send} disabled={sending}>
                        <Text style={s.sendText}>Send request</Text>
                    </TouchableOpacity>

                    {requests.map(item => (
                        <View key={item.id} style={s.mine}>
                            <Text style={s.mineTitle}>{item.headline}</Text>
                            <Text style={s.mineSub}>{item.detail}</Text>
                            {item.status === 'pending' || item.status === 'suggested' ? (
                                <Text style={s.mineWait}>Nothing is booked until your coach confirms.</Text>
                            ) : null}
                            {item.status === 'suggested' && !!item.suggested_start ? (
                                <Text style={s.mineSub}>Your coach suggested another time.</Text>
                            ) : null}
                        </View>
                    ))}
                </ScreenBody>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#F7F8FA' },
    centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    kicker: { color: SAGE, fontSize: 12, letterSpacing: 0.6, marginBottom: 8 },
    dates: { gap: 8, paddingBottom: 8 },
    date: { width: 52, borderRadius: 14, paddingVertical: 8, alignItems: 'center', backgroundColor: '#FFFFFF' },
    dateOn: { backgroundColor: NAVY },
    dateDow: { color: SAGE, fontSize: 11 },
    dateNum: { color: NAVY, fontSize: 16, fontWeight: '700' },
    dateOnText: { color: '#FFFFFF' },
    dateTitle: { color: NAVY, fontSize: 20, marginTop: 8 },
    sits: { color: SAGE, fontSize: 13, marginTop: 4, marginBottom: 8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    chip: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#FFFFFF' },
    chipOn: { backgroundColor: NAVY, borderColor: NAVY },
    chipText: { color: NAVY, fontWeight: '700' },
    chipTextOn: { color: '#FFFFFF' },
    length: { color: SAGE, fontSize: 13, marginTop: 8 },
    confirm: { flexDirection: 'row', gap: 8, backgroundColor: MINT, borderRadius: 16, padding: 14, marginTop: 14 },
    confirmTitle: { color: NAVY, fontSize: 15 },
    confirmBody: { color: SAGE, fontSize: 13, lineHeight: 18, marginTop: 4 },
    input: {
        marginTop: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB',
        borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 72, color: NAVY,
    },
    send: { marginTop: 14, backgroundColor: TEAL, borderRadius: 14, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
    sendText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
    mine: { marginTop: 12, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 12 },
    mineTitle: { color: NAVY, fontWeight: '700' },
    mineSub: { color: SAGE, fontSize: 12, marginTop: 4 },
    mineWait: { color: TEAL, fontSize: 12, marginTop: 6 },
});
