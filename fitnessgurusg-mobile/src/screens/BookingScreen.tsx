/**
 * BookingScreen — Availability-First Coach Schedule
 *
 * Design principle: "Coach opens app → instantly sees where they are free."
 *
 * ─── Two-section layout ────────────────────────────────────────────────────
 *
 *  SECTION 1 — OPEN SLOTS (Green)
 *    Coach's explicitly set availability windows (GET /api/coach/availability)
 *    minus any already-booked times = true open slots.
 *    Tap any slot → QuickBookModal pre-filled with that time.
 *
 *  SECTION 2 — TODAY'S SESSIONS (Blue / Red)
 *    Confirmed bookings from GET /api/coach/dashboard → today_bookings.
 *    Status badges: Upcoming (blue) / Done (green) / Missed (red).
 *    Tap any session card → SessionActionModal (Mark Done / Mark Missed / WhatsApp).
 *
 * ─── Data strategy ────────────────────────────────────────────────────────
 *    Parallel fetch: getAvailability(today) + getDashboard()
 *    Available slots = availability windows that do NOT overlap any booking.
 *    Falls back to generated hourly grid if no availability slots are set.
 *
 * ─── Color system ─────────────────────────────────────────────────────────
 *    Green  (#16A34A) = open / available / done
 *    Navy   (#183A4A) = booked / upcoming
 *    Red    (#DC2626) = missed / cancelled
 *    Navy   (#1B3A4B) = primary chrome
 */

