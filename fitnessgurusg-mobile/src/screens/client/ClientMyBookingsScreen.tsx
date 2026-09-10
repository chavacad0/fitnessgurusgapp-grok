/**
 * ClientMyBookingsScreen — shows the client's full booking history.
 *
 * Layout:
 *  - Flat list of all bookings, newest first
 *  - Each item: date, time range, status badge
 *  - 'booked' status items have a "Cancel" action with confirmation alert
 *  - Empty state: prompt to go book a session
 *
 * Data:  getClientBookings()           → BookingSlot[]
 * Write: clientCancelBooking(bookingId) → BookingSlot (cancelled)
 */

import React, { useCallback, useState } from 'react';
import {
    View, Text, FlatList, TouchableOpacity, StyleSheet,
    ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography, shadows } from '../../theme/theme';
import { getClientBookings, clientCancelBooking } from '../../services/apiClient';
import { BookingSlot } from '../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12  = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function fmtDate(date: string): string {
    return new Date(`${date}T00:00:00+08:00`).toLocaleDateString('en-SG', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
        timeZone: 'Asia/Singapore',
    });
}

// ─── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
    booked:    { label: 'Upcoming',  bg: '#EEF2FF', text: '#4F46E5' },
    confirmed: { label: 'Upcoming',  bg: '#EEF2FF', text: '#4F46E5' },
    completed: { label: 'Completed', bg: '#F0FDF4', text: '#16A34A' },
    cancelled: { label: 'Cancelled', bg: '#FEF2F2', text: '#DC2626' },
};

function StatusBadge({ status }: { status: string }) {
    const cfg = STATUS_CONFIG[status] ?? { label: status, bg: colors.border, text: colors.textSecondary };
    return (
        <View style={[badge.wrap, { backgroundColor: cfg.bg }]}>
            <Text style={[badge.txt, { color: cfg.text }]}>{cfg.label}</Text>
        </View>
    );
}

