/**
 * ClientBookingScreen — Book a session with your coach.
 *
 * Layout:
 *  1. 14-day calendar strip — green dot on dates with open slots
 *  2. Slot list for the selected date
 *  3. My Bookings mini-section (upcoming bookings)
 *
 * Data:
 *   getClientAvailableSlots()  → all open slots (used to compute dots + filter)
 *   getClientBookings()        → client's bookings (for "My Bookings")
 *   clientBookSlot(slot_id)    → POST book a slot
 *
 * Rules:
 *  - Blocked / already-booked slots are filtered by the backend
 *  - Private blocked_reason is never sent to the client
 *  - Clients not yet connected to a coach (has_coach === false) see a
 *    Connect-to-Coach card (invitation code) instead of the calendar.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    FlatList, ScrollView, ActivityIndicator,
    Alert, Modal, RefreshControl, TextInput,
    KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { colors, spacing, radius, typography, shadows } from '../../theme/theme';
import {
    getClientAvailableSlots,
    getClientBookings,
    clientBookSlot,
    connectToCoach,
} from '../../services/apiClient';
import { CoachAvailabilitySlot, BookingSlot } from '../../types';
import KitStatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import Button from '../../components/Button';

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCENT  = colors.accent;
const GREEN   = '#16A34A';
const DAYS    = 14; // number of days to show in the strip

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Returns 'YYYY-MM-DD' for a Date (SGT-aware) */
function toDateStr(d: Date): string {
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

/** Today in SGT */
function todaySGT(): string {
    return toDateStr(new Date());
}

/** Tomorrow in SGT — earliest date a client can book */
function tomorrowSGT(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return toDateStr(d);
}

/** Returns array of YYYY-MM-DD strings starting from tomorrow, length = DAYS */
function buildDateWindow(): string[] {
    const today = new Date();
    return Array.from({ length: DAYS }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() + i + 1);   // +1 = starts from tomorrow
        return toDateStr(d);
    });
}

/** 'YYYY-MM-DD' → { day: 'Mon', num: '12' } */
function splitDate(date: string): { day: string; num: string } {
    const d = new Date(`${date}T00:00:00+08:00`);
    return {
        day: d.toLocaleDateString('en-SG', { weekday: 'short', timeZone: 'Asia/Singapore' }),
        num: d.toLocaleDateString('en-SG', { day: 'numeric',   timeZone: 'Asia/Singapore' }),
    };
}

/** 'YYYY-MM-DD' → 'Monday, 12 May 2026' */
function fmtDateLong(date: string): string {
    return new Date(`${date}T00:00:00+08:00`).toLocaleDateString('en-SG', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        timeZone: 'Asia/Singapore',
    });
}

/** 'YYYY-MM-DD' → 'Mon, 12 May' */
function fmtDateShort(date: string): string {
    return new Date(`${date}T00:00:00+08:00`).toLocaleDateString('en-SG', {
        weekday: 'short', day: 'numeric', month: 'short',
        timeZone: 'Asia/Singapore',
    });
}