import React, { useCallback, useEffect, useMemo, useState, memo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
    RefreshControl,
    Linking,
    Modal,
    SectionList,
    TextInput,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/theme';
import {
    getDashboard,
    getAvailability,
    completeBooking,
    cancelBooking,
    rescheduleBooking,
    blockAvailabilitySlot,
    unblockAvailabilitySlot,
    createAvailabilitySlot,
} from '../services/apiClient';
import { DashboardSummary, CoachAvailabilitySlot, DaySummary } from '../types';
import QuickBookModal from './QuickBookModal';
import MonthCalendar from '../components/MonthCalendar';

// ─── Design tokens ─────────────────────────────────────────────────────────────

const NAVY   = '#183A4A';  // Primary Navy — per spec
const GREEN  = '#16A34A';
const BLUE   = '#183A4A';  // booked / upcoming — navy, not indigo
const GRAY   = '#6B7280';

// ─── Types ────────────────────────────────────────────────────────────────────

type Booking       = DashboardSummary['today_bookings'][number];
type DisplayStatus = 'upcoming' | 'done' | 'missed';

/** A bookable open time window derived from the coach's availability - booked overlap. */
interface OpenSlot {
    kind:       'open';
    slot_id:    string;
    start_time: string; // HH:MM
    end_time:   string; // HH:MM
    /** Source: 'db' = from GET /api/coach/availability; 'generated' = fallback hourly grid */
    source:     'db' | 'generated';
}

/** An existing confirmed booking to display in section 2. */
interface BookedSession {
    kind: 'booked';
    booking: Booking;
}

/** A blocked time window created by the coach — not visible to clients. */
interface BlockedSlot {
    kind:           'blocked';
    slot_id:        string;
    start_time:     string; // HH:MM
    end_time:       string; // HH:MM
    blocked_reason?: string;
}

// ─── Slot generation ──────────────────────────────────────────────────────────

/** Default working window when no availability slots are configured in DB. */
const DEFAULT_START_HOUR = 7;   // 7:00 AM
const DEFAULT_END_HOUR   = 18;  // 6:00 PM
const SLOT_DURATION_MIN  = 60;  // 1 hour slots

/**
 * toMinutes — converts "HH:MM" to total minutes since midnight.
 * Pure, no side-effects.
 */
function toMinutes(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

/**
 * toHHMM — converts total minutes → "HH:MM" string.
 */
function toHHMM(mins: number): string {
    const h = Math.floor(mins / 60).toString().padStart(2, '0');
    const m = (mins % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
}

/**
 * to12h — converts a 24-hour "HH:MM" string to a 12-hour display object.
 *
 * Examples:
 *   "09:00" → { time: "9:00",  period: "AM" }
 *   "14:30" → { time: "2:30",  period: "PM" }
 *   "00:00" → { time: "12:00", period: "AM" }
 *   "12:00" → { time: "12:00", period: "PM" }
 */
function to12h(time24: string): { time: string; period: 'AM' | 'PM' } {
    const [h, m] = time24.split(':').map(Number);
    const period: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;          // 0 → 12, 13 → 1, 12 → 12
    return { time: `${h12}:${String(m).padStart(2, '0')}`, period };
}

/**
 * to24h — converts a 12-hour display string + period to "HH:MM" (24h).
 *
 * Examples:
 *   ("9:00",  "AM") → "09:00"
 *   ("10:00", "AM") → "10:00"
 *   ("2:30",  "PM") → "14:30"
 *   ("12:00", "AM") → "00:00"   ← midnight edge-case
 *   ("12:00", "PM") → "12:00"   ← noon edge-case
 */
function to24h(time12: string, period: 'AM' | 'PM'): string {
    const [hStr, mStr = '00'] = time12.trim().split(':');
    let h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (isNaN(h) || isNaN(m)) return '00:00';
    if (period === 'AM') {
        if (h === 12) h = 0;       // 12:xx AM  → 00:xx (midnight)
    } else {
        if (h !== 12) h += 12;    // 1:xx PM   → 13:xx  (but 12:xx PM stays 12)
    }
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * overlaps — true if [aStart, aEnd) overlaps [bStart, bEnd).
 * Uses half-open intervals so back-to-back sessions don't conflict.
 */
function overlaps(
    aStart: string, aEnd: string,
    bStart: string, bEnd: string,
): boolean {
    return aStart < bEnd && aEnd > bStart;
}

/**
 * slotsFromAvailability
 *
 * Strategy A (preferred): Coach has explicitly set availability windows via
 * POST /api/coach/availability. We expand each window into hourly sub-slots,
 * then filter out any slot that overlaps an existing booking.
 *
 * Strategy B (fallback): No availability windows exist in DB yet. We generate
 * hourly slots across DEFAULT_START_HOUR–DEFAULT_END_HOUR, then filter bookings
 * the same way. This ensures the screen is always useful even for new coaches.
 */
function slotsFromAvailability(
    dbSlots: CoachAvailabilitySlot[],
    todayISO: string,
    bookings: Booking[],
): OpenSlot[] {
    const activeBookings = bookings.filter(b => b.status === 'booked');

    // Determine windows to expand
    const todayDbSlots = dbSlots.filter(s => s.date === todayISO && !s.is_booked);

    const windows: Array<{ start: string; end: string; source: 'db' | 'generated' }> =
        todayDbSlots.length > 0
            ? todayDbSlots.map(s => ({ start: s.start_time, end: s.end_time, source: 'db' as const }))
            : [{ start: toHHMM(DEFAULT_START_HOUR * 60), end: toHHMM(DEFAULT_END_HOUR * 60), source: 'generated' as const }];

    const result: OpenSlot[] = [];
    // Guard against two DB windows that expand to the same start time
    // (e.g. 09:00-11:00 and 08:00-10:00 both produce an "open-09:00" slot).
    const seenStartTimes = new Set<string>();

    for (const win of windows) {
        let cursor = toMinutes(win.start);
        const winEnd = toMinutes(win.end);

        while (cursor + SLOT_DURATION_MIN <= winEnd) {
            const slotStart = toHHMM(cursor);
            const slotEnd   = toHHMM(cursor + SLOT_DURATION_MIN);

            // Skip if any active booking overlaps this slot
            const isBooked = activeBookings.some(b =>
                overlaps(slotStart, slotEnd, b.start_time, b.end_time)
            );

            // Skip if we already added a slot with this start time (prevents
            // duplicate slot_ids and the resulting SectionList key warning).
            if (!isBooked && !seenStartTimes.has(slotStart)) {
                seenStartTimes.add(slotStart);
                result.push({
                    kind:       'open',
                    slot_id:    `open-${slotStart}`,
                    start_time: slotStart,
                    end_time:   slotEnd,
                    source:     win.source,
                });
            }

            cursor += SLOT_DURATION_MIN;
        }
    }

    // Sort chronologically
    return result.sort((a, b) => a.start_time.localeCompare(b.start_time));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────


function fmt12h(time24: string): string {
    const [h, m] = time24.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12    = h % 12 || 12;
    return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
}

/** Monday-first week containing `iso`, as YYYY-MM-DD in Singapore time. */
function weekDates(iso: string): string[] {
    const noon = new Date(`${iso}T12:00:00+08:00`);
    const weekday = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        timeZone: 'Asia/Singapore',
    }).format(noon);
    const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
    const mondayOffset = index <= 0 ? -6 : 1 - index;
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(noon);
        d.setDate(d.getDate() + mondayOffset + i);
        return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    });
}

function todayISO(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

function toDisplay(status: Booking['status']): DisplayStatus {
    if (status === 'completed') return 'done';
    if (status === 'cancelled') return 'missed';
    return 'upcoming';
}

function initials(name: string): string {
    return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function firstName(name: string): string {
    return name.split(' ')[0] ?? name;
}

/** Short label for section headers, e.g. "Thu 8 May" */
function formatDayLabel(iso: string): string {
    return new Date(`${iso}T00:00:00+08:00`).toLocaleDateString('en-SG', {
        weekday: 'short', day: 'numeric', month: 'short',
        timeZone: 'Asia/Singapore',
    });
}

function buildWhatsApp(session: Booking, mode: 'remind' | 'followup'): string {
    const name = firstName(session.client_name);
    const time = fmt12h(session.start_time);
    if (mode === 'followup') {
        return `Hi ${name}, I noticed you missed your ${time} session today. Let me know if you'd like to reschedule 🙏`;
    }
    return `Hi ${name}, just a reminder for your ${time} session today 💪 See you soon!`;
}

function sendWhatsApp(session: Booking, mode: 'remind' | 'followup') {
    const msg     = buildWhatsApp(session, mode);
    const encoded = encodeURIComponent(msg);
    Linking.openURL(`whatsapp://send?text=${encoded}`).catch(() =>
        Linking.openURL(`https://wa.me/?text=${encoded}`)
    );
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────

const STATUS_CFG: Record<DisplayStatus, { label: string; bg: string; color: string }> = {
    upcoming: { label: 'Upcoming', bg: '#E7EEF2', color: BLUE  },
    done:     { label: 'Done',     bg: '#DCFCE7', color: GREEN },
    missed:   { label: 'Missed',   bg: '#F3F4F6', color: GRAY  },
};

function StatusBadge({ status }: { status: DisplayStatus }) {
    const cfg = STATUS_CFG[status];
    return (
        <View style={[bd.wrap, { backgroundColor: cfg.bg }]}>
            <Text style={[bd.text, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
    );
}

const bd = StyleSheet.create({
    wrap: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 50 },
    text: { fontSize: 10, fontWeight: '700', letterSpacing: 0.2 },
});

// ─── OpenSlotCard ─────────────────────────────────────────────────────────────
//
// Green card — represents one bookable open slot.
// Clear hierarchy: time left, "+ Book a client" right.
// Full card is tappable → opens QuickBookModal pre-filled.
//

const OpenSlotCard = memo(({ slot, onBook }: { slot: OpenSlot; onBook: () => void }) => (
    <TouchableOpacity
        style={os.card}
        onPress={onBook}
        activeOpacity={0.78}
        accessibilityRole="button"
        accessibilityLabel={`Open slot ${fmt12h(slot.start_time)} to ${fmt12h(slot.end_time)}. Tap to book.`}
    >
        {/* Green left strip */}
        <View style={os.strip} />

        <View style={os.body}>
            <View style={os.row}>
                {/* Time block */}
                <View style={os.timeBlock}>
                    <Text style={os.timeMain}>{fmt12h(slot.start_time)}</Text>
                    <Text style={os.timeEnd}>{fmt12h(slot.end_time)}</Text>
                </View>

                {/* Open label */}
                <View style={os.openPill}>
                    <Text style={os.openPillText}>Open</Text>
                </View>

                {/* Book CTA */}
                <TouchableOpacity
                    style={os.bookBtn}
                    onPress={onBook}
                    activeOpacity={0.82}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Book a client into this slot"
                >
                    <Ionicons name="add" size={14} color="#fff" />
                    <Text style={os.bookBtnTxt}>Book a client</Text>
                </TouchableOpacity>
            </View>

            {slot.source === 'generated' && (
                <Text style={os.hint}>Tap to book · Slot auto-generated (no availability set)</Text>
            )}
        </View>
    </TouchableOpacity>
));

const os = StyleSheet.create({
    card: {
        flexDirection:   'row',
        backgroundColor: '#F0FDF4',
        borderRadius:    14,
        borderWidth:     1,
        borderColor:     '#BBF7D0',
        marginBottom:    8,
        overflow:        'hidden',
    },
    strip: { width: 4, backgroundColor: GREEN },
    body:  { flex: 1, padding: 12 },
    row:   { flexDirection: 'row', alignItems: 'center', gap: 8 },

    timeBlock: { flex: 1 },
    timeMain:  { fontSize: 15, fontWeight: '700', color: '#14532D' },
    timeEnd:   { fontSize: 11, color: '#16A34A', marginTop: 1 },

    openPill: {
        backgroundColor: '#DCFCE7',
        borderRadius:     50,
        paddingHorizontal: 8,
        paddingVertical:   2,
    },
    openPillText: { fontSize: 10, fontWeight: '700', color: GREEN },

    bookBtn: {
        flexDirection:    'row',
        alignItems:       'center',
        gap:               4,
        backgroundColor:  GREEN,
        borderRadius:      10,
        paddingHorizontal: 12,
        paddingVertical:   6,
    },
    bookBtnTxt: { fontSize: 12, fontWeight: '700', color: '#fff' },

    hint: { fontSize: 10, color: '#16A34A', marginTop: 6, fontStyle: 'italic' },
});

// ─── SessionCard ──────────────────────────────────────────────────────────────
//
// Blue/Red card — one booked session in section 2.
// Tap → SessionActionModal.
// WhatsApp shortcut surfaced inline (no tap required to see available action).
//

const SessionCard = memo(({
    booking,
    onTap,
}: {
    booking: Booking;
    onTap:   (b: Booking) => void;
}) => {
    const display   = toDisplay(booking.status);
    const isMissed  = display === 'missed';
    const isDone    = display === 'done';
    const ini       = initials(booking.client_name);
    const msgMode   = isMissed ? 'followup' : 'remind';

    const leftStrip = isMissed ? GRAY : isDone ? GREEN : NAVY;
    const cardBg    = '#FFFFFF';
    const cardBorder= isMissed ? '#E5E7EB' :
                      isDone   ? '#BBF7D0' : '#E5E7EB';
    const avatarBg  = isMissed ? '#F3F4F6' :
                      isDone   ? '#DCFCE7' : '#E6F7F1';
    const avatarClr = isMissed ? GRAY : isDone ? GREEN : NAVY;

    return (
        <TouchableOpacity
            style={[sc.card, { backgroundColor: cardBg, borderColor: cardBorder }]}
            onPress={() => onTap(booking)}
            activeOpacity={0.80}
            accessibilityRole="button"
            accessibilityLabel={`${booking.client_name} session at ${booking.start_time}`}
        >
            {/* Colored left accent strip */}
            <View style={[sc.strip, { backgroundColor: leftStrip }]} />

            <View style={sc.body}>
                {/* Top row: avatar + name + time + badge */}
                <View style={sc.topRow}>
                    <View style={[sc.avatar, { backgroundColor: avatarBg }]}>
                        <Text style={[sc.avatarText, { color: avatarClr }]}>{ini}</Text>
                    </View>
                    <View style={sc.meta}>
                        <Text style={sc.clientName} numberOfLines={1}>{booking.client_name}</Text>
                        <Text style={sc.time}>
                            {fmt12h(booking.start_time)} – {fmt12h(booking.end_time)}
                        </Text>
                    </View>
                    <StatusBadge status={display} />
                </View>

                {/* Bottom row: WhatsApp shortcut + tap hint */}
                {!isDone && (
                    <View style={sc.bottomRow}>
                        <TouchableOpacity
                            style={[sc.waBtn, isMissed && sc.waBtnMissed]}
                            onPress={() => sendWhatsApp(booking, msgMode)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityRole="button"
                        >
                            <Ionicons name="logo-whatsapp" size={12} color="#15803D" />
                            <Text style={sc.waBtnTxt}>
                                {isMissed ? 'Follow Up on WhatsApp' : 'WhatsApp Client'}
                            </Text>
                        </TouchableOpacity>
                        <Text style={sc.tapHint}>Tap to update</Text>
                    </View>
                )}
            </View>
        </TouchableOpacity>
    );
});

const sc = StyleSheet.create({
    card: {
        flexDirection: 'row',
        borderRadius:  14,
        borderWidth:   1,
        marginBottom:  8,
        overflow:      'hidden',
        shadowColor:   '#000',
        shadowOpacity: 0.04,
        shadowRadius:  4,
        shadowOffset:  { width: 0, height: 1 },
        elevation:     1,
    },
    strip:      { width: 4 },
    body:       { flex: 1, padding: 12 },

    topRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
    avatar: {
        width: 34, height: 34, borderRadius: 17,
        alignItems: 'center', justifyContent: 'center',
    },
    avatarText: { fontSize: 12, fontWeight: '800' },
    meta:       { flex: 1 },
    clientName: { fontSize: 14, fontWeight: '700', color: '#111827' },
    time:       { fontSize: 12, color: GRAY, marginTop: 1 },

    bottomRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6',
    },
    waBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0',
        borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    },
    waBtnMissed: { backgroundColor: '#FEF9C3', borderColor: '#FDE047' },
    waBtnTxt:    { fontSize: 11, fontWeight: '700', color: '#15803D' },
    tapHint:     { fontSize: 10, color: '#D1D5DB', fontStyle: 'italic' },
});

// ─── BlockedSlotCard ──────────────────────────────────────────────────────────
//
// Gray card — shows a coach-blocked time window.
// Tap → Alert asking whether to unblock.
//

const BlockedSlotCard = memo(({ slot, onUnblock }: { slot: BlockedSlot; onUnblock: () => void }) => (
    <TouchableOpacity
        style={bs.card}
        onPress={onUnblock}
        activeOpacity={0.78}
        accessibilityRole="button"
        accessibilityLabel={`Blocked slot ${fmt12h(slot.start_time)} to ${fmt12h(slot.end_time)}. Tap to unblock.`}
    >
        <View style={bs.strip} />
        <View style={bs.body}>
            <View style={bs.row}>
                <View style={bs.timeBlock}>
                    <Text style={bs.timeMain}>{fmt12h(slot.start_time)}</Text>
                    <Text style={bs.timeEnd}>{fmt12h(slot.end_time)}</Text>
                </View>
                <View style={bs.pill}>
                    <Ionicons name="lock-closed" size={10} color={GRAY} />
                    <Text style={bs.pillText}>Unavailable</Text>
                </View>
                <TouchableOpacity
                    style={bs.unblockBtn}
                    onPress={onUnblock}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Unblock this slot"
                >
                    <Text style={bs.unblockBtnTxt}>Unblock</Text>
                </TouchableOpacity>
            </View>
            {!!slot.blocked_reason && (
                <Text style={bs.reason}>{slot.blocked_reason}</Text>
            )}
        </View>
    </TouchableOpacity>
));

const bs = StyleSheet.create({
    card: {
        flexDirection:   'row',
        backgroundColor: '#F9FAFB',
        borderRadius:    14,
        borderWidth:     1,
        borderColor:     '#E5E7EB',
        marginBottom:    8,
        overflow:        'hidden',
        opacity:         0.85,
    },
    strip: { width: 4, backgroundColor: NAVY },
    body:  { flex: 1, padding: 12 },
    row:   { flexDirection: 'row', alignItems: 'center', gap: 8 },

    timeBlock: { flex: 1 },
    timeMain:  { fontSize: 15, fontWeight: '700', color: GRAY },
    timeEnd:   { fontSize: 11, color: '#9CA3AF', marginTop: 1 },

    pill: {
        flexDirection:    'row',
        alignItems:       'center',
        gap:               4,
        backgroundColor:  '#F3F4F6',
        borderRadius:     50,
        paddingHorizontal: 8,
        paddingVertical:   2,
    },
    pillText: { fontSize: 10, fontWeight: '700', color: GRAY },

    unblockBtn: {
        backgroundColor:  '#F3F4F6',
        borderRadius:      10,
        paddingHorizontal: 12,
        paddingVertical:   6,
        borderWidth:       1,
        borderColor:       '#E5E7EB',
    },
    unblockBtnTxt: { fontSize: 12, fontWeight: '700', color: GRAY },

    reason: { fontSize: 10, color: '#9CA3AF', marginTop: 5, fontStyle: 'italic' },
});

// ─── ActionPickerModal ───────────────────────────────────────────────────────
//
// Small bottom sheet asking: "What would you like to do?"
// Options: Add open slot | Book a client | Cancel
//

interface ActionPickerProps {
    visible:        boolean;
    onClose:        () => void;
    onAddSlot:      () => void;
    onBookClient:   () => void;
}

function ActionPickerModal({ visible, onClose, onAddSlot, onBookClient }: ActionPickerProps) {
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <TouchableOpacity style={ap.overlay} activeOpacity={1} onPress={onClose} />
            <View style={ap.sheet}>
                <View style={ap.handle} />
                <Text style={ap.title}>What would you like to do?</Text>

                {/* Add open slot */}
                <TouchableOpacity
                    style={ap.option}
                    onPress={() => { onClose(); onAddSlot(); }}
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityLabel="Add open slot"
                >
                    <View style={[ap.iconWrap, { backgroundColor: '#F0FDF4' }]}>
                        <Ionicons name="calendar-outline" size={20} color={GREEN} />
                    </View>
                    <View style={ap.optionText}>
                        <Text style={ap.optionLabel}>Add open slot</Text>
                        <Text style={ap.optionSub}>Create an available time — no client required</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={GRAY} />
                </TouchableOpacity>

                <View style={ap.divider} />

                {/* Book a client */}
                <TouchableOpacity
                    style={ap.option}
                    onPress={() => { onClose(); onBookClient(); }}
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityLabel="Book a client"
                >
                    <View style={[ap.iconWrap, { backgroundColor: '#EEF2FF' }]}>
                        <Ionicons name="person-outline" size={20} color={BLUE} />
                    </View>
                    <View style={ap.optionText}>
                        <Text style={ap.optionLabel}>Book a client</Text>
                        <Text style={ap.optionSub}>Assign a specific client to a time slot</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={GRAY} />
                </TouchableOpacity>

                <TouchableOpacity style={ap.cancelBtn} onPress={onClose} activeOpacity={0.75}>
                    <Text style={ap.cancelTxt}>Cancel</Text>
                </TouchableOpacity>
            </View>
        </Modal>
    );
}

const ap = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36,
        shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8,
        shadowOffset: { width: 0, height: -2 }, elevation: 4,
    },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 16 },
    title:  { fontSize: 16, fontWeight: '800', color: NAVY, textAlign: 'center', marginBottom: 20 },

    option: {
        flexDirection: 'row', alignItems: 'center', gap: 14,
        paddingVertical: 14,
    },
    iconWrap: {
        width: 44, height: 44, borderRadius: 12,
        alignItems: 'center', justifyContent: 'center',
    },
    optionText: { flex: 1 },
    optionLabel: { fontSize: 15, fontWeight: '700', color: NAVY },
    optionSub:   { fontSize: 12, color: GRAY, marginTop: 1 },

    divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 2 },

    cancelBtn: {
        marginTop: 12, alignItems: 'center',
        paddingVertical: 12,
    },
    cancelTxt: { fontSize: 15, fontWeight: '600', color: GRAY },
});

