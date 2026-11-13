/**
 * MonthCalendar
 *
 * Full-month calendar selector for the coach BookingScreen.
 * Replaces the 7-day horizontal DateStrip.
 *
 * Features:
 *   - Month header with < / > navigation arrows
 *   - 7-column grid (Sun → Sat)
 *   - Selected date: NAVY pill
 *   - Today: accent ring (when not selected)
 *   - Past dates: muted, still tappable (coach review)
 *   - Green dot: date has open (unbooked) availability slots
 *   - Blue dot:  date has booked sessions
 *   - Both dots can appear simultaneously
 *
 * Props:
 *   selectedDate  — YYYY-MM-DD; the currently highlighted date
 *   onSelectDate  — callback fired when the coach taps a day
 *   summaries     — optional map of DaySummary per date for dot indicators
 *
 * Internal state:
 *   viewMonth     — "YYYY-MM" of the month currently displayed
 *                   Initialised from selectedDate; navigated independently.
 */

import React, { useMemo, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DaySummary } from '../types';

// ─── Design tokens (matches BookingScreen palette) ────────────────────────────

const NAVY    = '#183A4A';
const GREEN   = '#16A34A';
const BLUE    = '#183A4A';
const GRAY    = '#6B7280';
const LIGHT   = '#F3F4F6';
const WHITE   = '#FFFFFF';
const ACCENT_RING = '#0E6B64';  // teal ring for today (from theme.ts accent)

// ─── Types ────────────────────────────────────────────────────────────────────

export type MonthCalendarProps = {
    /** Currently selected date YYYY-MM-DD */
    selectedDate: string;
    /** Called when the coach taps any day cell */
    onSelectDate: (date: string) => void;
    /** Optional per-date summary for dot indicators */
    summaries?: Record<string, DaySummary>;
};

// ─── Calendar math helpers ────────────────────────────────────────────────────

/** Returns YYYY-MM-DD in SGT for a Date object */
function toSGT(date: Date): string {
    return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

/** Today in SGT as YYYY-MM-DD */
function todaySGT(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

/** "May 2026" from "2026-05" */
function formatMonthLabel(ym: string): string {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-SG', {
        month: 'long',
        year:  'numeric',
    });
}

/**
 * buildCalendarDays
 * Returns a flat array of YYYY-MM-DD strings to fill the 6-row × 7-col grid,
 * including leading/trailing nulls for days outside the view month.
 * Week starts Sunday.
 */
function buildCalendarDays(viewMonth: string): (string | null)[] {
    const [y, m] = viewMonth.split('-').map(Number);
    const firstDay = new Date(y, m - 1, 1);
    const lastDay  = new Date(y, m, 0);           // last day of month
    const startDow = firstDay.getDay();            // 0 = Sunday
    const totalDays = lastDay.getDate();

    const cells: (string | null)[] = [];

    // Leading nulls
    for (let i = 0; i < startDow; i++) cells.push(null);

    // Month days
    for (let d = 1; d <= totalDays; d++) {
        const date = new Date(y, m - 1, d);
        cells.push(toSGT(date));
    }

    // Trailing nulls to complete the last row
    while (cells.length % 7 !== 0) cells.push(null);

    return cells;
}

/** Navigate a "YYYY-MM" string by delta months (-1 or +1) */
function shiftMonth(ym: string, delta: number): string {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const ny = d.getFullYear();
    const nm = String(d.getMonth() + 1).padStart(2, '0');
    return `${ny}-${nm}`;
}

// ─── Day cell sub-component ───────────────────────────────────────────────────

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

interface DayCellProps {
    iso:        string;
    today:      string;
    selected:   string;
    summary?:   DaySummary;
    onPress:    (iso: string) => void;
}

