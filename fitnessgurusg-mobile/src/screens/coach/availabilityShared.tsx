/**
 * Shared pieces for the working-hours screens.
 * Navy, teal, sage, and mint match the approved booking mockups.
 * Poppins and Inter come from the design kit and fall back to the phone font.
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fontStyle, useKitFonts } from '../../theme/fonts';

export const NAVY = '#183A4A';
export const TEAL = '#0F766E';
export const SAGE = '#4F7F71';
export const MINT = '#E6F7F1';

export function formatTimeLabel(hhmm: string): string {
    const [hRaw, mRaw] = hhmm.split(':').map(Number);
    const h = Number.isFinite(hRaw) ? hRaw : 0;
    const m = Number.isFinite(mRaw) ? mRaw : 0;
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function formatRangeLabel(start: string, end: string): string {
    return `${formatTimeLabel(start)}–${formatTimeLabel(end)}`;
}

/** How many sessions fit, using the same step as the server. */
export function previewSlotCount(start: string, end: string, length: number, buffer: number): number {
    const toMin = (value: string) => {
        const [h, m] = value.split(':').map(Number);
        return h * 60 + m;
    };
    const from = toMin(start);
    const to = toMin(end);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || length <= 0 || buffer < 0) return 0;
    let count = 0;
    let cursor = from;
    while (cursor + length <= to && count < 96) {
        count += 1;
        cursor += length + buffer;
    }
    return count;
}

export function singaporeParts(iso: string): { weekday: string; weekdayLong: string; day: string; month: string } {
    const date = new Date(`${iso}T12:00:00+08:00`);
    const opt = { timeZone: 'Asia/Singapore' } as const;
    return {
        weekday: date.toLocaleDateString('en-SG', { ...opt, weekday: 'short' }),
        weekdayLong: date.toLocaleDateString('en-SG', { ...opt, weekday: 'long' }),
        day: date.toLocaleDateString('en-SG', { ...opt, day: 'numeric' }),
        month: date.toLocaleDateString('en-SG', { ...opt, month: 'short' }),
    };
}

