/**
 * Working hours — which days the coach works, and the ranges on each day.
 * Nothing is stored until Save hours. Days that are off keep their ranges
 * so turning the day back on restores them.
 */

import React, { useCallback, useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Switch,
    Modal,
    Alert,
    ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { fontStyle, useKitFonts } from '../../theme/fonts';
import { getAvailabilityRules, saveWorkingHours } from '../../services/apiClient';
import {
    AvailabilityHeader,
    InlineClock,
    MINT,
    NAVY,
    SAGE,
    SaveBar,
    ScreenBody,
    TEAL,
    formatRangeLabel,
} from './availabilityShared';

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

interface Range { start: string; end: string }
interface DayHours { day: DayKey; enabled: boolean; ranges: Range[] }

const ORDER: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const LABEL: Record<DayKey, string> = {
    mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

function blankWeek(): DayHours[] {
    return ORDER.map(day => ({ day, enabled: false, ranges: [] }));
}

function toMinutes(value: string): number {
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
}

function fromMinutes(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function nextRange(ranges: Range[]): Range {
    if (ranges.length === 0) return { start: '07:00', end: '12:00' };
    const lastEnd = toMinutes(ranges[ranges.length - 1].end);
    const start = Math.min(lastEnd + 60, 22 * 60);
    const end = Math.min(start + 180, 23 * 60 + 45);
    if (end <= start) return { start: '18:00', end: '21:00' };
    return { start: fromMinutes(start), end: fromMinutes(end) };
}

export default function WorkingHoursScreen() {
    const navigation = useNavigation<any>();
    const fonts = useKitFonts();
    const [days, setDays] = useState<DayHours[]>(blankWeek);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editing, setEditing] = useState<{ day: DayKey; index: number } | null>(null);
    const [draftStart, setDraftStart] = useState('07:00');
    const [draftEnd, setDraftEnd] = useState('12:00');

    useFocusEffect(useCallback(() => {
        let alive = true;
        setLoading(true);
        getAvailabilityRules()
            .then(res => {
                if (!alive) return;
                const incoming = res.weekdays ?? [];
                setDays(ORDER.map(day => {
                    const found = incoming.find(item => item.day === day);
                    return {
                        day,
                        enabled: !!found?.enabled,
                        ranges: (found?.ranges ?? []).map(range => ({ start: range.start, end: range.end })),
                    };
                }));
            })
            .catch(err => {
                if (alive) Alert.alert('Could not load hours', err.message ?? 'Please try again.');
            })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, []));

    const update = (day: DayKey, recipe: (current: DayHours) => DayHours) => {
        setDays(prev => prev.map(item => item.day === day ? recipe(item) : item));
    };

    const toggle = (day: DayKey, enabled: boolean) => {
        update(day, current => ({
            ...current,
            enabled,
            ranges: enabled && current.ranges.length === 0
                ? [{ start: '07:00', end: '12:00' }]
                : current.ranges,
        }));
    };

    const openEdit = (day: DayKey, index: number) => {
        const range = days.find(item => item.day === day)?.ranges[index];
        if (!range) return;
        setDraftStart(range.start);
        setDraftEnd(range.end);
        setEditing({ day, index });
    };

    const commitEdit = () => {
        if (!editing) return;
        if (draftEnd <= draftStart) {
            Alert.alert('Check the times', 'The end time has to be later on the same day.');
            return;
        }
        update(editing.day, current => ({
            ...current,
            ranges: current.ranges.map((range, index) =>
                index === editing.index ? { start: draftStart, end: draftEnd } : range,
            ),
        }));
        setEditing(null);
    };

    const save = async () => {
        setSaving(true);
        try {
            await saveWorkingHours(days);
            Alert.alert('Hours saved', 'Open slots will follow these hours.');
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
                title="Working hours"
                subtitle="Any time in 24 hours · multiple ranges a day"
                onBack={() => navigation.goBack()}
            />
            {loading ? (
                <View style={s.centred}>
                    <ActivityIndicator color={TEAL} />
                </View>
            ) : (
                <>
                    <ScreenBody>
                        <View style={s.intro}>
                            <View style={s.introIcon}>
                                <Ionicons name="time-outline" size={18} color={TEAL} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={[s.introTitle, fontStyle(fonts.headingSemibold, '600')]}>
                                    Set the hours you actually work
                                </Text>
                                <Text style={[s.introBody, fontStyle(fonts.body, '400')]}>
                                    Open slots will follow these hours, not a full empty day.
                                </Text>
                            </View>
                        </View>

                        <View style={s.card}>
                            {days.map((day, index) => (
                                <View key={day.day} style={[s.day, index > 0 && s.dayBorder]}>
                                    <View style={s.dayTop}>
                                        <Text style={[s.dayName, fontStyle(fonts.bodySemibold, '600')]}>{LABEL[day.day]}</Text>
                                        {!day.enabled && (
                                            <Text style={[s.off, fontStyle(fonts.body, '400')]}>Day off</Text>
                                        )}
                                        <Switch
                                            value={day.enabled}
                                            onValueChange={value => toggle(day.day, value)}
                                            trackColor={{ false: '#D1D5DB', true: TEAL }}
                                            thumbColor="#FFFFFF"
                                            accessibilityLabel={`${LABEL[day.day]} ${day.enabled ? 'on' : 'day off'}`}
                                        />
                                    </View>
                                    {day.enabled && (
                                        <View style={s.ranges}>
                                            {day.ranges.map((range, rangeIndex) => (
                                                <View key={`${range.start}-${rangeIndex}`} style={s.chip}>
                                                    <TouchableOpacity onPress={() => openEdit(day.day, rangeIndex)} accessibilityRole="button">
                                                        <Text style={[s.chipText, fontStyle(fonts.bodySemibold, '600')]}>
                                                            {formatRangeLabel(range.start, range.end)}
                                                        </Text>
                                                    </TouchableOpacity>
                                                    <TouchableOpacity
                                                        onPress={() => update(day.day, current => ({
                                                            ...current,
                                                            ranges: current.ranges.filter((_, i) => i !== rangeIndex),
                                                        }))}
                                                        accessibilityRole="button"
                                                        accessibilityLabel="Remove this range"
                                                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                                    >
                                                        <Ionicons name="close" size={14} color={SAGE} />
                                                    </TouchableOpacity>
                                                </View>
                                            ))}
                                            <TouchableOpacity
                                                onPress={() => update(day.day, current => ({
                                                    ...current,
                                                    ranges: [...current.ranges, nextRange(current.ranges)],
                                                }))}
                                                accessibilityRole="button"
                                                accessibilityLabel={`Add a range on ${LABEL[day.day]}`}
                                            >
                                                <Text style={[s.add, fontStyle(fonts.bodySemibold, '600')]}>+ Add</Text>
                                            </TouchableOpacity>
                                        </View>
                                    )}
                                </View>
                            ))}
                        </View>
                    </ScreenBody>
                    <SaveBar label="Save hours" onPress={save} disabled={saving} />
                </>
            )}

            <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
                <TouchableOpacity style={s.scrim} activeOpacity={1} onPress={() => setEditing(null)} />
                <View style={s.sheet}>
                    <Text style={[s.sheetTitle, fontStyle(fonts.headingSemibold, '600')]}>Edit range</Text>
                    <Text style={[s.sheetLabel, fontStyle(fonts.bodySemibold, '600')]}>Start</Text>
                    <InlineClock key={`s-${draftStart}`} value={draftStart} onChange={setDraftStart} />
                    <Text style={[s.sheetLabel, fontStyle(fonts.bodySemibold, '600')]}>End</Text>
                    <InlineClock key={`e-${draftEnd}`} value={draftEnd} onChange={setDraftEnd} />
                    <TouchableOpacity style={s.sheetSave} onPress={commitEdit} accessibilityRole="button">
                        <Text style={[s.sheetSaveText, fontStyle(fonts.bodySemibold, '600')]}>Use this range</Text>
                    </TouchableOpacity>
                </View>
            </Modal>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#F7F8FA' },
    centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    intro: {
        flexDirection: 'row',
        gap: 12,
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 14,
        marginBottom: 12,
    },
    introIcon: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: MINT, alignItems: 'center', justifyContent: 'center',
    },
    introTitle: { color: NAVY, fontSize: 15, marginBottom: 4 },
    introBody: { color: SAGE, fontSize: 13, lineHeight: 18 },
    card: { backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 14 },
    day: { paddingVertical: 12 },
    dayBorder: { borderTopWidth: 1, borderTopColor: '#F3F4F6' },
    dayTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dayName: { color: NAVY, fontSize: 15, width: 40 },
    off: { flex: 1, color: '#9CA3AF', fontSize: 14 },
    ranges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, paddingLeft: 40 },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderColor: '#D1E7E2',
        backgroundColor: '#F8FFFC',
        borderRadius: 20,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    chipText: { color: TEAL, fontSize: 13 },
    add: { color: TEAL, fontSize: 13, paddingVertical: 6 },
    scrim: { flex: 1, backgroundColor: 'rgba(15,42,55,0.35)' },
    sheet: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 16,
        maxHeight: '88%',
    },
    sheetTitle: { color: NAVY, fontSize: 18, marginBottom: 8 },
    sheetLabel: { color: SAGE, fontSize: 13, marginTop: 12, marginBottom: 8 },
    sheetSave: {
        marginTop: 16,
        backgroundColor: TEAL,
        borderRadius: 14,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sheetSaveText: { color: '#FFFFFF', fontSize: 16 },
});