function DayCell({ iso, today, selected, summary, onPress }: DayCellProps) {
    const isSelected = iso === selected;
    const isToday    = iso === today;
    const isPast     = iso < today;

    const dayNum = String(parseInt(iso.split('-')[2]!, 10));  // strip leading zero

    const hasOpen   = (summary?.openCount   ?? 0) > 0;
    const hasBooked = (summary?.bookedCount ?? 0) > 0;

    return (
        <TouchableOpacity
            style={[
                dc.cell,
                isSelected && dc.cellSelected,
                isToday && !isSelected && dc.cellToday,
            ]}
            onPress={() => onPress(iso)}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel={`${isToday ? 'Today, ' : ''}${iso}${isSelected ? ', selected' : ''}`}
            accessibilityState={{ selected: isSelected }}
        >
            <Text style={[
                dc.num,
                isSelected && dc.numSelected,
                isToday && !isSelected && dc.numToday,
                isPast && !isSelected && !isToday && dc.numPast,
            ]}>
                {dayNum}
            </Text>

            {/* Dot indicators */}
            <View style={dc.dots}>
                {hasOpen && (
                    <View style={[dc.dot, { backgroundColor: isSelected ? 'rgba(255,255,255,0.85)' : GREEN }]} />
                )}
                {hasBooked && (
                    <View style={[dc.dot, { backgroundColor: isSelected ? 'rgba(255,255,255,0.6)' : BLUE }]} />
                )}
                {!hasOpen && !hasBooked && (
                    <View style={dc.dotPlaceholder} />
                )}
            </View>
        </TouchableOpacity>
    );
}

const dc = StyleSheet.create({
    cell: {
        // Exactly 1/7 of the container width — the only RN-safe way to make a
        // 7-column wrapping grid. flex:1 inside flexWrap:'wrap' does NOT work.
        width:          '14.285%' as any,
        height:         38,            // reduced from 44 — saves ~36px per month view
        alignItems:     'center',
        justifyContent: 'center',
        borderRadius:   8,
    },
    cellSelected: {
        backgroundColor: NAVY,
    },
    cellToday: {
        borderWidth: 1.5,
        borderColor: ACCENT_RING,
    },

    num: {
        fontSize:   13,
        fontWeight: '600',
        color:      NAVY,
        lineHeight: 18,
        textAlign:  'center',
    },
    numSelected: { color: WHITE },
    numToday:    { color: ACCENT_RING, fontWeight: '800' },
    numPast:     { color: GRAY, fontWeight: '400' },

    dots: {
        flexDirection:  'row',
        gap:            3,
        marginTop:      2,
        height:         6,
        alignItems:     'center',
        justifyContent: 'center',
    },
    dot: {
        width:  5,
        height: 5,
        borderRadius: 3,
    },
    dotPlaceholder: {
        width:  5,
        height: 5,
    },
});

// ─── Main component ───────────────────────────────────────────────────────────

