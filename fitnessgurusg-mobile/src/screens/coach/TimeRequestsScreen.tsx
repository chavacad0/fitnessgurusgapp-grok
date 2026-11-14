/**
 * Coach inbox for time requests.
 * Accept creates a booking through the existing booking path.
 * Suggest and Decline do not book anything.
 */

import React, { useCallback, useState } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Modal,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { fontStyle, useKitFonts } from '../../theme/fonts';
import {
    acceptTimeRequest, declineTimeRequest, getCoachTimeRequests, suggestTimeRequest,
} from '../../services/apiClient';
import { TimeRequestItem } from '../../types';
import MonthCalendar from '../../components/MonthCalendar';
import {
    AvailabilityHeader, InlineClock, MINT, NAVY, SAGE, ScreenBody, TEAL, todaySingapore,
} from './availabilityShared';

function initials(name: string): string {
    return name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'C';
}

export default function TimeRequestsScreen() {
    const navigation = useNavigation<any>();
    const fonts = useKitFonts();
    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState<TimeRequestItem[]>([]);
    const [suggesting, setSuggesting] = useState<TimeRequestItem | null>(null);
    const [date, setDate] = useState(todaySingapore());
    const [time, setTime] = useState('18:00');
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        getCoachTimeRequests()
            .then(res => setRows(res.requests ?? []))
            .catch(err => Alert.alert('Could not load requests', err.message ?? 'Please try again.'))
            .finally(() => setLoading(false));
    }, []);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const run = async (work: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await work();
            load();
        } catch (err: any) {
            Alert.alert('Could not update the request', err.message ?? 'Please try again.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <View style={s.root}>
            <AvailabilityHeader
                title="Time requests"
                subtitle="Nothing is booked until you confirm"
                onBack={() => navigation.goBack()}
            />
            {loading ? <View style={s.centred}><ActivityIndicator color={TEAL} /></View> : (
                <ScreenBody>
                    {rows.length === 0 && (
                        <Text style={s.empty}>No requests waiting.</Text>
                    )}
                    {rows.map(item => (
                        <View key={item.id} style={s.card}>
                            <View style={s.top}>
                                <View style={s.avatar}><Text style={s.avatarText}>{initials(item.client_name)}</Text></View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[s.title, fontStyle(fonts.headingSemibold, '600')]}>{item.headline}</Text>
                                    <Text style={s.detail}>{item.detail}</Text>
                                    {!!item.note && <Text style={s.detail}>{item.note}</Text>}
                                    {!!item.suggestion_label && <Text style={s.detail}>{item.suggestion_label}</Text>}
                                </View>
                            </View>
                            <View style={s.actions}>
                                <TouchableOpacity
                                    style={s.accept}
                                    disabled={busy}
                                    onPress={() => run(() => acceptTimeRequest(item.id))}
                                    accessibilityRole="button"
                                    accessibilityLabel="Accept"
                                >
                                    <Text style={s.acceptText}>Accept</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={s.suggest}
                                    disabled={busy}
                                    onPress={() => { setSuggesting(item); setDate(item.date); setTime(item.start_time); }}
                                    accessibilityRole="button"
                                >
                                    <Text style={s.suggestText}>Suggest another time</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={s.decline}
                                    disabled={busy}
                                    onPress={() => run(() => declineTimeRequest(item.id))}
                                    accessibilityRole="button"
                                >
                                    <Text style={s.declineText}>Decline</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ))}
                    <View style={s.note}>
                        <Ionicons name="information-circle-outline" size={18} color={TEAL} />
                        <Text style={s.noteText}>
                            Accept adds the session to your schedule. Suggest another time sends a new slot. Decline lets them pick again.
                        </Text>
                    </View>
                </ScreenBody>
            )}
            <Modal visible={!!suggesting} animationType="slide" onRequestClose={() => setSuggesting(null)}>
                <AvailabilityHeader title="Suggest another time" subtitle="Nothing is booked until you confirm" onBack={() => setSuggesting(null)} />
                <ScreenBody>
                    <MonthCalendar selectedDate={date} onSelectDate={setDate} />
                    <View style={{ marginTop: 12 }}>
                        <InlineClock value={time} onChange={setTime} />
                    </View>
                    <TouchableOpacity
                        style={s.send}
                        onPress={() => {
                            if (!suggesting) return;
                            run(async () => {
                                await suggestTimeRequest(suggesting.id, date, time);
                                setSuggesting(null);
                            });
                        }}
                    >
                        <Text style={s.acceptText}>Suggest another time</Text>
                    </TouchableOpacity>
                </ScreenBody>
            </Modal>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#F7F8FA' },
    centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    empty: { color: SAGE, textAlign: 'center', marginVertical: 12 },
    card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, marginBottom: 12 },
    top: { flexDirection: 'row', gap: 10 },
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: MINT, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: TEAL, fontWeight: '800' },
    title: { color: NAVY, fontSize: 16 },
    detail: { color: SAGE, fontSize: 13, marginTop: 4 },
    actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
    accept: { backgroundColor: TEAL, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
    acceptText: { color: '#FFFFFF', fontWeight: '700' },
    suggest: { flex: 1, backgroundColor: MINT, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
    suggestText: { color: TEAL, fontWeight: '700', fontSize: 12, textAlign: 'center' },
    decline: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
    declineText: { color: NAVY, fontWeight: '700' },
    note: { flexDirection: 'row', gap: 8, backgroundColor: MINT, borderRadius: 16, padding: 14 },
    noteText: { flex: 1, color: SAGE, fontSize: 13, lineHeight: 18 },
    send: { marginTop: 16, backgroundColor: TEAL, borderRadius: 14, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
