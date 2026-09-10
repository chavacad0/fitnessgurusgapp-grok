/**
 * DateStrip
 *
 * Horizontal 7-day scrollable date selector for the coach BookingScreen.
 *
 * Layout (left → right):
 *   2 past days | TODAY (bold, always visible) | 4 future days
 *
 * Each day cell shows:
 *   - Short weekday label  ("Mon")
 *   - Day number           ("1")
 *   - Dot indicator row    (● green = open slots, ● blue = has bookings)
 *
 * Selected day: accent-coloured pill background.
 * Today cell: bold day number + "Today" label when not selected.
 * Past days: muted text, still tappable (coach may review history).
 *
 * Props:
 *   selectedDate      — YYYY-MM-DD currently shown in BookingScreen
 *   onDateSelect      — callback when user taps a day
 *   datesWithSlots    — Set<YYYY-MM-DD> of dates that have open availability slots (green dot)
 *   datesWithBookings — Set<YYYY-MM-DD> of dates that have bookings (blue dot)
 */

import React, { useRef, useEffect, useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
} from 'react-native';

// ─── Design tokens (matches BookingScreen palette) ────────────────────────────

const NAVY   = '#1B3A4B';
const GREEN  = '#16A34A';
const BLUE   = '#4F46E5';
const GRAY   = '#6B7280';
const LIGHT  = '#F3F4F6';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns YYYY-MM-DD for a Date object in Asia/Singapore timezone. */
function toSGT(date: Date): string {
    return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

/** Short weekday: "Mon", "Tue" … */
function weekday(iso: string): string {
    return new Date(`${iso}T00:00:00+08:00`).toLocaleDateString('en-SG', {
        weekday: 'short',
        timeZone: 'Asia/Singapore',
    });
}

/** Day-of-month number: "1", "28" … */
function dayNum(iso: string): string {
    return new Date(`${iso}T00:00:00+08:00`).toLocaleDateString('en-SG', {
        day: 'numeric',
        timeZone: 'Asia/Singapore',
    });
}

/**
 * Build the array of YYYY-MM-DD strings to display in the strip.
 * Always: 2 past + today + 4 future = 7 days.
 */
function buildDays(todayISO: string): string[] {
    const base = new Date(`${todayISO}T00:00:00+08:00`);
    return Array.from({ length: 9 }, (_, i) => {
        const d = new Date(base);
        d.setDate(d.getDate() + (i - 2)); // -2 … +6
        return toSGT(d);
    });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DateStripProps {
    /** Currently selected date YYYY-MM-DD */
    selectedDate: string;
    /** Called when the user taps a day cell */
    onDateSelect: (date: string) => void;
    /** Dates that have at least one open (unbooked) availability slot — green dot */
    datesWithSlots?: Set<string>;
    /** Dates that have at least one booking (any status) — blue dot */
    datesWithBookings?: Set<string>;
}

// ─── Component ────────────────────────────────────────────────────────────────

const CELL_WIDTH   = 52;
const CELL_MARGIN  = 6;
const CELL_TOTAL   = CELL_WIDTH + CELL_MARGIN * 2;

export default function DateStrip({
    selectedDate,
    onDateSelect,
    datesWithSlots,
    datesWithBookings,
}: DateStripProps) {
    const scrollRef = useRef<ScrollView>(null);
    const today     = useMemo(() => {
        return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    }, []);
    const days      = useMemo(() => buildDays(today), [today]);

    // Scroll so the selected date is always visible (ideally near centre)
    useEffect(() => {
        const idx = days.indexOf(selectedDate);
        if (idx < 0 || !scrollRef.current) return;
        // Offset so the selected cell is roughly centred on screen
        const offset = Math.max(0, (idx - 3) * CELL_TOTAL);
        scrollRef.current.scrollTo({ x: offset, animated: true });
    }, [selectedDate, days]);

    return (
        <View style={s.container}>
            <ScrollView
                ref={scrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.scroll}
            >
                {days.map((iso) => {
                    const isSelected  = iso === selectedDate;
                    const isToday     = iso === today;
                    const isPast      = iso < today;
                    const hasSlot     = datesWithSlots?.has(iso);
                    const hasBooking  = datesWithBookings?.has(iso);

                    return (
                        <TouchableOpacity
                            key={iso}
                            style={[
                                s.cell,
                                isSelected && s.cellSelected,
                                isPast && !isSelected && s.cellPast,
                            ]}
                            onPress={() => onDateSelect(iso)}
                            activeOpacity={0.75}
                            accessibilityRole="button"
                            accessibilityLabel={`${isToday ? 'Today, ' : ''}${weekday(iso)} ${dayNum(iso)}${isSelected ? ', selected' : ''}`}
                            accessibilityState={{ selected: isSelected }}
                        >
                            {/* Weekday label */}
                            <Text style={[
                                s.weekday,
                                isSelected && s.textSelected,
                                isPast && !isSelected && s.textMuted,
                            ]}>
                                {isToday && !isSelected ? 'Today' : weekday(iso)}
                            </Text>

                            {/* Day number */}
                            <Text style={[
                                s.dayNum,
                                isSelected && s.textSelected,
                                isToday && !isSelected && s.dayNumToday,
                                isPast && !isSelected && s.textMuted,
                            ]}>
                                {dayNum(iso)}
                            </Text>

                            {/* Dot indicators */}
                            <View style={s.dots}>
                                {hasSlot && (
                                    <View style={[s.dot, { backgroundColor: isSelected ? '#fff' : GREEN }]} />
                                )}
                                {hasBooking && (
                                    <View style={[s.dot, { backgroundColor: isSelected ? '#fff' : BLUE }]} />
                                )}
                                {/* Invisible spacer so cells maintain equal height */}
                                {!hasSlot && !hasBooking && (
                                    <View style={s.dotPlaceholder} />
                                )}
                            </View>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>
        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    container: {
        backgroundColor: '#FFFFFF',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: LIGHT,
    },
    scroll: {
        paddingHorizontal: 12,
        alignItems: 'center',
    },

    // ── Day cell ──────────────────────────────────────────────────────────────
    cell: {
        width:           CELL_WIDTH,
        marginHorizontal: CELL_MARGIN,
        borderRadius:    14,
        alignItems:      'center',
        paddingVertical: 8,
        paddingHorizontal: 4,
    },
    cellSelected: {
        backgroundColor: NAVY,
    },
    cellPast: {
        opacity: 0.5,
    },

    // ── Labels ────────────────────────────────────────────────────────────────
    weekday: {
        fontSize:    10,
        fontWeight:  '600',
        color:       GRAY,
        letterSpacing: 0.3,
        marginBottom: 4,
        textTransform: 'uppercase',
    },
    dayNum: {
        fontSize:   18,
        fontWeight: '700',
        color:      NAVY,
        lineHeight: 22,
    },
    dayNumToday: {
        color: NAVY,
        // Underline hint for today when not selected
        textDecorationLine: 'underline',
    },
    textSelected: {
        color: '#FFFFFF',
    },
    textMuted: {
        color: GRAY,
    },

    // ── Dot indicators ────────────────────────────────────────────────────────
    dots: {
        flexDirection: 'row',
        gap:            3,
        marginTop:      4,
        height:         7,
        alignItems:     'center',
        justifyContent: 'center',
    },
    dot: {
        width:        6,
        height:       6,
        borderRadius: 3,
    },
    dotPlaceholder: {
        width:  6,
        height: 6,
    },
});