// ─── AddAvailabilityModal ─────────────────────────────────────────────────────
//
// Bottom-sheet for creating an open availability slot (no client required).
// Uses existing POST /api/coach/availability via createAvailabilitySlot().
//

interface AddAvailabilityModalProps {
    visible:   boolean;
    date:      string;   // YYYY-MM-DD pre-filled from selectedDate
    onClose:   () => void;
    onCreated: () => void;
}

function AddAvailabilityModal({ visible, date, onClose, onCreated }: AddAvailabilityModalProps) {
    // 12-hour display state.
    // The coach sees "9:00 AM" — the API always receives "09:00" (24h).
    // Conversion happens only at submit time via to24h().
    const [startDisplay, setStartDisplay] = useState('9:00');
    const [startPeriod,  setStartPeriod]  = useState<'AM' | 'PM'>('AM');
    const [endDisplay,   setEndDisplay]   = useState('10:00');
    const [endPeriod,    setEndPeriod]    = useState<'AM' | 'PM'>('AM');
    const [notes,        setNotes]        = useState('');
    const [submitting,   setSubmitting]   = useState(false);

    // Reset to 9:00 AM → 10:00 AM on each open
    useEffect(() => {
        if (!visible) return;
        setStartDisplay('9:00');
        setStartPeriod('AM');
        setEndDisplay('10:00');
        setEndPeriod('AM');
        setNotes('');
    }, [visible]);

    const handleSubmit = async () => {
        // Validate display format — accepts "9:00", "11:30", "12:00", etc.
        if (!/^\d{1,2}:\d{2}$/.test(startDisplay.trim())) {
            Alert.alert('Invalid start time', 'Enter as H:MM — for example 9:00 or 11:30.');
            return;
        }
        if (!/^\d{1,2}:\d{2}$/.test(endDisplay.trim())) {
            Alert.alert('Invalid end time', 'Enter as H:MM — for example 10:00 or 2:30.');
            return;
        }

        // Convert to 24-hour for the API — backend never sees AM/PM
        const start24 = to24h(startDisplay.trim(), startPeriod);
        const end24   = to24h(endDisplay.trim(),   endPeriod);

        if (start24 >= end24) {
            Alert.alert(
                'Invalid time range',
                `End time must be after start time.\n(${startDisplay} ${startPeriod} → ${endDisplay} ${endPeriod})`,
            );
            return;
        }

        setSubmitting(true);
        try {
            // API payload is always 24-hour HH:MM — backend is unchanged
            await createAvailabilitySlot({ date, start_time: start24, end_time: end24 });
            onCreated();
            onClose();
        } catch (err: any) {
            Alert.alert('Could not create slot', err.message ?? 'Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <TouchableOpacity style={av.overlay} activeOpacity={1} onPress={onClose} />
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={av.sheet}
            >
                <View style={av.handle} />
                <View style={av.header}>
                    <Text style={av.title}>Add Availability</Text>
                    <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Ionicons name="close" size={22} color={GRAY} />
                    </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    {/* Date display */}
                    <View style={av.dateBadge}>
                        <Ionicons name="calendar" size={14} color={GREEN} />
                        <Text style={av.dateTxt}>
                            {new Date(`${date}T00:00:00+08:00`).toLocaleDateString('en-SG', {
                                weekday: 'long', day: 'numeric', month: 'long',
                                timeZone: 'Asia/Singapore',
                            })}
                        </Text>
                    </View>

                    {/* Time inputs — 12-hour format with AM/PM toggle */}
                    <View style={av.timeRow}>

                        {/* ── START ── */}
                        <View style={{ flex: 1 }}>
                            <Text style={av.label}>START</Text>
                            <View style={av.timeField}>
                                <TextInput
                                    style={av.timeInput}
                                    value={startDisplay}
                                    onChangeText={setStartDisplay}
                                    placeholder="9:00"
                                    placeholderTextColor="#9CA3AF"
                                    keyboardType="numbers-and-punctuation"
                                    maxLength={5}
                                    accessibilityLabel="Start time"
                                />
                                <View style={av.periodRow}>
                                    <TouchableOpacity
                                        style={[av.periodBtn, startPeriod === 'AM' && av.periodBtnActive]}
                                        onPress={() => setStartPeriod('AM')}
                                        activeOpacity={0.8}
                                        accessibilityRole="button"
                                        accessibilityLabel="AM"
                                    >
                                        <Text style={[av.periodTxt, startPeriod === 'AM' && av.periodTxtActive]}>AM</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[av.periodBtn, startPeriod === 'PM' && av.periodBtnActive]}
                                        onPress={() => setStartPeriod('PM')}
                                        activeOpacity={0.8}
                                        accessibilityRole="button"
                                        accessibilityLabel="PM"
                                    >
                                        <Text style={[av.periodTxt, startPeriod === 'PM' && av.periodTxtActive]}>PM</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>

                        <View style={av.timeSep}>
                            <Text style={av.timeSepTxt}>→</Text>
                        </View>

                        {/* ── END ── */}
                        <View style={{ flex: 1 }}>
                            <Text style={av.label}>END</Text>
                            <View style={av.timeField}>
                                <TextInput
                                    style={av.timeInput}
                                    value={endDisplay}
                                    onChangeText={setEndDisplay}
                                    placeholder="10:00"
                                    placeholderTextColor="#9CA3AF"
                                    keyboardType="numbers-and-punctuation"
                                    maxLength={5}
                                    accessibilityLabel="End time"
                                />
                                <View style={av.periodRow}>
                                    <TouchableOpacity
                                        style={[av.periodBtn, endPeriod === 'AM' && av.periodBtnActive]}
                                        onPress={() => setEndPeriod('AM')}
                                        activeOpacity={0.8}
                                        accessibilityRole="button"
                                        accessibilityLabel="AM"
                                    >
                                        <Text style={[av.periodTxt, endPeriod === 'AM' && av.periodTxtActive]}>AM</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[av.periodBtn, endPeriod === 'PM' && av.periodBtnActive]}
                                        onPress={() => setEndPeriod('PM')}
                                        activeOpacity={0.8}
                                        accessibilityRole="button"
                                        accessibilityLabel="PM"
                                    >
                                        <Text style={[av.periodTxt, endPeriod === 'PM' && av.periodTxtActive]}>PM</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>

                    </View>

                    {/* Optional notes */}
                    <Text style={av.label}>NOTES (optional)</Text>
                    <TextInput
                        style={[av.input, av.inputMulti]}
                        value={notes}
                        onChangeText={setNotes}
                        placeholder="e.g. strength focus, outdoor session…"
                        placeholderTextColor="#9CA3AF"
                        multiline
                        numberOfLines={2}
                    />

                    <View style={av.infoBox}>
                        <Ionicons name="information-circle-outline" size={14} color={GREEN} />
                        <Text style={av.infoTxt}>
                            Clients will see this as an available slot and can book it themselves.
                        </Text>
                    </View>

                    {/* CTA */}
                    <TouchableOpacity
                        style={[av.createBtn, submitting && { opacity: 0.5 }]}
                        onPress={handleSubmit}
                        disabled={submitting}
                        activeOpacity={0.85}
                    >
                        {submitting
                            ? <ActivityIndicator color="#fff" />
                            : <>
                                <Ionicons name="add-circle-outline" size={18} color="#fff" />
                                <Text style={av.createBtnTxt}>Create Open Slot</Text>
                              </>
                        }
                    </TouchableOpacity>
                </ScrollView>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const av = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40,
        maxHeight: '80%',
        shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8,
        shadowOffset: { width: 0, height: -2 }, elevation: 4,
    },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 12 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    title:  { fontSize: 18, fontWeight: '800', color: NAVY },

    dateBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: '#F0FDF4', borderRadius: 10, borderWidth: 1, borderColor: '#BBF7D0',
        paddingHorizontal: 12, paddingVertical: 8, marginBottom: 4,
    },
    dateTxt: { fontSize: 13, fontWeight: '600', color: '#15803D' },

    label: { fontSize: 10, fontWeight: '700', color: GRAY, letterSpacing: 1, marginTop: 14, marginBottom: 6 },
    input: {
        backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB',
        borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
        fontSize: 15, fontWeight: '600', color: NAVY,
    },
    inputMulti: { minHeight: 60, textAlignVertical: 'top', paddingTop: 10 },

    timeRow:    { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    timeSep:    { paddingBottom: 12, alignSelf: 'flex-end' },
    timeSepTxt: { fontSize: 16, color: GRAY },

    infoBox: {
        flexDirection: 'row', alignItems: 'flex-start', gap: 8,
        backgroundColor: '#F0FDF4', borderRadius: 10, borderWidth: 1, borderColor: '#BBF7D0',
        padding: 12, marginTop: 16,
    },
    infoTxt: { flex: 1, fontSize: 12, color: '#15803D', lineHeight: 17 },

    createBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 8, backgroundColor: GREEN, borderRadius: 14,
        paddingVertical: 14, marginTop: 20,
    },
    createBtnTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },

    // ── AM/PM time field ──────────────────────────────────────────────────────
    //
    // timeField:  outer container — row, rounded border, clipping border radius
    // timeInput:  left side — the H:MM text input
    // periodRow:  right side — vertical stack of AM and PM buttons
    // periodBtn:  individual pill button (AM or PM), inactive state
    // periodBtnActive: active (selected) state — green background
    // periodTxt:  label text inside each button
    // periodTxtActive: white text when the button is active
    //
    timeField: {
        flexDirection:  'row',
        alignItems:     'stretch',
        borderWidth:    1,
        borderColor:    '#E5E7EB',
        borderRadius:   12,
        backgroundColor: '#F9FAFB',
        overflow:       'hidden',
    },
    timeInput: {
        flex:              1,
        paddingHorizontal: 12,
        paddingVertical:   11,
        fontSize:          15,
        fontWeight:        '600',
        color:             NAVY,
    },
    periodRow: {
        flexDirection:  'column',
        borderLeftWidth: 1,
        borderLeftColor: '#E5E7EB',
    },
    periodBtn: {
        flex:              1,
        alignItems:        'center',
        justifyContent:    'center',
        paddingHorizontal: 10,
        backgroundColor:   '#F3F4F6',
    },
    periodBtnActive: {
        backgroundColor: GREEN,
    },
    periodTxt: {
        fontSize:   10,
        fontWeight: '800',
        color:      GRAY,
        letterSpacing: 0.5,
    },
    periodTxtActive: {
        color: '#FFFFFF',
    },
});

