import React, { useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    Alert, ActivityIndicator, SafeAreaView, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { colors, typography, spacing, radius, shadows } from '../../theme/theme';
import { confirmPayment } from '../../services/apiClient';
import type { CoachStackParamList } from '../../navigation/CoachStackParamList';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

type NavProp  = NativeStackNavigationProp<CoachStackParamList, 'PaymentConfirm'>;
type RoutePropType = RouteProp<CoachStackParamList, 'PaymentConfirm'>;

// ─── Confirmation row ────────────────────────────────────────────────────────

function ConfirmRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
        <View style={styles.row}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={[styles.rowValue, accent && styles.rowValueAccent]}>{value}</Text>
        </View>
    );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function PaymentConfirmScreen() {
    const navigation = useNavigation<NavProp>();
    const route      = useRoute<RoutePropType>();
    const { paymentId, clientName, planName, amount } = route.params;

    const [confirming, setConfirming] = useState(false);
    const [done,       setDone]       = useState(false);
    const [result,     setResult]     = useState<{ sessions_remaining: number; expiry_date: string } | null>(null);

    const handleConfirm = async () => {
        Alert.alert(
            'Mark as Paid?',
            `Confirm you have received SGD ${amount} from ${clientName}. This will unlock their sessions immediately.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: '✓ Confirm Payment',
                    style: 'default',
                    onPress: async () => {
                        setConfirming(true);
                        try {
                            const res = await confirmPayment(paymentId);
                            setResult({ sessions_remaining: res.sessions_remaining, expiry_date: res.expiry_date });
                            setDone(true);
                        } catch (err: any) {
                            if (err.message?.includes('already confirmed')) {
                                Alert.alert('Already confirmed', 'This payment has already been marked as paid.');
                                setDone(true);
                            } else {
                                Alert.alert('Error', err.message ?? 'Could not confirm payment. Please try again.');
                            }
                        } finally {
                            setConfirming(false);
                        }
                    },
                },
            ]
        );
    };

    // ── Success state ────────────────────────────────────────────────────────

    if (done && result) {
        const expiryFormatted = new Date(`${result.expiry_date}T00:00:00`).toLocaleDateString('en-SG', {
            day: 'numeric', month: 'short', year: 'numeric'
        });
        return (
            <SafeAreaView style={styles.centered}>
                <View style={styles.successIcon}>
                    <Ionicons name="checkmark-circle" size={72} color="#22C55E" />
                </View>
                <Text style={styles.successTitle}>Payment Confirmed! 🎉</Text>
                <Text style={styles.successSub}>Sessions are now active for {clientName}</Text>

                <View style={styles.successCard}>
                    <ConfirmRow label="Plan"             value={planName} />
                    <ConfirmRow label="Sessions Granted" value={`${result.sessions_remaining} sessions`} accent />
                    <ConfirmRow label="Valid Until"      value={expiryFormatted} />
                </View>

                <TouchableOpacity
                    style={styles.doneButton}
                    onPress={() => navigation.popToTop()}
                >
                    <Text style={styles.doneLabel}>Back to Clients</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    // ── Pre-confirmation state ────────────────────────────────────────────────

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

                {/* ── Pending badge ── */}
                <View style={styles.pendingBadge}>
                    <Ionicons name="time-outline" size={16} color="#F59E0B" />
                    <Text style={styles.pendingBadgeText}>Awaiting Payment Confirmation</Text>
                </View>

                {/* ── Summary card ── */}
                <View style={styles.summaryCard}>
                    <Text style={styles.summaryCardTitle}>Payment Summary</Text>

                    <ConfirmRow label="Client"   value={clientName} />
                    <ConfirmRow label="Package"  value={planName} />
                    <View style={styles.divider} />
                    <ConfirmRow label="Amount Due" value={`SGD ${amount}`} accent />
                </View>

                {/* ── Instructions ── */}
                <View style={styles.instructionBox}>
                    <Text style={styles.instructionTitle}>How to confirm:</Text>
                    <Text style={styles.instructionStep}>1. Collect SGD {amount} from {clientName}</Text>
                    <Text style={styles.instructionStep}>2. Tap "Mark as Paid" below</Text>
                    <Text style={styles.instructionStep}>3. Sessions unlock immediately</Text>
                </View>

                {/* ── Mark as Paid ── */}
                <TouchableOpacity
                    style={[styles.ctaButton, confirming && styles.ctaDisabled]}
                    onPress={handleConfirm}
                    disabled={confirming}
                    activeOpacity={0.85}
                >
                    {confirming ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <>
                            <Ionicons name="checkmark-done-circle-outline" size={22} color="#fff" />
                            <Text style={styles.ctaLabel}>Mark as Paid — SGD {amount}</Text>
                        </>
                    )}
                </TouchableOpacity>

                <Text style={styles.disclaimer}>
                    ⓘ Only tap after you have received the payment. This action assigns sessions to {clientName} immediately.
                </Text>

            </ScrollView>
        </SafeAreaView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.xl },
    scroll:    { padding: spacing.md, paddingBottom: spacing.xxl },

    pendingBadge: {
        flexDirection:   'row',
        alignItems:      'center',
        gap:             spacing.xs,
        backgroundColor: '#FFF7ED',
        borderWidth:     1,
        borderColor:     '#FDE68A',
        borderRadius:    radius.pill,
        alignSelf:       'flex-start',
        paddingHorizontal: spacing.md,
        paddingVertical:   spacing.xs,
        marginBottom:    spacing.lg,
    },
    pendingBadgeText: { ...typography.label, color: '#92400E' },

    summaryCard: {
        backgroundColor: colors.surface,
        borderRadius:    radius.cardLg,
        padding:         spacing.md,
        marginBottom:    spacing.md,
        ...shadows.cardElevated,
    },
    summaryCardTitle: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.md },

    row:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs },
    rowLabel: { ...typography.body, color: colors.textSecondary },
    rowValue: { ...typography.label, color: colors.textPrimary },
    rowValueAccent: { ...typography.h2, color: colors.accent },

    divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },

    instructionBox: {
        backgroundColor: colors.accentSubtle,
        borderRadius:    radius.md,
        padding:         spacing.md,
        marginBottom:    spacing.lg,
        gap:             spacing.xs,
    },
    instructionTitle: { ...typography.label, color: colors.accent, marginBottom: 4 },
    instructionStep:  { ...typography.body, color: colors.textPrimary },

    ctaButton: {
        flexDirection:   'row',
        alignItems:      'center',
        justifyContent:  'center',
        gap:             spacing.sm,
        backgroundColor: '#22C55E',
        borderRadius:    radius.card,
        paddingVertical: spacing.md,
        marginBottom:    spacing.md,
    },
    ctaDisabled: { opacity: 0.5 },
    ctaLabel:    { ...typography.h3, color: '#fff' },

    disclaimer: {
        ...typography.caption,
        color:      colors.textSecondary,
        textAlign:  'center',
        lineHeight: 18,
        paddingHorizontal: spacing.md,
    },

    // Success
    successIcon:  { marginBottom: spacing.md },
    successTitle: { ...typography.h1, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.xs },
    successSub:   { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl },
    successCard:  {
        width: '100%',
        backgroundColor: colors.surface,
        borderRadius:    radius.cardLg,
        padding:         spacing.md,
        marginBottom:    spacing.xl,
        ...shadows.card,
    },
    doneButton: {
        backgroundColor: colors.buttonPrimaryBg,
        borderRadius:    radius.card,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.xl,
    },
    doneLabel: { ...typography.h3, color: '#fff' },
});
