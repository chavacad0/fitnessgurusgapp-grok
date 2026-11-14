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
 *    Open slots come from the coach's working hours. When hours are not
 *    saved, the day is not filled with an automatic grid. Bookings that
 *    already exist stay on the timeline.
 *
 * ─── Color system ─────────────────────────────────────────────────────────
 *    Teal   (#0F766E) = open slots and actions
 *    Mint   (#E6F7F1) = open-slot cards
 *    Navy   (#183A4A) = booked rows and chrome
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
    TextInput,
    Switch,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/theme';
import {
    completeBooking,
    cancelBooking,
    rescheduleBooking,
    unblockAvailabilitySlot,
    createAvailabilitySlot,
    getCoachSchedule,
    addAvailabilityBlock,
    removeAvailabilityBlock,
} from '../services/apiClient';
import { DashboardSummary, DaySummary, CoachSchedule, CoachScheduleItem } from '../types';
import { fontStyle, useKitFonts } from '../theme/fonts';
import QuickBookModal from './QuickBookModal';
import MonthCalendar from '../components/MonthCalendar';

// ─── Design tokens ─────────────────────────────────────────────────────────────

const NAVY   = '#183A4A';  // Primary Navy — per spec
const TEAL   = '#0F766E';
const MINT   = '#E6F7F1';
const SAGE   = '#4F7F71';
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
    onWorkingHours: () => void;
    onSlotLength:   () => void;
    onOneOff:       () => void;
    onRequests:     () => void;
    onAddSlot:      () => void;
    onBookClient:   () => void;
}

function ActionPickerModal({ visible, onClose, onWorkingHours, onSlotLength, onOneOff, onRequests, onAddSlot, onBookClient }: ActionPickerProps) {
    const go = (fn: () => void) => { onClose(); fn(); };
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <TouchableOpacity style={ap.overlay} activeOpacity={1} onPress={onClose} />
            <View style={ap.sheet}>
                <View style={ap.handle} />
                <Text style={ap.title}>What would you like to do?</Text>

                <TouchableOpacity style={ap.option} onPress={() => go(onWorkingHours)} accessibilityRole="button">
                    <View style={[ap.iconWrap, { backgroundColor: MINT }]}>
                        <Ionicons name="time-outline" size={20} color={TEAL} />
                    </View>
                    <View style={ap.optionText}>
                        <Text style={ap.optionLabel}>Working hours</Text>
                        <Text style={ap.optionSub}>Set the hours you actually work</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={GRAY} />
                </TouchableOpacity>
                <TouchableOpacity style={ap.option} onPress={() => go(onSlotLength)} accessibilityRole="button">
                    <View style={[ap.iconWrap, { backgroundColor: MINT }]}>
                        <Ionicons name="hourglass-outline" size={20} color={TEAL} />
                    </View>
                    <View style={ap.optionText}>
                        <Text style={ap.optionLabel}>Slot length</Text>
                        <Text style={ap.optionSub}>Session length and the buffer after it</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={GRAY} />
                </TouchableOpacity>
                <TouchableOpacity style={ap.option} onPress={() => go(onRequests)} accessibilityRole="button">
                    <View style={[ap.iconWrap, { backgroundColor: MINT }]}>
                        <Ionicons name="mail-outline" size={20} color={TEAL} />
                    </View>
                    <View style={ap.optionText}>
                        <Text style={ap.optionLabel}>Time requests</Text>
                        <Text style={ap.optionSub}>Nothing is booked until you confirm</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={GRAY} />
                </TouchableOpacity>
                <TouchableOpacity style={ap.option} onPress={() => go(onOneOff)} accessibilityRole="button">
                    <View style={[ap.iconWrap, { backgroundColor: MINT }]}>
                        <Ionicons name="calendar-outline" size={20} color={TEAL} />
                    </View>
                    <View style={ap.optionText}>
                        <Text style={ap.optionLabel}>One-off changes</Text>
                        <Text style={ap.optionSub}>Open extra slots, or mark a date closed</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={GRAY} />
                </TouchableOpacity>

                <View style={ap.divider} />

                {/* Add open slot */}
                <TouchableOpacity
                    style={ap.option}
                    onPress={() => { onClose(); onAddSlot(); }}
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityLabel="Add open slot"
                >
                    <View style={[ap.iconWrap, { backgroundColor: MINT }]}>
                        <Ionicons name="add-circle-outline" size={20} color={TEAL} />
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
                    <View style={[ap.iconWrap, { backgroundColor: MINT }]}>
                        <Ionicons name="person-outline" size={20} color={TEAL} />
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

interface BlockTimeModalProps {
    visible:      boolean;
    date:         string;   // YYYY-MM-DD pre-filled from selectedDate
    onClose:      () => void;
    onBlocked:    () => void;
}

function blockDateLabel(date: string, long = false): string {
    return new Date(`${date}T12:00:00+08:00`).toLocaleDateString('en-SG', {
        weekday: long ? 'long' : 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'Asia/Singapore',
    });
}

function BlockTimeModal({ visible, date, onClose, onBlocked }: BlockTimeModalProps) {
    const [lunch, setLunch] = useState(true);
    const [dayOff, setDayOff] = useState(false);
    const [custom, setCustom] = useState(false);
    const [startTime, setStartTime] = useState('15:00');
    const [endTime, setEndTime] = useState('16:00');
    const [submitting, setSubmitting] = useState(false);
    const isToday = date === todayISO();

    useEffect(() => {
        if (!visible) return;
        setLunch(true);
        setDayOff(false);
        setCustom(false);
        setStartTime('15:00');
        setEndTime('16:00');
    }, [visible]);

    const handleSubmit = async () => {
        if (!dayOff && !lunch && !custom) {
            Alert.alert('Choose what to block', 'Turn on lunch, a whole day off, or custom hours.');
            return;
        }
        if (custom && startTime >= endTime) {
            Alert.alert('Check the times', 'The end time has to be later on the same day.');
            return;
        }
        setSubmitting(true);
        try {
            if (dayOff) {
                await addAvailabilityBlock({ date, kind: 'day_off', label: 'Whole day off' });
            } else {
                if (lunch) {
                    await addAvailabilityBlock({
                        date, kind: 'range', start: '12:00', end: '13:00', label: 'Lunch',
                    });
                }
                if (custom) {
                    await addAvailabilityBlock({
                        date, kind: 'range', start: startTime, end: endTime, label: 'Custom hours',
                    });
                }
            }
            onBlocked();
            onClose();
        } catch (err: any) {
            Alert.alert('Could not block this time', err.message ?? 'Please try again.');
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
                    <Text style={btm.title}>Block time</Text>
                    <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Close">
                        <Ionicons name="close" size={22} color={GRAY} />
                    </TouchableOpacity>
                </View>
                <Text style={btm.dateLine}>Kept private to you. Clients won't see the reason.</Text>

                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    <View style={btm.option}>
                        <View style={btm.optionIcon}><Ionicons name="time-outline" size={18} color={TEAL} /></View>
                        <View style={{ flex: 1 }}>
                            <Text style={btm.optionTitle}>Lunch</Text>
                            <Text style={btm.optionSub}>{isToday ? 'Today' : blockDateLabel(date)} · 12:00–1:00 PM</Text>
                        </View>
                        <Switch value={lunch && !dayOff} onValueChange={setLunch} disabled={dayOff} trackColor={{ false: '#D1D5DB', true: TEAL }} thumbColor="#FFFFFF" />
                    </View>
                    <View style={btm.option}>
                        <View style={btm.optionIcon}><Ionicons name="calendar-outline" size={18} color={TEAL} /></View>
                        <View style={{ flex: 1 }}>
                            <Text style={btm.optionTitle}>Whole day off</Text>
                            <Text style={btm.optionSub}>Blocks {blockDateLabel(date, true)}</Text>
                        </View>
                        <Switch value={dayOff} onValueChange={setDayOff} trackColor={{ false: '#D1D5DB', true: TEAL }} thumbColor="#FFFFFF" />
                    </View>
                    <View style={btm.option}>
                        <View style={btm.optionIcon}><Ionicons name="create-outline" size={18} color={TEAL} /></View>
                        <View style={{ flex: 1 }}>
                            <Text style={btm.optionTitle}>Custom hours</Text>
                            <Text style={btm.optionSub}>Pick a start and end, any time of day</Text>
                        </View>
                        <Switch value={custom && !dayOff} onValueChange={setCustom} disabled={dayOff} trackColor={{ false: '#D1D5DB', true: TEAL }} thumbColor="#FFFFFF" />
                    </View>
                    {custom && !dayOff && (
                        <View style={btm.timeRow}>
                            <TextInput style={btm.input} value={startTime} onChangeText={setStartTime} placeholder="15:00" placeholderTextColor="#9CA3AF" maxLength={5} accessibilityLabel="Custom start" />
                            <TextInput style={btm.input} value={endTime} onChangeText={setEndTime} placeholder="16:00" placeholderTextColor="#9CA3AF" maxLength={5} accessibilityLabel="Custom end" />
                        </View>
                    )}

                    <TouchableOpacity
                        style={[btm.blockBtn, submitting && { opacity: 0.5 }]}
                        onPress={handleSubmit}
                        disabled={submitting}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel="Block time"
                    >
                        {submitting
                            ? <ActivityIndicator color="#fff" />
                            : <>
                                <Ionicons name="ban-outline" size={16} color="#fff" />
                                <Text style={btm.blockBtnLabel}>Block time</Text>
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

    option: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14,
        padding: 12, marginBottom: 8,
    },
    optionIcon: {
        width: 36, height: 36, borderRadius: 10, backgroundColor: MINT,
        alignItems: 'center', justifyContent: 'center',
    },
    optionTitle: { fontSize: 15, fontWeight: '700', color: NAVY },
    optionSub: { fontSize: 12, color: GRAY, marginTop: 2 },
    blockBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 8, backgroundColor: TEAL, borderRadius: 14,
        paddingVertical: 14, marginTop: 12,
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
    const navigation = useNavigation<any>();
    const fonts = useKitFonts();

    // ── State ─────────────────────────────────────────────────────────────────
    const [loading,          setLoading]          = useState(true);
    const [refreshing,       setRefreshing]       = useState(false);
    const [error,            setError]            = useState<string | null>(null);
    const [schedule,         setSchedule]         = useState<CoachSchedule | null>(null);
    const [activeSession,      setActiveSession]      = useState<Booking | null>(null);
    const [showQuickBook,      setShowQuickBook]      = useState(false);
    const [selectedSlotTime,   setSelectedSlotTime]   = useState<string | undefined>(undefined);
    const [selectedSlotEnd,    setSelectedSlotEnd]    = useState<string | undefined>(undefined);
    const [selectedSlotId,     setSelectedSlotId]     = useState<string | undefined>(undefined);
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
            const next = await getCoachSchedule(selectedDate);
            setSchedule(next);
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

    const items = schedule?.items ?? [];
    const countOpen = schedule?.counts.open ?? 0;
    const countBooked = schedule?.counts.booked ?? 0;
    const countDone = schedule?.counts.done ?? 0;
    const countMissed = schedule?.counts.missed ?? 0;
    const hoursSaved = schedule?.hours_saved === true;
    const showSetHours = !hoursSaved
        && countOpen === 0
        && !items.some(item => item.kind === 'closed' || item.kind === 'day_off');

    const monthSummaries = useMemo(() => {
        const map: Record<string, DaySummary> = {};
        for (const [date, counts] of Object.entries(schedule?.month ?? {})) {
            map[date] = {
                date,
                openCount: counts.open,
                bookedCount: counts.booked,
                doneCount: counts.done,
                missedCount: counts.missed,
            };
        }
        return map;
    }, [schedule]);

    // Block time modal state
    const [showBlockModal, setShowBlockModal] = useState(false);

    const handleRemoveBlock = useCallback((blockId: string, legacy: boolean) => {
        Alert.alert(
            'Remove this block?',
            'Clients still will not see the reason.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove',
                    onPress: async () => {
                        try {
                            if (legacy) await unblockAvailabilitySlot(blockId.replace(/^legacy:/, ''));
                            else await removeAvailabilityBlock(blockId);
                            fetchData(true);
                        } catch (err: any) {
                            Alert.alert('Could not remove the block', err.message ?? 'Please try again.');
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

    const openQuickBook = useCallback((slot?: { start_time: string; end_time: string; slot_id?: string }) => {
        setSelectedSlotTime(slot?.start_time);
        setSelectedSlotEnd(slot?.end_time);
        setSelectedSlotId(slot?.slot_id || undefined);
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

    const dayTitle = new Date(`${selectedDate}T12:00:00+08:00`).toLocaleDateString('en-SG', {
        weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Asia/Singapore',
    }).toUpperCase();

    const clockOf = (hhmm: string) => {
        const [h, m] = hhmm.split(':').map(Number);
        return { time: `${h % 12 || 12}:${String(m).padStart(2, '0')}`, period: h >= 12 ? 'PM' : 'AM' };
    };

    const renderScheduleItem = (item: CoachScheduleItem, index: number) => {
        if (item.kind === 'open') {
            const c = clockOf(item.start_time);
            return (
                <View key={`open-${item.slot_id}-${index}`} style={tl.row}>
                    <View style={tl.timeCol}>
                        <Text style={tl.time}>{c.time}</Text>
                        <Text style={tl.period}>{c.period}</Text>
                    </View>
                    <View style={tl.openCard}>
                        <View style={{ flex: 1 }}>
                            <Text style={[tl.openTitle, fontStyle(fonts.headingSemibold, '600')]}>Open</Text>
                            <Text style={tl.openSub}>{item.duration_minutes} min slot</Text>
                        </View>
                        {!!item.good_for?.length && (
                            <View style={tl.goodFor}>
                                <Text style={tl.goodForText} numberOfLines={1}>
                                    {item.good_for.length === 1
                                        ? `Good for ${item.good_for[0]}`
                                        : `Good for ${item.good_for[0]} +${item.good_for.length - 1}`}
                                </Text>
                            </View>
                        )}
                        <TouchableOpacity
                            style={tl.bookBtn}
                            onPress={() => openQuickBook(item)}
                            accessibilityRole="button"
                            accessibilityLabel={`Book ${c.time} ${c.period}`}
                        >
                            <Ionicons name="add" size={14} color="#FFFFFF" />
                            <Text style={tl.bookTxt}>Book</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            );
        }
        if (item.kind === 'booked') {
            const c = clockOf(item.start_time);
            const booking: Booking = {
                booking_id: item.booking_id,
                client_id: item.client_id,
                client_name: item.client_name,
                start_time: item.start_time,
                end_time: item.end_time,
                status: item.status,
            };
            return (
                <TouchableOpacity
                    key={`booked-${item.booking_id}-${index}`}
                    style={tl.row}
                    onPress={() => setActiveSession(booking)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.client_name} session`}
                >
                    <View style={tl.timeCol}>
                        <Text style={tl.timeStrong}>{c.time}</Text>
                        <Text style={tl.period}>{c.period}</Text>
                    </View>
                    <View style={tl.bookedCard}>
                        <View style={tl.avatar}>
                            <Text style={tl.avatarTxt}>{initials(item.client_name || 'C')}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[tl.client, fontStyle(fonts.headingSemibold, '600')]} numberOfLines={1}>{item.client_name}</Text>
                            <Text style={tl.sessionMeta}>Session · {item.duration_minutes} min</Text>
                        </View>
                        {item.status === 'completed' ? <Text style={tl.status}>Done</Text> : null}
                        {item.status === 'cancelled' ? <Text style={tl.status}>Missed</Text> : null}
                    </View>
                </TouchableOpacity>
            );
        }
        if (item.kind === 'blocked') {
            const c = clockOf(item.start_time);
            return (
                <TouchableOpacity
                    key={`block-${item.block_id}-${index}`}
                    style={tl.row}
                    onPress={() => handleRemoveBlock(item.block_id, item.legacy)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.label}. Blocked, private to you.`}
                >
                    <View style={tl.timeCol}>
                        <Text style={tl.time}>{c.time}</Text>
                        <Text style={tl.period}>{c.period}</Text>
                    </View>
                    <View style={tl.blockCard}>
                        <View style={{ flex: 1 }}>
                            <Text style={tl.blockTitle}>{item.label}</Text>
                            <Text style={tl.blockSub}>Blocked · private to you</Text>
                        </View>
                        <Ionicons name="ban-outline" size={16} color={GRAY} />
                    </View>
                </TouchableOpacity>
            );
        }
        if (item.kind === 'day_off') {
            return (
                <View key={`off-${item.block_id}`} style={tl.noteCard}>
                    <Text style={tl.blockTitle}>{item.label}</Text>
                    <Text style={tl.blockSub}>Blocked · private to you</Text>
                </View>
            );
        }
        return (
            <View key={`closed-${item.override_id}`} style={tl.noteCard}>
                <Text style={tl.blockTitle}>Closed</Text>
                <Text style={tl.blockSub}>{item.note ? `All day · ${item.note}` : 'All day'}</Text>
            </View>
        );
    };

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
                            style={s.blockPill}
                            onPress={() => setShowBlockModal(true)}
                            activeOpacity={0.85}
                            accessibilityRole="button"
                            accessibilityLabel="Block time"
                        >
                            <Ionicons name="ban-outline" size={15} color="#FFFFFF" />
                            <Text style={s.blockPillText}>Block time</Text>
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
                                    {summary?.openCount ? <View style={[s.weekDot, { backgroundColor: TEAL }]} /> : null}
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
                    <View style={[s.pill, s.pillMint]}>
                        <Text style={[s.pillNum, { color: TEAL }]}>{countOpen}</Text>
                        <Text style={[s.pillLbl, { color: TEAL }]}>Open</Text>
                    </View>
                    <View style={[s.pill, countBooked > 0 ? s.pillBlue : s.pillMuted]}>
                        <Text style={[s.pillNum, { color: countBooked > 0 ? NAVY : GRAY }]}>{countBooked}</Text>
                        <Text style={[s.pillLbl, { color: countBooked > 0 ? NAVY : GRAY }]}>Booked</Text>
                    </View>
                    <View style={[s.pill, countDone > 0 ? s.pillBlue : s.pillMuted]}>
                        <Text style={[s.pillNum, { color: countDone > 0 ? NAVY : GRAY }]}>{countDone}</Text>
                        <Text style={[s.pillLbl, { color: countDone > 0 ? NAVY : GRAY }]}>Done</Text>
                    </View>
                    <View style={[s.pill, s.pillMuted]}>
                        <Text style={[s.pillNum, { color: GRAY }]}>{countMissed}</Text>
                        <Text style={[s.pillLbl, { color: GRAY }]}>Missed</Text>
                    </View>
                </View>
            </View>

            <ScrollView
                style={s.list}
                contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + 120, paddingTop: 12 }]}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={() => { setRefreshing(true); fetchData(true); }}
                        tintColor={NAVY}
                    />
                }
            >
                {schedule?.heat && (
                    <View style={tl.heatCard}>
                        <Text style={[tl.heatTitle, fontStyle(fonts.headingSemibold, '600')]}>When clients are usually free</Text>
                        <Text style={tl.heatSub}>Built from My best times, not from booked sessions.</Text>
                        <View style={tl.bars}>
                            {(schedule.heat.counts.length ? schedule.heat.counts : Array.from({ length: 15 }, () => 0)).map((count, index) => {
                                const max = Math.max(1, ...schedule.heat!.counts);
                                return (
                                    <View key={index} style={tl.barTrack}>
                                        <View style={[tl.bar, { height: 8 + (count / max) * 36, opacity: count ? 0.45 + (count / max) * 0.55 : 0.25 }]} />
                                    </View>
                                );
                            })}
                        </View>
                        <View style={tl.barLabels}>
                            <Text style={tl.barLabel}>6 AM</Text>
                            <Text style={tl.barLabel}>9</Text>
                            <Text style={tl.barLabel}>12</Text>
                            <Text style={tl.barLabel}>3</Text>
                            <Text style={tl.barLabel}>6 PM</Text>
                            <Text style={tl.barLabel}>9</Text>
                        </View>
                        <View style={tl.scaleRow}>
                            <Text style={tl.scale}>Quieter</Text>
                            <View style={tl.scaleBar} />
                            <Text style={tl.scale}>Busier</Text>
                        </View>
                        {!schedule.heat.has_preferences && (
                            <Text style={tl.heatSub}>No best times saved yet.</Text>
                        )}
                        {!!schedule.heat.busiest_title && (
                            <View style={tl.heatNote}>
                                <Text style={tl.heatNoteTitle}>{schedule.heat.busiest_title}</Text>
                                <Text style={tl.heatSub}>{schedule.heat.busiest_body}</Text>
                            </View>
                        )}
                        {!!schedule.heat.quieter_title && (
                            <View style={tl.heatNote}>
                                <Text style={tl.heatNoteTitle}>{schedule.heat.quieter_title}</Text>
                                <Text style={tl.heatSub}>{schedule.heat.quieter_body}</Text>
                            </View>
                        )}
                    </View>
                )}
                <View style={tl.dayHead}>
                    <Text style={[tl.dayTitle, fontStyle(fonts.bodySemibold, '600')]}>{dayTitle}</Text>
                    <Text style={tl.dayCount}>{countOpen}</Text>
                </View>
                {items.map(renderScheduleItem)}
                {showSetHours && (
                    <View style={tl.emptyWrap}>
                        <View style={tl.emptyCard}>
                            <View style={tl.emptyIcon}>
                                <Ionicons name="time-outline" size={22} color={TEAL} />
                            </View>
                            <Text style={[tl.emptyTitle, fontStyle(fonts.headingSemibold, '600')]}>Set your working hours</Text>
                            <Text style={tl.emptyBody}>
                                Without hours, the day fills with empty slots from early morning on. Set when you work, and only those times will show as open.
                            </Text>
                            <TouchableOpacity
                                style={tl.emptyBtn}
                                onPress={() => navigation.navigate('WorkingHours')}
                                accessibilityRole="button"
                                accessibilityLabel="Set your working hours"
                            >
                                <Text style={tl.emptyBtnTxt}>Set your working hours</Text>
                            </TouchableOpacity>
                        </View>
                        <Text style={tl.emptyFoot}>You can also add a one-off Saturday later.</Text>
                    </View>
                )}
            </ScrollView>

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
                onWorkingHours={() => navigation.navigate('WorkingHours')}
                onSlotLength={() => navigation.navigate('SlotLength')}
                onOneOff={() => navigation.navigate('OneOffChanges')}
                onRequests={() => navigation.navigate('TimeRequests')}
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
                onClose={() => { setShowQuickBook(false); setSelectedSlotTime(undefined); setSelectedSlotEnd(undefined); setSelectedSlotId(undefined); }}
                onBooked={() => { setShowQuickBook(false); setSelectedSlotTime(undefined); setSelectedSlotEnd(undefined); setSelectedSlotId(undefined); fetchData(true); }}
                preselectedStartTime={selectedSlotTime}
                preselectedEndTime={selectedSlotEnd}
                preselectedSlotId={selectedSlotId}
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
    blockPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(255,255,255,0.14)',
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    blockPillText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
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
    pillMint: { backgroundColor: '#E6F7F1' },
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

const tl = StyleSheet.create({
    dayHead: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, marginBottom: 8,
    },
    dayTitle: { color: '#6B7280', fontSize: 12, letterSpacing: 0.6 },
    dayCount: { color: '#0F766E', fontSize: 13, fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, marginBottom: 8 },
    timeCol: { width: 52, alignItems: 'flex-end', paddingRight: 8 },
    time: { fontSize: 13, fontWeight: '700', color: '#6B7280' },
    timeStrong: { fontSize: 13, fontWeight: '800', color: '#183A4A' },
    period: { fontSize: 10, color: '#9CA3AF', marginTop: 1 },
    openCard: {
        flex: 1, flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#E6F7F1', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12,
    },
    openTitle: { color: '#0F766E', fontSize: 16 },
    openSub: { color: '#4F7F71', fontSize: 12, marginTop: 2 },
    bookBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 2,
        backgroundColor: '#0F766E', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8,
    },
    bookTxt: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
    goodFor: {
        backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, maxWidth: 120,
    },
    goodForText: { color: '#4F7F71', fontSize: 11, fontWeight: '700' },
    heatCard: {
        marginHorizontal: 16, marginBottom: 12, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14,
    },
    heatTitle: { color: '#183A4A', fontSize: 16 },
    heatSub: { color: '#6B7280', fontSize: 12, lineHeight: 17, marginTop: 4 },
    bars: { flexDirection: 'row', alignItems: 'flex-end', height: 52, gap: 3, marginTop: 12 },
    barTrack: { flex: 1, justifyContent: 'flex-end' },
    bar: { backgroundColor: '#0F766E', borderRadius: 3 },
    barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
    barLabel: { color: '#9CA3AF', fontSize: 10 },
    scaleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
    scale: { color: '#9CA3AF', fontSize: 11 },
    scaleBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: '#E6F7F1' },
    heatNote: { marginTop: 10 },
    heatNoteTitle: { color: '#183A4A', fontSize: 14, fontWeight: '700' },
    bookedCard: {
        flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 12,
        borderWidth: 1, borderColor: '#E5E7EB',
    },
    avatar: {
        width: 36, height: 36, borderRadius: 18, backgroundColor: '#E6F7F1',
        alignItems: 'center', justifyContent: 'center',
    },
    avatarTxt: { color: '#0F766E', fontSize: 13, fontWeight: '800' },
    client: { color: '#183A4A', fontSize: 16 },
    sessionMeta: { color: '#6B7280', fontSize: 12, marginTop: 2 },
    status: { color: '#4F7F71', fontSize: 13, fontWeight: '700' },
    blockCard: {
        flex: 1, flexDirection: 'row', alignItems: 'center',
        borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12,
        borderWidth: 1, borderStyle: 'dashed', borderColor: '#D1D5DB', backgroundColor: '#FFFFFF',
    },
    blockTitle: { color: '#6B7280', fontSize: 15, fontWeight: '700' },
    blockSub: { color: '#9CA3AF', fontSize: 12, marginTop: 2 },
    noteCard: {
        marginHorizontal: 16, marginBottom: 8, marginLeft: 64,
        borderRadius: 16, padding: 14,
        borderWidth: 1, borderStyle: 'dashed', borderColor: '#D1D5DB',
    },
    emptyWrap: { paddingHorizontal: 16, paddingTop: 8 },
    emptyCard: {
        backgroundColor: '#FFFFFF', borderRadius: 18, padding: 20, alignItems: 'center',
    },
    emptyIcon: {
        width: 48, height: 48, borderRadius: 24, backgroundColor: '#E6F7F1',
        alignItems: 'center', justifyContent: 'center', marginBottom: 12,
    },
    emptyTitle: { color: '#183A4A', fontSize: 18, textAlign: 'center', marginBottom: 8 },
    emptyBody: { color: '#6B7280', fontSize: 14, lineHeight: 20, textAlign: 'center' },
    emptyBtn: {
        marginTop: 16, backgroundColor: '#0F766E', borderRadius: 14,
        paddingVertical: 14, paddingHorizontal: 18, alignSelf: 'stretch', alignItems: 'center',
    },
    emptyBtnTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
    emptyFoot: { color: '#9CA3AF', fontSize: 12, textAlign: 'center', marginTop: 14 },
});