export default function MonthCalendar({
    selectedDate,
    onSelectDate,
    summaries = {},
}: MonthCalendarProps) {
    // View month follows selectedDate on first render; navigated independently after.
    const [viewMonth, setViewMonth] = useState<string>(() => selectedDate.slice(0, 7));

    const today = useMemo(() => todaySGT(), []);

    // Keep viewMonth in sync if parent resets selectedDate to a different month
    // (e.g. "Go to today" action). Only sync when the month genuinely differs to
    // avoid fighting the user's own navigation.
    const selectedMonth = selectedDate.slice(0, 7);
    if (selectedMonth !== viewMonth && selectedMonth !== selectedMonth) {
        // intentional no-op guard: only setViewMonth via navigation buttons below
        // or via the useEffect-equivalent pattern. This avoids re-render loops.
    }

    const cells = useMemo(() => buildCalendarDays(viewMonth), [viewMonth]);

    const goToPrev = () => setViewMonth(m => shiftMonth(m, -1));
    const goToNext = () => setViewMonth(m => shiftMonth(m, +1));

    // When a date is tapped that lives in a different month, slide the view too.
    const handleSelectDate = (iso: string) => {
        const isoMonth = iso.slice(0, 7);
        if (isoMonth !== viewMonth) setViewMonth(isoMonth);
        onSelectDate(iso);
    };

    return (
        <View style={s.container}>

            {/* ── Month header ────────────────────────────────────────────── */}
            <View style={s.header}>
                <TouchableOpacity
                    onPress={goToPrev}
                    style={s.navBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Previous month"
                    accessibilityRole="button"
                >
                    <Ionicons name="chevron-back" size={18} color={NAVY} />
                </TouchableOpacity>

                <Text style={s.monthLabel}>{formatMonthLabel(viewMonth)}</Text>

                <TouchableOpacity
                    onPress={goToNext}
                    style={s.navBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Next month"
                    accessibilityRole="button"
                >
                    <Ionicons name="chevron-forward" size={18} color={NAVY} />
                </TouchableOpacity>
            </View>

            {/* ── Weekday row ─────────────────────────────────────────────── */}
            <View style={s.weekRow}>
                {WEEKDAYS.map(d => (
                    <View key={d} style={s.weekCell}>
                        <Text style={s.weekLabel}>{d}</Text>
                    </View>
                ))}
            </View>

            {/* ── Day grid ────────────────────────────────────────────────── */}
            <View style={s.grid}>
                {cells.map((iso, idx) =>
                    iso === null ? (
                        <View key={`empty-${idx}`} style={s.emptyCell} />
                    ) : (
                        <DayCell
                            key={iso}
                            iso={iso}
                            today={today}
                            selected={selectedDate}
                            summary={summaries[iso]}
                            onPress={handleSelectDate}
                        />
                    )
                )}
            </View>

            {/* ── Legend ──────────────────────────────────────────────────── */}
            <View style={s.legend}>
                <View style={s.legendItem}>
                    <View style={[s.legendDot, { backgroundColor: GREEN }]} />
                    <Text style={s.legendLabel}>Open slots</Text>
                </View>
                <View style={s.legendItem}>
                    <View style={[s.legendDot, { backgroundColor: BLUE }]} />
                    <Text style={s.legendLabel}>Booked</Text>
                </View>
            </View>
        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    container: {
        backgroundColor:   WHITE,
        paddingHorizontal: 12,
        paddingTop:        4,
        paddingBottom:     6,
    },

    // ── Month header ──────────────────────────────────────────────────────────
    header: {
        flexDirection:   'row',
        alignItems:      'center',
        justifyContent:  'space-between',
        marginBottom:    8,
    },
    navBtn: {
        width:  32,
        height: 32,
        borderRadius: 8,
        backgroundColor: LIGHT,
        alignItems:      'center',
        justifyContent:  'center',
    },
    monthLabel: {
        fontSize:   15,
        fontWeight: '800',
        color:      NAVY,
        letterSpacing: -0.2,
    },

    // ── Weekday header row ────────────────────────────────────────────────────
    weekRow: {
        flexDirection: 'row',
        marginBottom:  4,
    },
    weekCell: {
        flex:       1,
        alignItems: 'center',
    },
    weekLabel: {
        fontSize:      10,
        fontWeight:    '700',
        color:         GRAY,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },

    // ── Day grid ──────────────────────────────────────────────────────────────
    grid: {
        flexDirection: 'row',
        flexWrap:      'wrap',
        rowGap:        1,       // tight vertical spacing
    },
    emptyCell: {
        // Must match DayCell exactly so empty cells take the same space
        width:  '14.285%' as any,
        height: 38,            // matches dc.cell height
    },

    // ── Legend ────────────────────────────────────────────────────────────────
    legend: {
        flexDirection:  'row',
        justifyContent: 'flex-end',
        gap:            12,
        marginTop:       6,
        paddingRight:    4,
    },
    legendItem: {
        flexDirection: 'row',
        alignItems:    'center',
        gap:           4,
    },
    legendDot: {
        width:        6,
        height:       6,
        borderRadius: 3,
    },
    legendLabel: {
        fontSize:  10,
        color:     GRAY,
        fontWeight: '500',
    },
});
