import React, { useCallback, useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, Modal, TouchableOpacity,
    TextInput, Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, shadows } from '../theme/theme';
import { createBooking, getClientStatus, quickBook } from '../services/apiClient';
import { ClientStatusItem } from '../types';

interface Props {
    visible: boolean;
    onClose: () => void;
    onBooked: () => void;               // refresh parent dashboard
    preselectedClientId?:   string;     // optional — set from client card
    preselectedClientName?: string;
    preselectedStartTime?:  string;     // optional — pre-fill start time from available slot (HH:MM)
    preselectedEndTime?:    string;     // session end, so a 45 or 90 minute slot is not stretched to an hour
    preselectedSlotId?:     string;     // book this existing slot instead of creating another one
    preselectedDate?:       string;     // optional — YYYY-MM-DD from BookingScreen date strip
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

function todaySGT(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

function padTime(val: string): string {
    // Accepts "9", "9:30", "930" → normalises to "09:30"
    const cleaned = val.replace(/\D/g, '');
    if (cleaned.length <= 2) return cleaned.padStart(2, '0') + ':00';
    const h = cleaned.slice(0, cleaned.length - 2).padStart(2, '0');
    const m = cleaned.slice(-2);
    return `${h}:${m}`;
}

function addHour(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const end = new Date(0, 0, 0, h + 1, m);
    return `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
}

/** Same sentence as the server when this client cannot take another booking. */
function sessionsLeftMessage(clientName: string | undefined): string {
    const who = clientName?.trim() ? clientName.trim() : 'This client';
    return `${who} has 0 sessions left. Booking needs a new plan.`;
}

function canBookClient(client: ClientStatusItem): boolean {
    return (client.sessions_remaining ?? 0) > 0;
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export default function QuickBookModal({ visible, onClose, onBooked, preselectedClientId, preselectedClientName, preselectedStartTime, preselectedEndTime, preselectedSlotId, preselectedDate }: Props) {
    const [clients,      setClients]      = useState<ClientStatusItem[]>([]);
    const [clientSearch, setClientSearch] = useState('');
    const [selectedId,   setSelectedId]   = useState(preselectedClientId ?? '');
    const [selectedName, setSelectedName] = useState(preselectedClientName ?? '');
    const [date,         setDate]         = useState(preselectedDate ?? todaySGT());
    const [startTime,    setStartTime]    = useState('09:00');
    const [endTime,      setEndTime]      = useState('10:00');
    const [notes,        setNotes]        = useState('');
    const [slotId,       setSlotId]       = useState<string | undefined>(preselectedSlotId);
    const [loadingClients, setLoadingClients] = useState(false);
    const [submitting,   setSubmitting]   = useState(false);

    // Reset form on each open.
    // If a date was passed from the BookingScreen date strip, pre-fill it.
    // If a start time was passed in (tap-to-book from an available slot),
    // pre-fill start + auto-compute end. Falls back to 09:00/10:00 otherwise.
    useEffect(() => {
        if (!visible) return;
        setSelectedId(preselectedClientId ?? '');
        setSelectedName(preselectedClientName ?? '');
        setDate(preselectedDate ?? todaySGT());
        const resolvedStart = preselectedStartTime ?? '09:00';
        setStartTime(resolvedStart);
        setEndTime(preselectedEndTime ?? addHour(resolvedStart));
        setSlotId(preselectedSlotId);
        setNotes('');
        setClientSearch('');

        setLoadingClients(true);
        getClientStatus()
            .then(r => setClients(r.clients))
            .catch(() => setClients([]))
            .finally(() => setLoadingClients(false));
    }, [visible, preselectedClientId, preselectedClientName, preselectedStartTime, preselectedEndTime, preselectedSlotId, preselectedDate]);

    const filteredClients = clientSearch.trim()
        ? clients.filter(c => c.clientName.toLowerCase().includes(clientSearch.toLowerCase()))
        : clients;
    const bookableClients = filteredClients.filter(canBookClient);
    const blockedClients = filteredClients.filter(c => !canBookClient(c));
    const visibleClients = [...bookableClients.slice(0, 6), ...blockedClients.slice(0, 6)];
    const selectedClient = clients.find(c => c.clientId === selectedId);
    const selectedBlocked = !!selectedClient && !canBookClient(selectedClient);

    const handleSelectClient = (c: ClientStatusItem) => {
        setSelectedId(c.clientId);
        setSelectedName(c.clientName);
        setClientSearch('');
    };

    const handleStartBlur = () => {
        const normalised = padTime(startTime);
        setStartTime(normalised);
        if (preselectedSlotId && normalised !== preselectedStartTime) {
            setSlotId(undefined);
            setEndTime(addHour(normalised));
        } else if (!preselectedEndTime) {
            setEndTime(addHour(normalised));
        }
    };

    const handleSubmit = async () => {
        if (!selectedId) { Alert.alert('Select a client', 'Please choose a client before booking.'); return; }
        if (selectedBlocked) {
            Alert.alert('Cannot book', sessionsLeftMessage(selectedClient?.clientName || selectedName));
            return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert('Invalid date', 'Use format YYYY-MM-DD.'); return; }
        if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
            Alert.alert('Invalid time', 'Use format HH:MM (e.g. 09:00).');
            return;
        }
        if (startTime >= endTime) { Alert.alert('Invalid time', 'End time must be after start time.'); return; }

        setSubmitting(true);
        try {
            const note = notes.trim() || undefined;
            if (slotId) {
                await createBooking({ client_id: selectedId, availability_slot_id: slotId, notes: note });
            } else {
                await quickBook({ client_id: selectedId, date, start_time: startTime, end_time: endTime, notes: note });
            }
            onBooked();
            onClose();
        } catch (err: any) {
            const msg = err.message ?? 'Could not create booking. Please try again.';
            Alert.alert('Booking Failed', msg);
        } finally {
            setSubmitting(false);
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} />
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.sheet}
            >
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.title}>Quick Book</Text>
                    <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Ionicons name="close" size={22} color={colors.textSecondary} />
                    </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

                    {/* ── Client ── */}
                    <Text style={styles.label}>CLIENT</Text>
                    {selectedId ? (
                        <>
                            <TouchableOpacity
                                style={styles.selectedClient}
                                onPress={() => { setSelectedId(''); setSelectedName(''); }}
                            >
                                <Ionicons name="person-circle-outline" size={20} color={colors.accent} />
                                <Text style={styles.selectedClientName}>{selectedName}</Text>
                                <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                            </TouchableOpacity>
                            {selectedBlocked && (
                                <Text style={styles.clientBlockedMessage}>
                                    {sessionsLeftMessage(selectedClient?.clientName || selectedName)}
                                </Text>
                            )}
                        </>
                    ) : (
                        <>
                            <TextInput
                                style={styles.input}
                                value={clientSearch}
                                onChangeText={setClientSearch}
                                placeholder="Search client name…"
                                placeholderTextColor={colors.placeholder}
                                autoCapitalize="words"
                            />
                            {loadingClients && <ActivityIndicator size="small" color={colors.accent} style={{ marginVertical: spacing.sm }} />}
                            {visibleClients.map(c => {
                                const bookable = canBookClient(c);
                                return (
                                    <TouchableOpacity
                                        key={c.clientId}
                                        style={[styles.clientRow, !bookable && styles.clientRowBlocked]}
                                        onPress={() => { if (bookable) handleSelectClient(c); }}
                                        disabled={!bookable}
                                        accessibilityState={{ disabled: !bookable }}
                                    >
                                        <View style={styles.clientRowText}>
                                            <Text style={[styles.clientRowName, !bookable && styles.clientRowNameBlocked]}>
                                                {c.clientName}
                                            </Text>
                                            {!bookable && (
                                                <Text style={styles.clientBlockedMessage}>
                                                    {sessionsLeftMessage(c.clientName)}
                                                </Text>
                                            )}
                                        </View>
                                        {bookable && (
                                            <Text style={styles.clientRowSessions}>{c.sessions_remaining ?? 0} sessions left</Text>
                                        )}
                                    </TouchableOpacity>
                                );
                            })}
                            {!loadingClients && clients.length === 0 && (
                                <Text style={styles.noClientsText}>No clients with active sessions found.</Text>
                            )}
                        </>
                    )}

                    {/* ── Date ── */}
                    <Text style={styles.label}>DATE</Text>
                    <TextInput
                        style={styles.input}
                        value={date}
                        onChangeText={setDate}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={colors.placeholder}
                        keyboardType="numbers-and-punctuation"
                        maxLength={10}
                    />

                    {/* ── Time ── */}
                    <View style={styles.timeRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.label}>START</Text>
                            <TextInput
                                style={styles.input}
                                value={startTime}
                                onChangeText={setStartTime}
                                onBlur={handleStartBlur}
                                placeholder="09:00"
                                placeholderTextColor={colors.placeholder}
                                keyboardType="numbers-and-punctuation"
                                maxLength={5}
                            />
                        </View>
                        <View style={styles.timeSep}>
                            <Text style={styles.timeSepText}>→</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.label}>END</Text>
                            <TextInput
                                style={styles.input}
                                value={endTime}
                                onChangeText={setEndTime}
                                placeholder="10:00"
                                placeholderTextColor={colors.placeholder}
                                keyboardType="numbers-and-punctuation"
                                maxLength={5}
                            />
                        </View>
                    </View>

                    {/* ── Notes ── */}
                    <Text style={styles.label}>NOTES (optional)</Text>
                    <TextInput
                        style={[styles.input, styles.inputMultiline]}
                        value={notes}
                        onChangeText={setNotes}
                        placeholder="e.g. focus on upper body"
                        placeholderTextColor={colors.placeholder}
                        multiline
                        numberOfLines={2}
                    />

                    {/* ── CTA ── */}
                    <TouchableOpacity
                        style={[styles.bookButton, (submitting || selectedBlocked) && { opacity: 0.5 }]}
                        onPress={handleSubmit}
                        disabled={submitting || selectedBlocked}
                        activeOpacity={0.85}
                    >
                        {submitting
                            ? <ActivityIndicator color="#fff" />
                            : <>
                                <Ionicons name="calendar-outline" size={18} color="#fff" />
                                <Text style={styles.bookButtonLabel}>Confirm Booking</Text>
                              </>
                        }
                    </TouchableOpacity>

                    <Text style={styles.disclaimer}>
                        Sessions deducted only when the booking is marked Complete.
                    </Text>
                </ScrollView>
            </KeyboardAvoidingView>
        </Modal>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
    },
    sheet: {
        backgroundColor:  colors.surface,
        borderTopLeftRadius:  24,
        borderTopRightRadius: 24,
        paddingHorizontal: spacing.lg,
        paddingTop:        spacing.md,
        paddingBottom:     spacing.xxl,
        maxHeight:         '85%',
        ...shadows.cardElevated,
    },
    header: {
        flexDirection:   'row',
        justifyContent:  'space-between',
        alignItems:      'center',
        marginBottom:    spacing.lg,
        paddingTop:      spacing.xs,
    },
    title: { ...typography.h2, color: colors.textPrimary },

    label: {
        ...typography.micro,
        color:         colors.textSecondary,
        letterSpacing: 1,
        marginBottom:  spacing.xs,
        marginTop:     spacing.md,
    },
    input: {
        backgroundColor:   colors.background,
        borderWidth:       1,
        borderColor:       colors.border,
        borderRadius:      radius.input,
        paddingHorizontal: spacing.md,
        paddingVertical:   spacing.sm,
        ...typography.body,
        color:             colors.textPrimary,
    },
    inputMultiline: { minHeight: 60, textAlignVertical: 'top', paddingTop: spacing.sm },

    selectedClient: {
        flexDirection:  'row',
        alignItems:     'center',
        gap:            spacing.sm,
        backgroundColor: colors.accentSubtle,
        borderRadius:   radius.md,
        padding:        spacing.md,
    },
    selectedClientName: { ...typography.label, color: colors.accent, flex: 1 },

    clientRow: {
        flexDirection:   'row',
        justifyContent:  'space-between',
        alignItems:      'center',
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    clientRowBlocked: {
        alignItems: 'flex-start',
        backgroundColor: '#F3F4F6',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRadius: 10,
        marginTop: 4,
    },
    clientRowText: { flex: 1, paddingRight: spacing.sm },
    clientRowName:     { ...typography.body, color: colors.textPrimary },
    clientRowNameBlocked: { color: '#6B7280' },
    clientRowSessions: { ...typography.caption, color: colors.textSecondary },
    clientBlockedMessage: { ...typography.caption, color: '#6B7280', marginTop: 2 },
    noClientsText:     { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginVertical: spacing.md },

    timeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
    timeSep: { paddingBottom: spacing.sm + 4, alignSelf: 'flex-end' },
    timeSepText: { ...typography.h3, color: colors.textSecondary },

    bookButton: {
        flexDirection:   'row',
        alignItems:      'center',
        justifyContent:  'center',
        gap:             spacing.sm,
        backgroundColor: colors.buttonPrimaryBg,
        borderRadius:    radius.card,
        paddingVertical: spacing.md,
        marginTop:       spacing.lg,
    },
    bookButtonLabel: { ...typography.h3, color: '#fff' },

    disclaimer: {
        ...typography.caption,
        color:      colors.textSecondary,
        textAlign:  'center',
        marginTop:  spacing.md,
        lineHeight: 18,
    },
});
