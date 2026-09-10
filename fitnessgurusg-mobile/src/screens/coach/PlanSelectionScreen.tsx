import React, { useCallback, useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, FlatList, TouchableOpacity,
    TextInput, Alert, ActivityIndicator, ScrollView, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, typography, spacing, radius, shadows } from '../../theme/theme';
import { getPlans, initiatePaymentRequest } from '../../services/apiClient';
import { SessionPlanCatalogue, PaymentMethod } from '../../types';

// ─── Navigation types ────────────────────────────────────────────────────────
// CoachStackParamList lives in navigation/CoachStackParamList.ts
// Re-exported here for backward compatibility with existing imports.
export type { CoachStackParamList } from '../../navigation/CoachStackParamList';
import type { CoachStackParamList } from '../../navigation/CoachStackParamList';

type NavProp = NativeStackNavigationProp<CoachStackParamList, 'PlanSelection'>;
type RoutePropType = RouteProp<CoachStackParamList, 'PlanSelection'>;



// ─── Plan Card ───────────────────────────────────────────────────────────────

const METHOD_OPTIONS: { key: PaymentMethod; label: string; icon: string }[] = [
    { key: 'paynow',        label: 'PayNow',        icon: 'phone-portrait-outline' },
    { key: 'bank_transfer', label: 'Bank Transfer',  icon: 'business-outline' },
    { key: 'cash',          label: 'Cash',           icon: 'cash-outline' },
    { key: 'other',         label: 'Other',          icon: 'ellipsis-horizontal-outline' },
];