/** 'HH:MM' → '9:00 AM' */
function fmt(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12  = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function durationLabel(start: string, end: string): string {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const mins = (eh * 60 + em) - (sh * 60 + sm);
    if (!Number.isFinite(mins) || mins <= 0) return '';
    return `${mins} min`;
}

// ─── Calendar Strip ───────────────────────────────────────────────────────────

interface CalendarStripProps {
    dates:        string[];           // YYYY-MM-DD
    selected:     string;
    availableDates: Set<string>;      // dates that have ≥1 open slot
    onSelect:     (date: string) => void;
}

function CalendarStrip({ dates, selected, availableDates, onSelect }: CalendarStripProps) {
    const flatRef = useRef<FlatList>(null);
    const today   = todaySGT();

    return (
        <View style={cal.wrapper}>
            <FlatList
                ref={flatRef}
                data={dates}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={d => d}
                contentContainerStyle={cal.strip}
                getItemLayout={(_, i) => ({ length: 60, offset: 60 * i, index: i })}
                renderItem={({ item: date }) => {
                    const { day, num } = splitDate(date);
                    const isSelected   = date === selected;
                    const isToday      = date === today;
                    const hasSlots     = availableDates.has(date);
                    return (
                        <TouchableOpacity
                            style={[
                                cal.cell,
                                isSelected && cal.cellSelected,
                                isToday && !isSelected && cal.cellToday,
                            ]}
                            onPress={() => onSelect(date)}
                            activeOpacity={0.75}
                            accessibilityRole="button"
                            accessibilityLabel={`${date}${hasSlots ? ' — sessions available' : ''}`}
                        >
                            <Text style={[cal.dayLabel, isSelected && cal.textSelected]}>
                                {day}
                            </Text>
                            <Text style={[cal.numLabel, isSelected && cal.textSelected]}>
                                {num}
                            </Text>
                            {/* Green availability dot */}
                            <View style={cal.dotRow}>
                                {hasSlots ? (
                                    <View style={cal.dotGreen} />
                                ) : (
                                    <View style={cal.dotEmpty} />
                                )}
                            </View>
                        </TouchableOpacity>
                    );
                }}
            />
        </View>
    );
}

const cal = StyleSheet.create({
    wrapper: {
        backgroundColor: colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    strip: {
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.sm,
        gap: 4,
    },
    cell: {
        width: 54,
        alignItems: 'center',
        paddingVertical: spacing.sm,
        borderRadius: radius.card,
        gap: 2,
    },
    cellSelected: {
        backgroundColor: colors.primary,
    },
    cellToday: {
        borderWidth: 1,
        borderColor: ACCENT,
    },
    dayLabel: {
        fontSize: 10,
        fontWeight: '600',
        color: colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    numLabel: {
        fontSize: 18,
        fontWeight: '800',
        color: colors.textPrimary,
        lineHeight: 22,
    },
    textSelected: {
        color: '#fff',
    },
    dotRow: {
        height: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dotGreen: {
        width: 6, height: 6,
        borderRadius: 3,
        backgroundColor: GREEN,
    },
    dotEmpty: {
        width: 6, height: 6,
    },
});

// ─── Confirm Booking Modal ────────────────────────────────────────────────────

interface ConfirmModalProps {
    slot:      CoachAvailabilitySlot | null;
    loading:   boolean;
    onConfirm: () => void;
    onCancel:  () => void;
}

function ConfirmModal({ slot, loading, onConfirm, onCancel }: ConfirmModalProps) {
    if (!slot) return null;
    return (
        <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
            <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onCancel} />
            <View style={s.sheet}>
                <View style={s.handle} />
                <Text style={s.sheetTitle}>Confirm Booking</Text>
                <View style={s.sheetInfo}>
                    <View style={s.infoRow}>
                        <Ionicons name="calendar-outline" size={18} color={ACCENT} />
                        <Text style={s.infoText}>{fmtDateLong(slot.date)}</Text>
                    </View>
                    <View style={s.infoRow}>
                        <Ionicons name="time-outline" size={18} color={ACCENT} />
                        <Text style={s.infoText}>{fmt(slot.start_time)} – {fmt(slot.end_time)}</Text>
                    </View>
                </View>
                <Text style={s.sheetNote}>
                    1 session will be deducted from your plan after the session is completed.
                </Text>
                <TouchableOpacity
                    style={[s.confirmBtn, loading && s.btnDisabled]}
                    onPress={onConfirm}
                    disabled={loading}
                    activeOpacity={0.88}
                >
                    {loading
                        ? <ActivityIndicator color="#fff" />
                        : <Text style={s.confirmBtnTxt}>Confirm Booking</Text>
                    }
                </TouchableOpacity>
                <TouchableOpacity
                    style={s.goBackBtn}
                    onPress={onCancel}
                    disabled={loading}
                    activeOpacity={0.88}
                >
                    <Text style={s.goBackTxt}>Go back</Text>
                </TouchableOpacity>
            </View>
        </Modal>
    );
}

// ─── Booking status badge ─────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
    if (status === 'booked' || status === 'confirmed') {
        return <KitStatusBadge variant="booked" label="Upcoming" />;
    }
    if (status === 'completed') return <KitStatusBadge variant="completed" />;
    if (status === 'cancelled') return <KitStatusBadge variant="cancelled" />;
    return <KitStatusBadge status="neutral" label={status} />;
}

// ─── Connect-to-Coach card (shown when the client has no coach yet) ──────────

function ConnectCoachCard({ onConnected }: { onConnected: () => void }) {
    const [code,       setCode]       = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [errorMsg,   setErrorMsg]   = useState<string | null>(null);
    const submittingRef = useRef(false);   // synchronous double-tap guard

    const trimmed  = code.trim();
    const canSubmit = trimmed.length >= 4 && !submitting;

    const handleConnect = async () => {
        if (!canSubmit || submittingRef.current) return;
        submittingRef.current = true;
        setSubmitting(true);
        setErrorMsg(null);
        try {
            const res = await connectToCoach(trimmed);
            Alert.alert(
                res.alreadyConnected ? 'Already connected' : 'Connected! 🎉',
                res.message,
                [{ text: 'View sessions', onPress: onConnected }],
            );
        } catch (err: any) {
            setErrorMsg(err.message ?? 'Could not connect. Please try again.');
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    };

    return (
        <View style={cc.card}>
            <View style={cc.iconWrap}>
                <Ionicons name="people-outline" size={32} color={ACCENT} />
            </View>
            <Text style={cc.title}>Connect with your coach</Text>
            <Text style={cc.body}>
                Enter the invitation code from your coach to see available sessions and start booking.
            </Text>

            <TextInput
                style={cc.input}
                value={code}
                onChangeText={t => { setCode(t.toUpperCase()); setErrorMsg(null); }}
                placeholder="INVITE CODE"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={16}
                returnKeyType="done"
                onSubmitEditing={handleConnect}
                editable={!submitting}
                accessibilityLabel="Coach invitation code"
            />

            {errorMsg && <Text style={cc.error}>{errorMsg}</Text>}

            <Button
                label="Connect to coach"
                onPress={handleConnect}
                disabled={!canSubmit}
                loading={submitting}
                fullWidth
                accessibilityLabel="Connect to coach"
            />

            <Text style={cc.hint}>Don't have a code? Ask your coach to share it from their profile.</Text>
        </View>
    );
}

const cc = StyleSheet.create({
    card: {
        backgroundColor: colors.surface,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.xl,
        alignItems: 'center',
        gap: spacing.sm,
        ...shadows.card,
    },
    iconWrap: {
        width: 64, height: 64, borderRadius: 32,
        backgroundColor: colors.accentSubtle,
        alignItems: 'center', justifyContent: 'center',
        marginBottom: spacing.xs,
    },
    title: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
    body:  { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.sm },
    input: {
        alignSelf: 'stretch',
        borderWidth: 1.5,
        borderColor: colors.border,
        borderRadius: radius.md,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.base,
        fontSize: 20,
        fontWeight: '700',
        letterSpacing: 4,
        textAlign: 'center',
        color: colors.textPrimary,
        backgroundColor: colors.background,
    },
    error: { ...typography.body, color: colors.errorText, textAlign: 'center' },
    hint:  { ...typography.micro, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ClientBookingScreen() {
    const { updateUser } = useAuth();
    const navigation = useNavigation<any>();
    const insets = useSafeAreaInsets();
    const dates = buildDateWindow();

    const [selectedDate, setSelectedDate] = useState<string>(tomorrowSGT());
    const [allSlots,     setAllSlots]     = useState<CoachAvailabilitySlot[]>([]);
    const [myBookings,   setMyBookings]   = useState<BookingSlot[]>([]);
    const [loading,      setLoading]      = useState(true);
    const [refreshing,   setRefreshing]   = useState(false);
    const [error,        setError]        = useState<string | null>(null);
    const [selectedSlot, setSelectedSlot] = useState<CoachAvailabilitySlot | null>(null);
    const [booking,      setBooking]      = useState(false);
    // null = unknown (still loading); false = client must connect to a coach first
    const [hasCoach,     setHasCoach]     = useState<boolean | null>(null);

    // ── Fetch ───────────────────────────────────────────────────────────────────
    const loadData = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else           setLoading(true);
        setError(null);
        try {
            const [slotsRes, bookingsRes] = await Promise.all([
                getClientAvailableSlots(),
                getClientBookings(),
            ]);
            // Backends that predate has_coach omit it → treat as connected.
            setHasCoach(slotsRes.has_coach !== false);
            const safeSlots = (slotsRes.slots ?? []).filter(
                (s: CoachAvailabilitySlot) => !s.is_booked && s.status !== 'blocked',
            );
            setAllSlots(safeSlots);

            // Only upcoming bookings in the My Bookings strip
            const upcoming = (bookingsRes.bookings ?? [])
                .filter((b: BookingSlot) => b.status === 'booked' || b.status === 'confirmed')
                .sort((a: BookingSlot, b: BookingSlot) => a.date.localeCompare(b.date));
            setMyBookings(upcoming);
        } catch (err: any) {
            setError(err.message ?? 'Failed to load sessions.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

    // ── Derived data ────────────────────────────────────────────────────────────
    const availableDates = new Set(allSlots.map(s => s.date));
    const slotsForDate   = allSlots
        .filter(s => s.date === selectedDate)
        .sort((a, b) => a.start_time.localeCompare(b.start_time));

    // ── Book action ─────────────────────────────────────────────────────────────
    const bookingRef = useRef(false);
    const handleConfirm = async () => {
        if (!selectedSlot || bookingRef.current) return;
        bookingRef.current = true;
        setBooking(true);
        try {
            await clientBookSlot({ slot_id: selectedSlot._id! });
            const bookedDate = selectedSlot.date;
            const bookedTime = selectedSlot.start_time;
            setSelectedSlot(null);
            Alert.alert(
                'Session booked! 🎉',
                `You're booked for ${fmtDateShort(bookedDate)} at ${fmt(bookedTime)}.`,
                [{ text: 'Great!', onPress: () => loadData() }],
            );
        } catch (err: any) {
            setSelectedSlot(null);
            Alert.alert('Could not book', err.message ?? 'This slot may have just been taken. Please refresh.');
            loadData();
        } finally {
            bookingRef.current = false;
            setBooking(false);
        }
    };

    // ── Loading / error states ─────────────────────────────────────────────────
    if (loading) {
        return (
            <SafeAreaView style={s.root} edges={['bottom']}>
                <View style={s.centred}>
                    <ActivityIndicator size="large" color={ACCENT} />
                    <Text style={s.hint}>Loading available sessions…</Text>
                </View>
            </SafeAreaView>
        );
    }

    if (error) {
        return (
            <SafeAreaView style={s.root} edges={['bottom']}>
                <View style={s.centred}>
                    <Ionicons name="alert-circle-outline" size={48} color={colors.errorText} />
                    <Text style={s.errorTxt}>{error}</Text>
                    <TouchableOpacity style={s.retryBtn} onPress={() => loadData()}>
                        <Text style={s.retryTxt}>Try again</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    // ── Not connected to a coach yet — onboarding, not an error ──────────────
    if (hasCoach === false) {
        return (
            <SafeAreaView style={s.root} edges={['bottom']}>
                <KeyboardAvoidingView
                    style={s.root}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <ScrollView
                        contentContainerStyle={[s.content, { flexGrow: 1, justifyContent: 'center' }]}
                        keyboardShouldPersistTaps="handled"
                        refreshControl={
                            <RefreshControl
                                refreshing={refreshing}
                                onRefresh={() => loadData(true)}
                                tintColor={ACCENT}
                            />
                        }
                    >
                        <ConnectCoachCard onConnected={() => {
                            // Remember the link so the next launch opens Home, not this screen.
                            updateUser({ hasCoach: true }).catch(() => { /* non-fatal */ });
                            loadData();
                        }} />
                    </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>
        );
    }

    // ── Main render ────────────────────────────────────────────────────────────
    return (
        <SafeAreaView style={s.root} edges={['bottom']}>
            <View style={[s.hero, { paddingTop: insets.top + spacing.sm }]}>
                <Text style={s.heroTitle}>Book a session</Text>
                <Text style={s.heroSub}>Pick a day with a green dot.</Text>
            </View>

            {/* ── Calendar strip ───────────────────────────────────────────── */}
            <CalendarStrip
                dates={dates}
                selected={selectedDate}
                availableDates={availableDates}
                onSelect={setSelectedDate}
            />

            <ScrollView
                style={s.scroll}
                contentContainerStyle={s.content}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={() => loadData(true)}
                        tintColor={ACCENT}
                    />
                }
            >
                <View style={s.timeLinks}>
                    <TouchableOpacity style={s.timeLink} onPress={() => navigation.navigate('ClientBestTimes')} accessibilityRole="button">
                        <Text style={s.timeLinkText}>My best times</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.timeLink} onPress={() => navigation.navigate('ClientRequestTime')} accessibilityRole="button">
                        <Text style={s.timeLinkText}>Request a time</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.timeLink} onPress={() => navigation.navigate('ClientAwayDates')} accessibilityRole="button">
                        <Text style={s.timeLinkText}>Away dates</Text>
                    </TouchableOpacity>
                </View>

                {/* ── Selected date heading ────────────────────────────────── */}
                <View style={s.dateHeadRow}>
                    <Text style={s.dateHead}>{fmtDateLong(selectedDate)}</Text>
                    {availableDates.has(selectedDate) && (
                        <View style={s.availPill}>
                            <Text style={s.availPillTxt}>
                                {slotsForDate.length} open
                            </Text>
                        </View>
                    )}
                </View>

                {/* ── Slots for selected date ──────────────────────────────── */}
                {slotsForDate.length === 0 ? (
                    <EmptyState
                        compact
                        icon="calendar-outline"
                        title={`No open slots on ${fmtDateShort(selectedDate)}`}
                        subtitle={availableDates.size > 0
                            ? 'Check dates with a green dot for open slots.'
                            : "Your coach hasn't posted any open slots yet. Pull down to refresh."}
                    />
                ) : (
                    <>
                        {slotsForDate.map(slot => (
                            <TouchableOpacity
                                key={slot._id ?? slot.id}
                                style={s.slotCard}
                                onPress={() => setSelectedSlot(slot)}
                                activeOpacity={0.82}
                                accessibilityRole="button"
                                accessibilityLabel={`Book session at ${slot.start_time}`}
                            >
                                <View style={s.slotLeft}>
                                    <View style={s.slotDot} />
                                    <View>
                                        <Text style={s.slotTime}>{fmt(slot.start_time)}</Text>
                                        <Text style={s.slotSub}>
                                            {durationLabel(slot.start_time, slot.end_time) || 'Available'}
                                        </Text>
                                    </View>
                                </View>
                                <View style={s.slotActions}>
                                    <KitStatusBadge variant="open" label="Available" />
                                    <View style={s.bookBtn}>
                                        <Text style={s.bookBtnTxt}>Book</Text>
                                    </View>
                                </View>
                            </TouchableOpacity>
                        ))}
                    </>
                )}

                {/* ── My Bookings section ──────────────────────────────────── */}
                <View style={s.myBookingsSection}>
                    <Text style={s.sectionLabel}>MY UPCOMING BOOKINGS</Text>

                    {myBookings.length === 0 ? (
                        <EmptyState
                            compact
                            icon="calendar-outline"
                            title="No upcoming sessions — book one above."
                        />
                    ) : (
                        myBookings.map(b => (
                            <View key={b._id ?? b.id} style={s.bookingCard}>
                                <View style={s.bookingLeft}>
                                    <Text style={s.bookingDate}>{fmtDateShort(b.date)}</Text>
                                    <Text style={s.bookingTime}>
                                        {fmt(b.start_time)} – {fmt(b.end_time)}
                                    </Text>
                                </View>
                                <StatusBadge status={b.status} />
                            </View>
                        ))
                    )}
                </View>

                <View style={{ height: 32 }} />
            </ScrollView>

            {/* ── Confirm modal ────────────────────────────────────────────── */}
            <ConfirmModal
                slot={selectedSlot}
                loading={booking}
                onConfirm={handleConfirm}
                onCancel={() => setSelectedSlot(null)}
            />
        </SafeAreaView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    root:    { flex: 1, backgroundColor: colors.background },
    hero: {
        backgroundColor: colors.primary,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.lg,
    },
    heroTitle: { ...typography.h2, color: colors.textOnPrimary },
    heroSub: { ...typography.body, color: 'rgba(255,255,255,0.78)', marginTop: 4 },
    scroll:  { flex: 1 },
    content: { padding: spacing.base },
    timeLinks: { flexDirection: 'row', gap: 8, marginBottom: spacing.base },
    timeLink: {
        flex: 1, backgroundColor: colors.surface, borderRadius: radius.md,
        borderWidth: 1, borderColor: colors.border, paddingVertical: 10, paddingHorizontal: 6,
        alignItems: 'center',
    },
    timeLinkText: { color: colors.accent, fontSize: 12, fontWeight: '700', textAlign: 'center' },

    // ── States ────────────────────────────────────────────────────────────────
    centred:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.base },
    hint:     { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
    errorTxt: { ...typography.body, color: colors.errorText, textAlign: 'center' },
    retryBtn: {
        backgroundColor: ACCENT,
        borderRadius: radius.md,
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.sm,
    },
    retryTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },

    // ── Date heading ──────────────────────────────────────────────────────────
    dateHeadRow: {
        flexDirection: 'row', alignItems: 'center',
        marginBottom: spacing.base, gap: spacing.sm,
    },
    dateHead: {
        ...typography.h3, color: colors.textPrimary, flex: 1,
    },
    availPill: {
        backgroundColor: '#D1FAE5',
        borderRadius: radius.pill,
        paddingHorizontal: 10, paddingVertical: 3,
    },
    availPillTxt: { fontSize: 11, fontWeight: '700', color: GREEN },

    // ── Slot card ─────────────────────────────────────────────────────────────
    slotCard: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1, borderColor: colors.border,
        paddingVertical: spacing.base,
        paddingHorizontal: spacing.base,
        marginBottom: spacing.sm,
        ...shadows.card,
    },
    slotLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    slotDot:  {
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: GREEN,
    },
    slotTime: { ...typography.body, fontWeight: '700', color: colors.textPrimary },
    slotSub:  { ...typography.caption, color: GREEN, fontWeight: '600' },
    slotActions: { alignItems: 'flex-end', gap: spacing.sm },
    bookBtn:  {
        backgroundColor: colors.accent,
        borderRadius: radius.md,
        paddingHorizontal: spacing.base,
        paddingVertical: spacing.sm,
    },
    bookBtnTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },

    // ── My Bookings section ───────────────────────────────────────────────────
    myBookingsSection: { marginTop: spacing.xl },
    sectionLabel: {
        fontSize: 10, fontWeight: '800', letterSpacing: 1.2,
        color: colors.textSecondary,
        marginBottom: spacing.base,
    },
    bookingCard: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1, borderColor: colors.border,
        padding: spacing.base,
        marginBottom: spacing.sm,
        ...shadows.card,
    },
    bookingLeft: { gap: 2 },
    bookingDate: { ...typography.label, fontWeight: '600', color: colors.textPrimary },
    bookingTime: { ...typography.caption, color: colors.textSecondary },

    // ── Confirm modal ─────────────────────────────────────────────────────────
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: radius.cardLg,
        borderTopRightRadius: radius.cardLg,
        padding: spacing.xl,
        paddingBottom: 44,
        gap: spacing.base,
    },
    handle: {
        width: 40, height: 4,
        backgroundColor: colors.border,
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: spacing.base,
    },
    sheetTitle: { ...typography.h3, color: colors.textPrimary, textAlign: 'center' },
    sheetInfo: {
        gap: spacing.sm,
        backgroundColor: colors.background,
        borderRadius: radius.card,
        padding: spacing.base,
    },
    infoRow:   { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    infoText:  { ...typography.body, color: colors.textPrimary },
    sheetNote: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', lineHeight: 18 },
    confirmBtn: {
        backgroundColor: colors.accent,
        borderRadius: radius.card,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        ...shadows.card,
    },
    confirmBtnTxt: { fontSize: 16, fontWeight: '700', color: '#fff' },
    goBackBtn: { height: 44, alignItems: 'center', justifyContent: 'center' },
    goBackTxt: { ...typography.body, color: colors.textSecondary },
    btnDisabled: { opacity: 0.6 },
});