export function todaySingapore(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

export function AvailabilityHeader({
    title,
    subtitle,
    onBack,
}: {
    title: string;
    subtitle: string;
    onBack: () => void;
}) {
    const insets = useSafeAreaInsets();
    const fonts = useKitFonts();
    return (
        <View style={[header.wrap, { paddingTop: insets.top + 8 }]}>
            <View style={header.row}>
                <TouchableOpacity
                    onPress={onBack}
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
                </TouchableOpacity>
                <Text style={[header.title, fontStyle(fonts.heading, '700')]}>{title}</Text>
                <View style={header.pill}>
                    <Text style={[header.pillText, fontStyle(fonts.bodySemibold, '600')]}>NEW</Text>
                </View>
            </View>
            <Text style={[header.sub, fontStyle(fonts.body, '400')]}>{subtitle}</Text>
        </View>
    );
}

const header = StyleSheet.create({
    wrap: {
        backgroundColor: NAVY,
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    title: { flex: 1, color: '#FFFFFF', fontSize: 22 },
    pill: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    pillText: { color: NAVY, fontSize: 10, letterSpacing: 0.4 },
    sub: { color: 'rgba(255,255,255,0.72)', fontSize: 13, marginTop: 6, marginLeft: 28 },
});

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 15, 30, 45];

function splitClock(hhmm: string): { hour12: number; minute: number; period: 'AM' | 'PM' } {
    const [hRaw, mRaw] = hhmm.split(':').map(Number);
    const h = Number.isFinite(hRaw) ? hRaw : 9;
    const minute = MINUTES.reduce((best, item) =>
        Math.abs(item - (mRaw || 0)) < Math.abs(best - (mRaw || 0)) ? item : best, 0);
    return {
        hour12: h % 12 || 12,
        minute,
        period: h >= 12 ? 'PM' : 'AM',
    };
}

function joinClock(hour12: number, minute: number, period: 'AM' | 'PM'): string {
    let h = hour12 % 12;
    if (period === 'PM') h += 12;
    return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Hour and minute choices covering the whole day, in 15 minute steps.
 * No extra package: the chips are ordinary buttons.
 */
export function InlineClock({
    value,
    onChange,
}: {
    value: string;
    onChange: (hhmm: string) => void;
}) {
    const fonts = useKitFonts();
    const clock = splitClock(value);
    const [period, setPeriod] = useState<'AM' | 'PM'>(clock.period);
    const [hour12, setHour12] = useState(clock.hour12);
    const [minute, setMinute] = useState(clock.minute);

    const apply = (nextHour: number, nextMinute: number, nextPeriod: 'AM' | 'PM') => {
        setHour12(nextHour);
        setMinute(nextMinute);
        setPeriod(nextPeriod);
        onChange(joinClock(nextHour, nextMinute, nextPeriod));
    };

    return (
        <View>
            <View style={clockStyles.periodRow}>
                {(['AM', 'PM'] as const).map(item => {
                    const on = item === period;
                    return (
                        <TouchableOpacity
                            key={item}
                            style={[clockStyles.period, on && clockStyles.periodOn]}
                            onPress={() => apply(hour12, minute, item)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}
                        >
                            <Text style={[clockStyles.periodText, on && clockStyles.periodTextOn, fontStyle(fonts.bodySemibold, '600')]}>
                                {item}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
            <View style={clockStyles.wrap}>
                {HOURS.map(item => {
                    const on = item === hour12;
                    return (
                        <TouchableOpacity
                            key={item}
                            style={[clockStyles.chip, on && clockStyles.chipOn]}
                            onPress={() => apply(item, minute, period)}
                            accessibilityRole="button"
                            accessibilityLabel={`${item} ${period}`}
                        >
                            <Text style={[clockStyles.chipText, on && clockStyles.chipTextOn, fontStyle(fonts.bodySemibold, '600')]}>
                                {item}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
            <View style={clockStyles.minuteRow}>
                {MINUTES.map(item => {
                    const on = item === minute;
                    const label = String(item).padStart(2, '0');
                    return (
                        <TouchableOpacity
                            key={item}
                            style={[clockStyles.minute, on && clockStyles.chipOn]}
                            onPress={() => apply(hour12, item, period)}
                            accessibilityRole="button"
                            accessibilityLabel={`${label} minutes`}
                        >
                            <Text style={[clockStyles.chipText, on && clockStyles.chipTextOn, fontStyle(fonts.bodySemibold, '600')]}>
                                :{label}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
}

const clockStyles = StyleSheet.create({
    periodRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
    period: {
        flex: 1,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRadius: 12,
        paddingVertical: 8,
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
    },
    periodOn: { backgroundColor: NAVY, borderColor: NAVY },
    periodText: { color: NAVY, fontSize: 14 },
    periodTextOn: { color: '#FFFFFF' },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
        width: 48,
        height: 36,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FFFFFF',
    },
    chipOn: { backgroundColor: NAVY, borderColor: NAVY },
    chipText: { color: NAVY, fontSize: 14 },
    chipTextOn: { color: '#FFFFFF' },
    minuteRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    minute: {
        flex: 1,
        height: 36,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FFFFFF',
    },
});

export function SaveBar({
    label,
    onPress,
    disabled,
}: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
}) {
    const fonts = useKitFonts();
    const insets = useSafeAreaInsets();
    return (
        <View style={[save.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <TouchableOpacity
                style={[save.btn, disabled && { opacity: 0.55 }]}
                onPress={onPress}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={label}
            >
                <Text style={[save.label, fontStyle(fonts.headingSemibold, '600')]}>{label}</Text>
            </TouchableOpacity>
        </View>
    );
}

const save = StyleSheet.create({
    wrap: {
        paddingHorizontal: 16,
        paddingTop: 8,
        backgroundColor: '#F7F8FA',
    },
    btn: {
        backgroundColor: TEAL,
        borderRadius: 14,
        minHeight: 52,
        alignItems: 'center',
        justifyContent: 'center',
    },
    label: { color: '#FFFFFF', fontSize: 16 },
});

export function ScreenBody({ children }: { children: React.ReactNode }) {
    return (
        <ScrollView
            style={{ flex: 1, backgroundColor: '#F7F8FA' }}
            contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
        >
            {children}
        </ScrollView>
    );
}