function PlanCard({
    plan,
    selected,
    onSelect,
}: {
    plan: SessionPlanCatalogue;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <TouchableOpacity
            style={[styles.planCard, selected && { borderColor: plan.badge_color, borderWidth: 2 }]}
            onPress={onSelect}
            activeOpacity={0.8}
        >
            <View style={[styles.planAccent, { backgroundColor: plan.badge_color }]} />
            <View style={styles.planBody}>
                <View style={styles.planHeader}>
                    <Text style={styles.planName}>{plan.name}</Text>
                    {selected && (
                        <Ionicons name="checkmark-circle" size={22} color={plan.badge_color} />
                    )}
                </View>
                <Text style={styles.planDescription}>{plan.description}</Text>
                <View style={styles.planFooter}>
                    <Text style={[styles.planPrice, { color: plan.badge_color }]}>
                        SGD {plan.price_sgd.toLocaleString()}
                    </Text>
                    <Text style={styles.planValidity}>
                        {plan.description}
                    </Text>
                </View>
            </View>
        </TouchableOpacity>
    );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function PlanSelectionScreen() {
    const navigation = useNavigation<NavProp>();
    const route      = useRoute<RoutePropType>();
    const { clientId, clientName } = route.params;

    const [plans,        setPlans]        = useState<SessionPlanCatalogue[]>([]);
    const [selectedPlan, setSelectedPlan] = useState<SessionPlanCatalogue | null>(null);
    const [method,       setMethod]       = useState<PaymentMethod>('paynow');
    const [reference,    setReference]    = useState('');
    const [notes,        setNotes]        = useState('');
    const [loading,      setLoading]      = useState(true);
    const [submitting,   setSubmitting]   = useState(false);

    useEffect(() => {
        getPlans()
            .then(r => setPlans(r.plans as SessionPlanCatalogue[]))
            .catch(() => Alert.alert('Error', 'Could not load plans. Please try again.'))
            .finally(() => setLoading(false));
    }, []);

    const handleInitiate = useCallback(async () => {
        if (!selectedPlan) {
            Alert.alert('Select a plan', 'Please choose a session package before continuing.');
            return;
        }
        setSubmitting(true);
        try {
            const result = await initiatePaymentRequest({
                client_id:      clientId,
                plan_id:        selectedPlan.id,
                payment_method: method,
                reference:      reference.trim() || undefined,
                notes:          notes.trim() || undefined,
            });
            navigation.replace('PaymentConfirm', {
                paymentId:  result.payment._id,
                clientName,
                planName:   selectedPlan.name,
                amount:     selectedPlan.price_sgd,
            });
        } catch (err: any) {
            Alert.alert('Error', err.message ?? 'Could not initiate payment. Please try again.');
        } finally {
            setSubmitting(false);
        }
    }, [selectedPlan, method, reference, notes, clientId, clientName, navigation]);

    if (loading) {
        return (
            <SafeAreaView style={styles.centered}>
                <ActivityIndicator size="large" color={colors.accent} />
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

                {/* ── Header ── */}
                <Text style={styles.heading}>Assign Session Package</Text>
                <Text style={styles.subheading}>for {clientName}</Text>

                {/* ── Plan Cards ── */}
                <Text style={styles.sectionLabel}>CHOOSE A PACKAGE</Text>
                {plans.map(plan => (
                    <PlanCard
                        key={plan.id}
                        plan={plan}
                        selected={selectedPlan?.id === plan.id}
                        onSelect={() => setSelectedPlan(plan)}
                    />
                ))}

                {/* ── Payment Method ── */}
                <Text style={styles.sectionLabel}>PAYMENT METHOD</Text>
                <View style={styles.methodRow}>
                    {METHOD_OPTIONS.map(opt => (
                        <TouchableOpacity
                            key={opt.key}
                            style={[styles.methodChip, method === opt.key && styles.methodChipActive]}
                            onPress={() => setMethod(opt.key)}
                            activeOpacity={0.8}
                        >
                            <Ionicons
                                name={opt.icon as any}
                                size={16}
                                color={method === opt.key ? '#fff' : colors.textSecondary}
                            />
                            <Text style={[styles.methodChipLabel, method === opt.key && styles.methodChipLabelActive]}>
                                {opt.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* ── Reference (optional) ── */}
                <Text style={styles.sectionLabel}>REFERENCE / RECEIPT NO. (optional)</Text>
                <TextInput
                    style={styles.input}
                    value={reference}
                    onChangeText={setReference}
                    placeholder="e.g. TX123456, receipt number"
                    placeholderTextColor={colors.placeholder}
                    autoCapitalize="characters"
                />

                {/* ── Notes (optional) ── */}
                <Text style={styles.sectionLabel}>NOTES (optional)</Text>
                <TextInput
                    style={[styles.input, styles.inputMultiline]}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Internal notes for this payment"
                    placeholderTextColor={colors.placeholder}
                    multiline
                    numberOfLines={3}
                />

                {/* ── Summary Banner ── */}
                {selectedPlan && (
                    <View style={styles.summaryBanner}>
                        <Text style={styles.summaryLabel}>Total</Text>
                        <Text style={styles.summaryAmount}>SGD {selectedPlan.price_sgd.toLocaleString()}</Text>
                        <Text style={styles.summaryDetails}>
                            {selectedPlan.description}
                        </Text>
                    </View>
                )}

                {/* ── CTA ── */}
                <TouchableOpacity
                    style={[styles.ctaButton, (!selectedPlan || submitting) && styles.ctaDisabled]}
                    onPress={handleInitiate}
                    disabled={!selectedPlan || submitting}
                    activeOpacity={0.85}
                >
                    {submitting ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <>
                            <Ionicons name="arrow-forward-circle-outline" size={20} color="#fff" />
                            <Text style={styles.ctaLabel}>Continue to Confirm Payment</Text>
                        </>
                    )}
                </TouchableOpacity>

                <Text style={styles.disclaimer}>
                    ⓘ Collect payment from client first. Tap "Mark as Paid" on the next screen to unlock their sessions.
                </Text>

            </ScrollView>
        </SafeAreaView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container:  { flex: 1, backgroundColor: colors.background },
    centered:   { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    scroll:     { padding: spacing.md, paddingBottom: spacing.xxl },

    heading:    { ...typography.h1, color: colors.textPrimary, marginBottom: 2 },
    subheading: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },

    sectionLabel: {
        ...typography.micro,
        color:         colors.textSecondary,
        letterSpacing: 1,
        marginBottom:  spacing.sm,
        marginTop:     spacing.lg,
    },

    // Plan cards
    planCard: {
        flexDirection:   'row',
        backgroundColor: colors.surface,
        borderRadius:    radius.card,
        marginBottom:    spacing.sm,
        overflow:        'hidden',
        borderWidth:     1.5,
        borderColor:     colors.border,
        ...shadows.card,
    },
    planAccent: { width: 5 },
    planBody:   { flex: 1, padding: spacing.md },
    planHeader: {
        flexDirection:  'row',
        justifyContent: 'space-between',
        alignItems:     'center',
        marginBottom:   4,
    },
    planName:        { ...typography.h3, color: colors.textPrimary },
    planDescription: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.sm },
    planFooter:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    planPrice:       { ...typography.h2 },
    planValidity:    { ...typography.caption, color: colors.textSecondary },

    // Method chips
    methodRow: {
        flexDirection: 'row',
        flexWrap:      'wrap',
        gap:           spacing.xs,
        marginBottom:  spacing.sm,
    },
    methodChip: {
        flexDirection:  'row',
        alignItems:     'center',
        gap:            6,
        paddingVertical:   spacing.xs,
        paddingHorizontal: spacing.sm,
        borderRadius:   radius.pill,
        borderWidth:    1,
        borderColor:    colors.border,
        backgroundColor: colors.surface,
    },
    methodChipActive:      { backgroundColor: colors.buttonPrimaryBg, borderColor: colors.buttonPrimaryBg },
    methodChipLabel:       { ...typography.label, color: colors.textSecondary },
    methodChipLabelActive: { color: '#fff' },

    // Inputs
    input: {
        backgroundColor:  colors.surface,
        borderWidth:      1,
        borderColor:      colors.border,
        borderRadius:     radius.input,
        paddingHorizontal: spacing.md,
        paddingVertical:  spacing.sm,
        ...typography.body,
        color:            colors.textPrimary,
        marginBottom:     spacing.sm,
    },
    inputMultiline: { height: 80, textAlignVertical: 'top', paddingTop: spacing.sm },

    // Summary banner
    summaryBanner: {
        backgroundColor:  colors.statBg,
        borderRadius:     radius.card,
        padding:          spacing.md,
        alignItems:       'center',
        marginVertical:   spacing.md,
    },
    summaryLabel:   { ...typography.caption, color: 'rgba(255,255,255,0.7)', marginBottom: 2 },
    summaryAmount:  { ...typography.displayLg, color: '#fff' },
    summaryDetails: { ...typography.body, color: 'rgba(255,255,255,0.8)', marginTop: 4 },

    // CTA
    ctaButton: {
        flexDirection:     'row',
        alignItems:        'center',
        justifyContent:    'center',
        gap:               spacing.sm,
        backgroundColor:   colors.buttonPrimaryBg,
        borderRadius:      radius.card,
        paddingVertical:   spacing.md,
        marginBottom:      spacing.md,
    },
    ctaDisabled: { opacity: 0.5 },
    ctaLabel:    { ...typography.h3, color: '#fff' },

    disclaimer: {
        ...typography.caption,
        color:       colors.textSecondary,
        textAlign:   'center',
        paddingHorizontal: spacing.md,
        lineHeight:  18,
        marginBottom: spacing.xl,
    },
});