// ─── BlockTimeModal ───────────────────────────────────────────────────────────
//
// Bottom-sheet modal for the coach to block a time window on the selected date.
// Keeps UX consistent with QuickBookModal.
//

const BLOCK_REASONS = [
    'Personal appointment',
    'Lunch break',
    'Off day',
    'Fully booked externally',
    'Other',
];

interface BlockTimeModalProps {
    visible:      boolean;
    date:         string;   // YYYY-MM-DD pre-filled from selectedDate
    onClose:      () => void;
    onBlocked:    () => void;
}

function BlockTimeModal({ visible, date, onClose, onBlocked }: BlockTimeModalProps) {
    const [startTime, setStartTime] = useState('10:00');
    const [endTime,   setEndTime]   = useState('11:00');
    const [reason,    setReason]    = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Reset on each open
    useEffect(() => {
        if (!visible) return;
        setStartTime('10:00');
        setEndTime('11:00');
        setReason('');
    }, [visible]);

    const handleSubmit = async () => {
        if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
            Alert.alert('Invalid time', 'Use format HH:MM (e.g. 10:00).');
            return;
        }
        if (startTime >= endTime) {
            Alert.alert('Invalid time', 'End time must be after start time.');
            return;
        }
        setSubmitting(true);
        try {
            await blockAvailabilitySlot({
                date,
                start_time: startTime,
                end_time:   endTime,
                reason:     reason.trim() || undefined,
            });
            onBlocked();
            onClose();
        } catch (err: any) {
            Alert.alert('Block failed', err.message ?? 'Could not block this slot.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <TouchableOpacity style={btm.overlay} activeOpacity={1} onPress={onClose} />
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={btm.sheet}
            >
                <View style={btm.handle} />
                <View style={btm.header}>
                    <Text style={btm.title}>Block Time</Text>
                    <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Ionicons name="close" size={22} color={GRAY} />
                    </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    {/* Date display */}
                    <Text style={btm.dateLine}>
                        {new Date(`${date}T00:00:00+08:00`).toLocaleDateString('en-SG', {
                            weekday: 'long', day: 'numeric', month: 'long',
                            timeZone: 'Asia/Singapore',
                        })}
                    </Text>

                    {/* Time inputs */}
                    <View style={btm.timeRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={btm.label}>START</Text>
                            <TextInput
                                style={btm.input}
                                value={startTime}
                                onChangeText={setStartTime}
                                placeholder="10:00"
                                placeholderTextColor="#9CA3AF"
                                keyboardType="numbers-and-punctuation"
                                maxLength={5}
                            />
                        </View>
                        <View style={btm.timeSep}>
                            <Text style={btm.timeSepTxt}>→</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={btm.label}>END</Text>
                            <TextInput
                                style={btm.input}
                                value={endTime}
                                onChangeText={setEndTime}
                                placeholder="11:00"
                                placeholderTextColor="#9CA3AF"
                                keyboardType="numbers-and-punctuation"
                                maxLength={5}
                            />
                        </View>
                    </View>

                    {/* Reason picker */}
                    <Text style={btm.label}>REASON (private, optional)</Text>
                    <View style={btm.reasonGrid}>
                        {BLOCK_REASONS.map(r => (
                            <TouchableOpacity
                                key={r}
                                style={[btm.reasonChip, reason === r && btm.reasonChipActive]}
                                onPress={() => setReason(prev => prev === r ? '' : r)}
                                activeOpacity={0.7}
                            >
                                <Text style={[btm.reasonChipTxt, reason === r && btm.reasonChipTxtActive]}>{r}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* CTA */}
                    <TouchableOpacity
                        style={[btm.blockBtn, submitting && { opacity: 0.5 }]}
                        onPress={handleSubmit}
                        disabled={submitting}
                        activeOpacity={0.85}
                    >
                        {submitting
                            ? <ActivityIndicator color="#fff" />
                            : <>
                                <Ionicons name="lock-closed" size={16} color="#fff" />
                                <Text style={btm.blockBtnLabel}>Block This Time</Text>
                              </>
                        }
                    </TouchableOpacity>
                </ScrollView>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const btm = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius:  24,
        borderTopRightRadius: 24,
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 40,
        maxHeight: '75%',
        shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8,
        shadowOffset: { width: 0, height: -2 }, elevation: 4,
    },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 12 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    title:  { fontSize: 18, fontWeight: '800', color: NAVY },
    dateLine: { fontSize: 13, color: GRAY, marginBottom: 16 },

    label: { fontSize: 10, fontWeight: '700', color: GRAY, letterSpacing: 1, marginTop: 14, marginBottom: 6 },
    input: {
        backgroundColor: '#F9FAFB',
        borderWidth:     1,
        borderColor:     '#E5E7EB',
        borderRadius:    12,
        paddingHorizontal: 14,
        paddingVertical:   11,
        fontSize: 15,
        fontWeight: '600',
        color: NAVY,
    },
    timeRow:   { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    timeSep:   { paddingBottom: 12, alignSelf: 'flex-end' },
    timeSepTxt: { fontSize: 16, color: GRAY },

    reasonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
    reasonChip: {
        borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 20,
        paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#F9FAFB',
    },
    reasonChipActive:   { backgroundColor: NAVY, borderColor: NAVY },
    reasonChipTxt:      { fontSize: 12, fontWeight: '500', color: GRAY },
    reasonChipTxtActive: { color: '#fff' },

    blockBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 8, backgroundColor: GRAY, borderRadius: 14,
        paddingVertical: 14, marginTop: 20,
    },
    blockBtnLabel: { fontSize: 15, fontWeight: '700', color: '#fff' },
});

// ─── SectionHeader ────────────────────────────────────────────────────────────

function SectionHeader({
    title, count, color, icon,
}: {
    title: string;
    count: number;
    color: string;
    icon:  string;
}) {
    return (
        <View style={hd.row}>
            <View style={[hd.stripe, { backgroundColor: color }]} />
            <Ionicons name={icon as any} size={15} color={color} />
            <Text style={hd.title}>{title.toUpperCase()}</Text>
            <View style={[hd.pill, { backgroundColor: color + '22' }]}>
                <Text style={[hd.count, { color }]}>{count}</Text>
            </View>
        </View>
    );
}

const hd = StyleSheet.create({
    row: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 16, paddingTop: 20, paddingBottom: 10,
        backgroundColor: '#F9FAFB',
    },
    stripe: { width: 3, height: 18, borderRadius: 2 },
    title:  { flex: 1, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: GRAY },
    pill: {
        minWidth: 22, height: 22, borderRadius: 50,
        alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
    },
    count: { fontSize: 11, fontWeight: '800' },
});

// ─── EmptySection ─────────────────────────────────────────────────────────────

function EmptySection({
    message, actionLabel, onAction, color,
}: {
    message:     string;
    actionLabel?: string;
    onAction?:   () => void;
    color:        string;
}) {
    return (
        <View style={[em.card, { borderColor: color + '44' }]}>
            <Text style={[em.msg, { color }]}>{message}</Text>
            {actionLabel && onAction && (
                <TouchableOpacity style={[em.btn, { backgroundColor: color }]} onPress={onAction}>
                    <Text style={em.btnTxt}>{actionLabel}</Text>
                </TouchableOpacity>
            )}
        </View>
    );
}

const em = StyleSheet.create({
    card: {
        marginHorizontal: 16, marginVertical: 4,
        borderRadius: 12, borderWidth: 1,
        paddingVertical: 16, paddingHorizontal: 16,
        alignItems: 'center', gap: 10,
        backgroundColor: '#FAFAFA',
    },
    msg:    { fontSize: 13, fontWeight: '500', textAlign: 'center' },
    btn:    { borderRadius: 10, paddingHorizontal: 20, paddingVertical: 8 },
    btnTxt: { fontSize: 13, fontWeight: '700', color: '#fff' },
});

// ─── Session Action Modal ─────────────────────────────────────────────────────

interface ActionModalProps {
    session:    Booking | null;
    onClose:    () => void;
    onComplete: (id: string) => Promise<void>;
    onMiss:     (id: string) => Promise<void>;
}

function SessionActionModal({ session, onClose, onComplete, onMiss }: ActionModalProps) {
    const [busy, setBusy] = useState<'done' | 'missed' | null>(null);

    if (!session) return null;

    const display = toDisplay(session.status);
    const canAct  = display === 'upcoming';

    const handle = async (type: 'done' | 'missed') => {
        setBusy(type);
        try {
            if (type === 'done')   await onComplete(session.booking_id);
            if (type === 'missed') await onMiss(session.booking_id);
            onClose();
        } finally {
            setBusy(null);
        }
    };

    return (
        <Modal
            visible
            animationType="slide"
            transparent
            onRequestClose={onClose}
            statusBarTranslucent
        >
            <TouchableOpacity style={am.scrim} activeOpacity={1} onPress={onClose} />
            <View style={am.sheet}>
                <View style={am.handle} />

                <Text style={am.clientName}>{session.client_name}</Text>
                <Text style={am.sessionTime}>
                    {fmt12h(session.start_time)} – {fmt12h(session.end_time)}
                </Text>
                <StatusBadge status={display} />

                <View style={am.divider} />

                {canAct && (
                    <>
                        <TouchableOpacity
                            style={[am.btn, am.btnDone]}
                            onPress={() => handle('done')}
                            disabled={!!busy}
                            activeOpacity={0.82}
                        >
                            {busy === 'done'
                                ? <ActivityIndicator color="#fff" size="small" />
                                : <>
                                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                                    <Text style={am.txtDone}>Mark Done</Text>
                                  </>
                            }
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[am.btn, am.btnMissed]}
                            onPress={() => handle('missed')}
                            disabled={!!busy}
                            activeOpacity={0.82}
                        >
                            {busy === 'missed'
                                ? <ActivityIndicator color={GRAY} size="small" />
                                : <>
                                    <Ionicons name="close" size={18} color={NAVY} />
                                    <Text style={am.txtMissed}>Mark Missed</Text>
                                  </>
                            }
                        </TouchableOpacity>
                    </>
                )}

                <TouchableOpacity
                    style={[am.btn, am.btnWA]}
                    onPress={() => sendWhatsApp(session, display === 'missed' ? 'followup' : 'remind')}
                    activeOpacity={0.82}
                >
                    <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
                    <Text style={am.txtWA}>
                        {display === 'missed' ? 'Follow Up on WhatsApp' : 'WhatsApp Client'}
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity style={am.closeBtn} onPress={onClose}>
                    <Text style={am.closeTxt}>Close</Text>
                </TouchableOpacity>
            </View>
        </Modal>
    );
}

const am = StyleSheet.create({
    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: {
        position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        paddingHorizontal: 24, paddingTop: 12, paddingBottom: 44,
        alignItems: 'center', gap: 10,
    },
    handle:      { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', marginBottom: 8 },
    clientName:  { fontSize: 20, fontWeight: '800', color: NAVY, textAlign: 'center' },
    sessionTime: { fontSize: 13, color: GRAY, marginBottom: 4 },
    divider:     { width: '100%', height: 1, backgroundColor: '#F3F4F6', marginVertical: 4 },
    btn: {
        width: '100%', flexDirection: 'row', alignItems: 'center',
        justifyContent: 'center', gap: 8, height: 48, borderRadius: 14,
    },
    btnDone:   { backgroundColor: GREEN },
    txtDone:   { fontSize: 15, fontWeight: '700', color: '#fff' },
    btnMissed: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB' },
    txtMissed: { fontSize: 15, fontWeight: '700', color: NAVY },
    btnWA:     { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB' },
    txtWA:     { fontSize: 15, fontWeight: '700', color: NAVY },
    closeBtn:  { paddingVertical: 8, marginTop: 2 },
    closeTxt:  { fontSize: 14, color: GRAY, fontWeight: '600' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function BookingScreen() {
    const insets = useSafeAreaInsets();

    // ── State ─────────────────────────────────────────────────────────────────
    const [loading,          setLoading]          = useState(true);
    const [refreshing,       setRefreshing]       = useState(false);
    const [error,            setError]            = useState<string | null>(null);
    const [dbAvailability,   setDbAvailability]   = useState<CoachAvailabilitySlot[]>([]);
    const [bookings,         setBookings]         = useState<Booking[]>([]);
    const [activeSession,      setActiveSession]      = useState<Booking | null>(null);
    const [showQuickBook,      setShowQuickBook]      = useState(false);
    const [selectedSlotTime,   setSelectedSlotTime]   = useState<string | undefined>(undefined);
    /** Action picker: shown when coach taps + FAB. Lets coach choose Add Slot vs Book Client. */
    const [showActionPicker,   setShowActionPicker]   = useState(false);
    /** Add Availability modal: create an open slot with no client required. */
    const [showAddAvailability, setShowAddAvailability] = useState(false);
    /** Calendar visible/hidden — collapsed by default so slot list gets full space. */
    const [calendarExpanded,   setCalendarExpanded]   = useState(false);

    const today = useMemo(() => todayISO(), []);

    /** The date currently shown in the screen — drives all data fetches. */
    const [selectedDate, setSelectedDate] = useState<string>(today);

    // ── Data fetch ────────────────────────────────────────────────────────────

    const fetchData = useCallback(async (quiet = false) => {
        if (!quiet) setLoading(true);
        setError(null);

        try {
            // Parallel: availability windows + bookings for the selected date
            const [availResp, dashResp] = await Promise.all([
                getAvailability(selectedDate),
                getDashboard(selectedDate),
            ]);

            console.log('[BookingScreen] availability slots:', availResp.slots?.length ?? 0);
            console.log('[BookingScreen] bookings for', selectedDate, ':', dashResp.today_bookings?.length ?? 0);

            setDbAvailability(availResp.slots ?? []);
            setBookings(dashResp.today_bookings ?? []);
        } catch (err: any) {
            console.error('[BookingScreen] fetch error:', err.message);
            setError(err.message ?? 'Failed to load schedule.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [selectedDate]);

    // Re-fetch whenever selectedDate changes
    useEffect(() => {
        setLoading(true);
        fetchData();
    }, [selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

    // Also re-fetch when the tab comes back into focus (e.g. after a booking)
    useFocusEffect(useCallback(() => {
        fetchData();
    }, [fetchData]));

    // ── Derived data ──────────────────────────────────────────────────────────

    /**
     * openSlots — true bookable windows after removing booking overlaps.
     * Uses selectedDate (not today) so it works for any chosen date.
     */
    const openSlots = useMemo(
        () => slotsFromAvailability(
            dbAvailability.filter(s => (s.status ?? 'available') !== 'blocked'),
            selectedDate,
            bookings,
        ),
        [dbAvailability, selectedDate, bookings],
    );

    /**
     * blockedSlots — slots the coach has explicitly blocked for selectedDate.
     * Only shown on the coach screen — never sent to clients.
     */
    const blockedSlots: BlockedSlot[] = useMemo(
        () => dbAvailability
            .filter(s => s.status === 'blocked' && s.date === selectedDate)
            .sort((a, b) => a.start_time.localeCompare(b.start_time))
            .map(s => ({
                kind:           'blocked' as const,
                slot_id:        s._id ?? s.start_time,
                start_time:     s.start_time,
                end_time:       s.end_time,
                blocked_reason: s.blocked_reason,
            })),
        [dbAvailability, selectedDate],
    );

    /**
     * sortedBookings — selected date's bookings sorted by start time.
     * Split: upcoming first, then done/missed.
     */
    const sortedBookings = useMemo(() => {
        const upcoming = bookings.filter(b => b.status === 'booked')
            .sort((a, b) => a.start_time.localeCompare(b.start_time));
        const past = bookings.filter(b => b.status !== 'booked')
            .sort((a, b) => a.start_time.localeCompare(b.start_time));
        return [...upcoming, ...past];
    }, [bookings]);

    // Summary counts for chrome pills
    const countOpen    = openSlots.length;
    const countBooked  = bookings.filter(b => b.status === 'booked').length;
    const countDone    = bookings.filter(b => b.status === 'completed').length;
    const countMissed  = bookings.filter(b => b.status === 'cancelled').length;
    const countBlocked = blockedSlots.length;

    // ── Month-level summary for MonthCalendar dot indicators ────────────────
    //
    // monthStart changes whenever the coach navigates to a different month.
    // We fetch the whole month's availability once and build a lightweight
    // DaySummary map. This is read-only and never touches loading/error state.
    //
    const [monthSummaries, setMonthSummaries] = useState<Record<string, DaySummary>>({});

    const monthStart = useMemo(
        () => selectedDate.slice(0, 7) + '-01',
        [selectedDate],
    );

    useEffect(() => {
        let cancelled = false;
        getAvailability(monthStart).then(resp => {
            if (cancelled) return;
            const map: Record<string, DaySummary> = {};
            for (const slot of resp.slots ?? []) {
                if (!map[slot.date]) map[slot.date] = { date: slot.date };
                if (slot.status === 'blocked') {
                    // Gray dot: blocked time
                    map[slot.date].missedCount = (map[slot.date].missedCount ?? 0) + 1;
                } else if (!slot.is_booked) {
                    map[slot.date].openCount = (map[slot.date].openCount ?? 0) + 1;
                } else {
                    map[slot.date].bookedCount = (map[slot.date].bookedCount ?? 0) + 1;
                }
            }
            setMonthSummaries(map);
        }).catch(() => { /* silent — dots are best-effort */ });
        return () => { cancelled = true; };
    }, [monthStart]); // re-fetches when the coach navigates to a different month

    // Block time modal state
    const [showBlockModal, setShowBlockModal] = useState(false);

    const handleUnblock = useCallback((slotId: string) => {
        Alert.alert(
            'Unblock this slot?',
            'This will make the time available for booking again.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Unblock',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await unblockAvailabilitySlot(slotId);
                            fetchData(true);
                        } catch (err: any) {
                            Alert.alert('Error', err.message ?? 'Could not unblock.');
                        }
                    },
                },
            ],
        );
    }, [fetchData]);

    // Dynamic title — changes when a non-today date is selected
    const isToday   = selectedDate === today;

    // ── Session actions ───────────────────────────────────────────────────────

    const handleComplete = useCallback(async (id: string) => {
        try {
            const result = await completeBooking(id);
            Alert.alert(
                'Session Done ✓',
                `${result.sessions_remaining} session${result.sessions_remaining === 1 ? '' : 's'} remaining.`,
            );
            fetchData(true);
        } catch (err: any) {
            Alert.alert('Error', err.message ?? 'Could not mark done.');
        }
    }, [fetchData]);

    const handleMiss = useCallback(async (id: string) => {
        try {
            await cancelBooking(id);
            fetchData(true);
        } catch (err: any) {
            Alert.alert('Error', err.message ?? 'Could not mark missed.');
        }
    }, [fetchData]);

    // ── Open QuickBookModal ───────────────────────────────────────────────────

    const openQuickBook = useCallback((slotTime?: string) => {
        setSelectedSlotTime(slotTime);
        setShowQuickBook(true);
    }, []);

    // ── Loading state ─────────────────────────────────────────────────────────

    if (loading) {
        return (
            <View style={s.centred}>
                <ActivityIndicator color={NAVY} size="large" />
                <Text style={s.loadingTxt}>Loading schedule…</Text>
            </View>
        );
    }

    // ── Error state ───────────────────────────────────────────────────────────

    if (error) {
        return (
            <View style={s.centred}>
                <Ionicons name="cloud-offline-outline" size={44} color="#D1D5DB" />
                <Text style={s.errorTxt}>{error}</Text>
                <TouchableOpacity style={s.retryBtn} onPress={() => fetchData()}>
                    <Text style={s.retryTxt}>Try Again</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // ── SectionList data ──────────────────────────────────────────────────────

    type SectionItem = OpenSlot | Booking | BlockedSlot;

    const sections: Array<{
        key:    string;
        title:  string;
        count:  number;
        color:  string;
        icon:   string;
        data:   SectionItem[];
    }> = [
        {
            key:   'open',
            title: 'Open Slots — Tap to Book',
            count: countOpen,
            color: GREEN,
            icon:  'calendar-outline',
            data:  openSlots,
        },
        {
            key:   'booked',
            title: isToday ? "Today's Sessions" : `Sessions — ${formatDayLabel(selectedDate)}`,
            count: sortedBookings.length,
            color: BLUE,
            icon:  'people-outline',
            data:  sortedBookings,
        },
        {
            key:   'blocked',
            title: 'Blocked Time',
            count: countBlocked,
            color: GRAY,
            icon:  'lock-closed-outline',
            data:  blockedSlots,
        },
    ];

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <View style={s.root}>

            {/* ── TOP CHROME ────────────────────────────────────────────── */}
            <View style={[s.scheduleHero, { paddingTop: insets.top + 12 }]}>
                <View style={s.titleRow}>
                    <Text style={s.screenTitleLight}>Schedule</Text>
                    <View style={s.fabRow}>
                        {/* Block time button */}
                        <TouchableOpacity
                            style={s.fabGray}
                            onPress={() => setShowBlockModal(true)}
                            activeOpacity={0.85}
                            accessibilityRole="button"
                            accessibilityLabel="Block a time slot"
                        >
                            <Ionicons name="lock-closed" size={16} color={GRAY} />
                        </TouchableOpacity>
                        {/* + FAB — opens action picker */}
                        <TouchableOpacity
                            style={s.fab}
                            onPress={() => setShowActionPicker(true)}
                            activeOpacity={0.85}
                            accessibilityRole="button"
                            accessibilityLabel="Add slot or book a client"
                        >
                            <Ionicons name="add" size={22} color={NAVY} />
                        </TouchableOpacity>
                    </View>
                </View>
                <TouchableOpacity
                    style={s.monthChip}
                    onPress={() => setCalendarExpanded(v => !v)}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel={calendarExpanded ? 'Collapse calendar' : 'View month calendar'}
                >
                    <Ionicons name="calendar-outline" size={15} color="#FFFFFF" />
                    <Text style={s.monthChipText}>
                        {new Date(`${selectedDate}T12:00:00+08:00`).toLocaleDateString('en-SG', {
                            month: 'long', year: 'numeric',
                            timeZone: 'Asia/Singapore',
                        })}
                    </Text>
                    <Ionicons
                        name={calendarExpanded ? 'chevron-up' : 'chevron-down'}
                        size={14}
                        color="#FFFFFF"
                    />
                </TouchableOpacity>
            </View>

            <View style={s.chrome}>
                <View style={s.weekRow}>
                    {weekDates(selectedDate).map(iso => {
                        const selected = iso === selectedDate;
                        const summary = monthSummaries[iso];
                        const label = new Date(`${iso}T12:00:00+08:00`).toLocaleDateString('en-SG', {
                            weekday: 'short',
                            timeZone: 'Asia/Singapore',
                        });
                        const num = new Date(`${iso}T12:00:00+08:00`).toLocaleDateString('en-SG', {
                            day: 'numeric',
                            timeZone: 'Asia/Singapore',
                        });
                        return (
                            <TouchableOpacity
                                key={iso}
                                style={s.weekCell}
                                onPress={() => setSelectedDate(iso)}
                                accessibilityRole="button"
                                accessibilityLabel={iso}
                            >
                                <Text style={s.weekDow}>{label}</Text>
                                <View style={[s.weekNum, selected && s.weekNumOn]}>
                                    <Text style={[s.weekNumTxt, selected && s.weekNumTxtOn]}>{num}</Text>
                                </View>
                                <View style={s.weekDots}>
                                    {summary?.openCount ? <View style={[s.weekDot, { backgroundColor: GREEN }]} /> : null}
                                    {summary?.bookedCount ? <View style={[s.weekDot, { backgroundColor: NAVY }]} /> : null}
                                </View>
                            </TouchableOpacity>
                        );
                    })}
                </View>

                {/* ── Month calendar — only visible when expanded ──────────── */}
                {calendarExpanded && (
                    <MonthCalendar
                        selectedDate={selectedDate}
                        onSelectDate={(date) => {
                            setSelectedDate(date);
                            setCalendarExpanded(false); // collapse after picking a date
                        }}
                        summaries={monthSummaries}
                    />
                )}

                {/* Summary pills */}
                <View style={s.pillRow}>
                    <View style={[s.pill, s.pillGreen]}>
                        <Text style={[s.pillNum, { color: GREEN }]}>{countOpen}</Text>
                        <Text style={[s.pillLbl, { color: GREEN }]}>Open</Text>
                    </View>
                    <View style={[s.pill, countBooked > 0 ? s.pillBlue : s.pillMuted]}>
                        <Text style={[s.pillNum, { color: countBooked > 0 ? BLUE : GRAY }]}>{countBooked}</Text>
                        <Text style={[s.pillLbl, { color: countBooked > 0 ? BLUE : GRAY }]}>Booked</Text>
                    </View>
                    <View style={[s.pill, countDone > 0 ? s.pillGreen : s.pillMuted]}>
                        <Text style={[s.pillNum, { color: countDone > 0 ? GREEN : GRAY }]}>{countDone}</Text>
                        <Text style={[s.pillLbl, { color: countDone > 0 ? GREEN : GRAY }]}>Done</Text>
                    </View>
                    <View style={[s.pill, s.pillMuted]}>
                        <Text style={[s.pillNum, { color: GRAY }]}>{countMissed}</Text>
                        <Text style={[s.pillLbl, { color: GRAY }]}>Missed</Text>
                    </View>
                </View>
            </View>

            {/* ── BODY: Two-section list ─────────────────────────────────── */}
            <SectionList
                style={s.list}
                contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + 120 }]}
                sections={sections}
                keyExtractor={(item, index) => {
                    // Use the SectionItem union (OpenSlot | Booking | BlockedSlot)
                    // and probe for properties safely via 'in' checks.
                    const i = item as SectionItem;

                    // Preferred order: use the most stable unique ID available,
                    // then fall back to a composite of type + date + times + index.
                    // The section key prefix (open|booked|blocked) prevents cross-
                    // section collisions when two sections share similar time strings.
                    const base =
                        ('id'              in i ? (i as any).id              : undefined) ??
                        ('_id'             in i ? (i as any)._id             : undefined) ??
                        ('availability_id' in i ? (i as any).availability_id : undefined) ??
                        ('booking_id'      in i ? (i as any).booking_id      : undefined) ??
                        ('slot_id'         in i ? (i as any).slot_id         : undefined);

                    if (base) {
                        // Prefix with index so duplicate slot_ids (two DB windows
                        // that both expand to the same start time) never collide.
                        return `${base}-${index}`;
                    }

                    // Ultimate fallback: stable composite key
                    const type   = ('kind'       in i ? i.kind       : undefined) ??
                                   ('status'     in i ? (i as any).status : undefined) ?? 'item';
                    const date   = ('date'       in i ? (i as any).date       : '');
                    const start  = ('start_time' in i ? (i as any).start_time : '');
                    const end    = ('end_time'   in i ? (i as any).end_time   : '');
                    return `${type}-${date}-${start}-${end}-${index}`;
                }}
                stickySectionHeadersEnabled
                renderSectionHeader={({ section }) => (
                    <SectionHeader
                        title={section.title}
                        count={section.count}
                        color={section.color}
                        icon={section.icon}
                    />
                )}
                renderItem={({ item, section }) => {
                    if (section.key === 'open') {
                        const slot = item as OpenSlot;
                        return (
                            <View style={s.itemWrap}>
                                <OpenSlotCard
                                    slot={slot}
                                    onBook={() => openQuickBook(slot.start_time)}
                                />
                            </View>
                        );
                    }
                    if (section.key === 'blocked') {
                        const bl = item as BlockedSlot;
                        return (
                            <View style={s.itemWrap}>
                                <BlockedSlotCard
                                    slot={bl}
                                    onUnblock={() => handleUnblock(bl.slot_id)}
                                />
                            </View>
                        );
                    }
                    const booking = item as Booking;
                    return (
                        <View style={s.itemWrap}>
                            <SessionCard
                                booking={booking}
                                onTap={setActiveSession}
                            />
                        </View>
                    );
                }}
                renderSectionFooter={({ section }) => {
                    if (section.data.length > 0) return null;
                    if (section.key === 'open') {
                        return (
                            <EmptySection
                                color={GREEN}
                                message="No open slots — all your availability is booked today 🎉"
                            />
                        );
                    }
                    if (section.key === 'blocked') return null;  // no empty state for blocked
                    return (
                        <EmptySection
                            color={BLUE}
                            message="Nothing booked yet — tap an open slot above or tap + to schedule"
                            actionLabel="+ Add / Book"
                            onAction={() => setShowActionPicker(true)}
                        />
                    );
                }}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={() => { setRefreshing(true); fetchData(true); }}
                        tintColor={NAVY}
                    />
                }
            />

            {/* ── Session Action Modal ───────────────────────────────────── */}
            <SessionActionModal
                session={activeSession}
                onClose={() => setActiveSession(null)}
                onComplete={handleComplete}
                onMiss={handleMiss}
            />

            {/* ── Action Picker ──────────────────────────────────────────── */}
            <ActionPickerModal
                visible={showActionPicker}
                onClose={() => setShowActionPicker(false)}
                onAddSlot={() => setShowAddAvailability(true)}
                onBookClient={() => openQuickBook()}
            />

            {/* ── Add Availability Modal ─────────────────────────────────── */}
            <AddAvailabilityModal
                visible={showAddAvailability}
                date={selectedDate}
                onClose={() => setShowAddAvailability(false)}
                onCreated={() => { setShowAddAvailability(false); fetchData(true); }}
            />

            {/* ── QuickBook Modal (Book a client — client required) ──────── */}
            <QuickBookModal
                visible={showQuickBook}
                onClose={() => { setShowQuickBook(false); setSelectedSlotTime(undefined); }}
                onBooked={() => { setShowQuickBook(false); setSelectedSlotTime(undefined); fetchData(true); }}
                preselectedStartTime={selectedSlotTime}
                preselectedDate={selectedDate}
            />

            {/* ── Block Time Modal ───────────────────────────────────────── */}
            <BlockTimeModal
                visible={showBlockModal}
                date={selectedDate}
                onClose={() => setShowBlockModal(false)
                }
                onBlocked={() => { fetchData(true); }}
            />

        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#F9FAFB' },

    // Loading / error
    centred: {
        flex: 1, alignItems: 'center', justifyContent: 'center',
        gap: 12, padding: 24,
    },
    loadingTxt: { fontSize: 14, color: GRAY },
    errorTxt:   { fontSize: 14, color: GRAY, textAlign: 'center' },
    retryBtn:   { backgroundColor: NAVY, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 10, marginTop: 4 },
    retryTxt:   { fontSize: 14, fontWeight: '700', color: '#fff' },

    // Chrome
    chrome: {
        backgroundColor:   '#FFFFFF',
        paddingHorizontal: 16,
        paddingBottom:     12,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
        shadowColor:       '#000',
        shadowOpacity:     0.04,
        shadowRadius:      4,
        shadowOffset:      { width: 0, height: 2 },
        elevation:         2,
    },

    titleRow: {
        flexDirection:  'row',
        alignItems:     'center',
        justifyContent: 'space-between',
        marginBottom:   12,
    },
    scheduleHero: {
        backgroundColor: NAVY,
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    screenTitleLight: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 },
    monthChip: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(255,255,255,0.12)',
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    monthChipText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
    weekRow: { flexDirection: 'row', marginBottom: 10 },
    weekCell: { flex: 1, alignItems: 'center' },
    weekDow: { fontSize: 11, color: GRAY, marginBottom: 4 },
    weekNum: {
        width: 32, height: 32, borderRadius: 16,
        alignItems: 'center', justifyContent: 'center',
    },
    weekNumOn: { backgroundColor: NAVY },
    weekNumTxt: { fontSize: 14, fontWeight: '700', color: NAVY },
    weekNumTxtOn: { color: '#FFFFFF' },
    weekDots: { flexDirection: 'row', gap: 3, height: 6, marginTop: 3 },
    weekDot: { width: 5, height: 5, borderRadius: 3 },
    screenTitle: { fontSize: 20, fontWeight: '800', color: NAVY, letterSpacing: -0.3 },
    screenDate:  { fontSize: 12, color: GRAY, marginTop: 2 },

    // Inline FAB in header (replaces bottom-floating FAB)
    fabRow: {
        flexDirection: 'row',
        alignItems:    'center',
        gap:           8,
    },
    fab: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: '#FFFFFF',
        alignItems: 'center', justifyContent: 'center',
        shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 }, elevation: 3,
    },
    fabGray: {
        width: 40, height: 40, borderRadius: 12,
        backgroundColor: '#F3F4F6',
        borderWidth: 1, borderColor: '#E5E7EB',
        alignItems: 'center', justifyContent: 'center',
    },

    // Summary pills
    pillRow: { flexDirection: 'row', gap: 8 },
    pill: {
        flex: 1, alignItems: 'center', paddingVertical: 8,
        borderRadius: 10,
    },
    pillGreen: { backgroundColor: '#F0FDF4' },
    pillBlue:  { backgroundColor: '#E7EEF2' },
    pillRed:   { backgroundColor: '#FEE2E2' },
    pillMuted: { backgroundColor: '#F3F4F6' },
    pillNum:   { fontSize: 18, fontWeight: '800' },
    pillLbl:   { fontSize: 10, fontWeight: '600', marginTop: 1 },

    // List
    list:        { flex: 1 },
    listContent: { paddingTop: 0 },
    itemWrap:    { paddingHorizontal: 16 },

    // Compact date bar (replaces always-visible calendar header)
    dateBar: {
        flexDirection:    'row',
        alignItems:       'center',
        justifyContent:   'space-between',
        backgroundColor:  '#F9FAFB',
        borderRadius:     10,
        borderWidth:      1,
        borderColor:      '#E5E7EB',
        paddingVertical:  8,
        paddingHorizontal: 12,
        marginBottom:     10,
    },
    dateBarLeft: {
        flexDirection: 'row',
        alignItems:    'center',
        gap:           4,
    },
    dateBarText: {
        fontSize:   13,
        fontWeight: '700',
        color:      NAVY,
    },
    todayChip: {
        backgroundColor:  '#E7EEF2',
        borderRadius:     20,
        paddingHorizontal: 8,
        paddingVertical:   2,
        marginLeft:        6,
    },
    todayChipTxt: {
        fontSize:   10,
        fontWeight: '700',
        color:      BLUE,
    },
    calToggle: {
        flexDirection: 'row',
        alignItems:    'center',
        gap:           3,
        backgroundColor: '#EFF6FF',
        borderRadius:    20,
        paddingHorizontal: 10,
        paddingVertical:    4,
    },
    calToggleTxt: {
        fontSize:   11,
        fontWeight: '700',
        color:      NAVY,
    },
});