const badge = StyleSheet.create({
    wrap: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
    txt:  { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
});

// ─── Booking row ───────────────────────────────────────────────────────────────

interface BookingRowProps {
    item:     BookingSlot;
    onCancel: (item: BookingSlot) => void;
}

function BookingRow({ item, onCancel }: BookingRowProps) {
    const isUpcoming = item.status === 'booked' || item.status === 'confirmed';

    return (
        <View style={s.card}>
            <View style={s.cardTop}>
                <View style={s.cardLeft}>
                    <Text style={s.cardDate}>{fmtDate(item.date)}</Text>
                    <Text style={s.cardTime}>{fmt(item.start_time)} – {fmt(item.end_time)}</Text>
                </View>
                <StatusBadge status={item.status} />
            </View>
            {isUpcoming && (
                <TouchableOpacity
                    style={s.cancelLink}
                    onPress={() => onCancel(item)}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel booking"
                >
                    <Text style={s.cancelLinkTxt}>Cancel booking</Text>
                </TouchableOpacity>
            )}
        </View>
    );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function ClientMyBookingsScreen() {
    const navigation = useNavigation<any>();

    const [bookings,   setBookings]   = useState<BookingSlot[]>([]);
    const [loading,    setLoading]    = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error,      setError]      = useState<string | null>(null);
    const [cancelling, setCancelling] = useState<string | null>(null);  // bookingId being cancelled

    // ── Data fetch ──────────────────────────────────────────────────────────────
    const loadBookings = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else           setLoading(true);
        setError(null);
        try {
            const { bookings: data } = await getClientBookings();
            // Sort: upcoming first, then by date desc
            const sorted = [...data].sort((a, b) => {
                const aUpcoming = a.status === 'booked' || a.status === 'confirmed';
                const bUpcoming = b.status === 'booked' || b.status === 'confirmed';
                if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
                return b.date.localeCompare(a.date);
            });
            setBookings(sorted);
        } catch (err: any) {
            setError(err.message ?? 'Failed to load bookings.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useFocusEffect(useCallback(() => { loadBookings(); }, [loadBookings]));

    // ── Cancel action ───────────────────────────────────────────────────────────
    const handleCancel = useCallback((item: BookingSlot) => {
        Alert.alert(
            'Cancel session?',
            `Cancel your session on ${fmtDate(item.date)} at ${fmt(item.start_time)}?`,
            [
                { text: 'Keep it', style: 'cancel' },
                {
                    text: 'Yes, cancel',
                    style: 'destructive',
                    onPress: async () => {
                        const bookingId = item._id ?? item.id;
                        setCancelling(bookingId);
                        try {
                            await clientCancelBooking(bookingId);
                            // Optimistic update
                            setBookings(prev =>
                                prev.map(b =>
                                    (b._id ?? b.id) === bookingId
                                        ? { ...b, status: 'cancelled' as any }
                                        : b
                                )
                            );
                        } catch (err: any) {
                            Alert.alert('Could not cancel', err.message ?? 'Please try again.');
                        } finally {
                            setCancelling(null);
                        }
                    },
                },
            ]
        );
    }, []);

    // ── States ─────────────────────────────────────────────────────────────────
    if (loading) {
        return (
            <SafeAreaView style={s.root} edges={['bottom']}>
                <View style={s.centred}>
                    <ActivityIndicator size="large" color={colors.accent} />
                    <Text style={s.hint}>Loading your bookings…</Text>
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
                    <TouchableOpacity style={s.retryBtn} onPress={() => loadBookings()}>
                        <Text style={s.retryTxt}>Try again</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={s.root} edges={['bottom']}>
            <FlatList
                data={bookings}
                keyExtractor={item => item._id ?? item.id}
                renderItem={({ item }) => (
                    <View style={cancelling === (item._id ?? item.id) ? s.cancelling : undefined}>
                        <BookingRow item={item} onCancel={handleCancel} />
                    </View>
                )}
                contentContainerStyle={[s.content, bookings.length === 0 && s.contentEmpty]}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={() => loadBookings(true)}
                        tintColor={colors.accent}
                    />
                }
                ListHeaderComponent={() =>
                    bookings.length > 0 ? (
                        <Text style={s.listHeader}>{bookings.length} booking{bookings.length !== 1 ? 's' : ''}</Text>
                    ) : null
                }
                ListEmptyComponent={() => (
                    <View style={s.emptyState}>
                        <Ionicons name="calendar-outline" size={56} color={colors.border} />
                        <Text style={s.emptyTitle}>No bookings yet</Text>
                        <Text style={s.emptyHint}>Book your first session to get started.</Text>
                        <TouchableOpacity
                            style={s.bookNowBtn}
                            onPress={() => navigation.goBack()}
                            accessibilityRole="button"
                            accessibilityLabel="Book a session"
                        >
                            <Text style={s.bookNowTxt}>Browse available sessions</Text>
                        </TouchableOpacity>
                    </View>
                )}
            />
        </SafeAreaView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    root:         { flex: 1, backgroundColor: colors.background },
    content:      { padding: spacing.base, paddingBottom: 40 },
    contentEmpty: { flex: 1 },
    cancelling:   { opacity: 0.5 },

    listHeader: {
        ...typography.caption,
        color:        colors.textSecondary,
        marginBottom: spacing.base,
    },

    // ── Booking card ──────────────────────────────────────────────────────────
    card: {
        backgroundColor: colors.surface,
        borderRadius:    radius.card,
        borderWidth:     1,
        borderColor:     colors.border,
        padding:         spacing.base,
        marginBottom:    spacing.sm,
        ...shadows.card,
    },
    cardTop:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    cardLeft: { flex: 1, gap: 2 },
    cardDate: { ...typography.label, fontWeight: '600', color: colors.textPrimary },
    cardTime: { ...typography.body,  color: colors.textSecondary },
    cancelLink: {
        marginTop:  spacing.sm,
        paddingTop: spacing.sm,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    cancelLinkTxt: {
        ...typography.caption,
        color: colors.errorText,
        fontWeight: '600',
    },

    // ── States ────────────────────────────────────────────────────────────────
    centred:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.base },
    hint:     { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
    errorTxt: { ...typography.body, color: colors.errorText, textAlign: 'center' },
    retryBtn: {
        backgroundColor: colors.accent,
        borderRadius:    radius.md,
        paddingHorizontal: spacing.xl,
        paddingVertical:   spacing.sm,
    },
    retryTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },

    emptyState: {
        flex: 1, alignItems: 'center', justifyContent: 'center',
        paddingTop: 80, gap: spacing.base, paddingHorizontal: spacing.xl,
    },
    emptyTitle:  { ...typography.h3, color: colors.textPrimary },
    emptyHint:   { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
    bookNowBtn:  {
        marginTop:       spacing.base,
        backgroundColor: colors.accent,
        borderRadius:    radius.card,
        paddingHorizontal: spacing.xl,
        paddingVertical:   spacing.base,
        ...shadows.card,
    },
    bookNowTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
