/**
 * ClientPlanScreen — client's view of their plan lifecycle.
 *
 * State machine:
 *   none             → Show catalogue → user selects → POST /clients/select-plan          → 'selected'
 *   selected         → Show selected plan + Pay button → POST /payments/client-create     → 'payment_pending'
 *   payment_pending  → POST /payments/client-confirm (SimulatedProvider = immediate)      → 'active'
 *   active           → Show active plan progress (sessions remaining, expiry)
 *                       + "Upgrade or Renew" button → opens inline plan catalogue
 *   expired          → Show expired + option to select new plan
 *
 * All data is fetched from: GET /api/clients/me/plan
 * Payment (simulated): create → confirm in one user action ("Pay Now" button)
 */

import React, { useCallback, useRef, useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView,
    ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
    getMyPlan,
    selectPlan,
    clientCreatePayment,
    clientConfirmPayment,
    getPlans,
} from '../../services/apiClient';
import { colors, spacing, radius, typography, shadows } from '../../theme/theme';
import StatusBadge from '../../components/StatusBadge';

// ─── Types ────────────────────────────────────────────────────────────────────

type PlanStatus = 'none' | 'selected' | 'payment_pending' | 'active' | 'expired' | 'cancelled';

interface PlanCatalogue {
    id: string;
    name: string;
    sessions: number;
    price_sgd: number;
    description: string;
    badge_color: string;
}

interface ActivePlan {
    plan_name: string;
    sessions_total: number;
    sessions_used: number;
    sessions_remaining: number;
    start_date: string;
    expiry_date: string;
    status: string;
}

// ─── Plan info card (catalogue item) ─────────────────────────────────────────

function PlanCard({
    plan,
    selected,
    onSelect,
    disabled,
}: {
    plan: PlanCatalogue;
    selected: boolean;
    onSelect: () => void;
    disabled: boolean;
}) {
    return (
        <TouchableOpacity
            style={[pc.card, selected && pc.cardSelected]}
            onPress={onSelect}
            disabled={disabled}
            activeOpacity={0.80}
            accessibilityRole="button"
            accessibilityLabel={`Select ${plan.name}`}
        >
            <View style={[pc.dot, { backgroundColor: plan.badge_color }]} />
            <View style={pc.body}>
                <Text style={pc.name}>{plan.name}</Text>
                <Text style={pc.desc}>{plan.description}</Text>
            </View>
            {/* priceWrap holds the price + optional checkmark as a unit */}
            <View style={pc.priceWrap}>
                <Text style={pc.price} numberOfLines={1}>
                    SGD {plan.price_sgd.toLocaleString()}
                </Text>
                {selected && (
                    <View style={pc.checkMark}>
                        <Text style={pc.checkTxt}>✓</Text>
                    </View>
                )}
            </View>
        </TouchableOpacity>
    );
}

const pc = StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1.5,
        borderColor: colors.border,
        padding: spacing.base,
        marginBottom: spacing.sm,
        gap: spacing.sm,
        ...shadows.card,
    },
    cardSelected: {
        borderColor: colors.accent,
        backgroundColor: colors.accentSubtle,
    },
    dot: { width: 10, height: 10, borderRadius: 5 },
    // body takes all remaining space; minWidth:0 lets it shrink below its content width
    // without pushing the price container off-screen
    body: { flex: 1, minWidth: 0 },
    name: { ...typography.bodyLg, color: colors.textPrimary, fontWeight: '700', marginBottom: 2 },
    desc: { ...typography.micro, color: colors.textSecondary, lineHeight: 16 },
    // priceWrap: fixed right section that never shrinks.
    // minWidth 120 comfortably fits "SGD 1,900" at h3 size plus the 22px tick with gap.
    // flexShrink:0 prevents the row's flex algorithm from squeezing it.
    priceWrap: {
        flexShrink: 0,
        minWidth: 120,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 6,
    },
    price: {
        ...typography.h3,
        color: colors.textPrimary,
        fontWeight: '800',
        includeFontPadding: false,   // Android: remove extra internal padding that causes clipping
        flexShrink: 0,               // never let the price number itself shrink
    },
    checkMark: {
        width: 22, height: 22, borderRadius: 11,
        backgroundColor: colors.accent,
        alignItems: 'center', justifyContent: 'center',
    },
    checkTxt: { color: '#fff', fontWeight: '800', fontSize: 12 },
});

// ─── Active plan progress card ────────────────────────────────────────────────

function daysLeft(iso: string): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exp = new Date(`${iso}T00:00:00`);
    exp.setHours(0, 0, 0, 0);
    return Math.round((exp.getTime() - today.getTime()) / 86_400_000);
}

function ActivePlanCard({ plan }: { plan: ActivePlan }) {
    const pct = plan.sessions_total > 0
        ? (plan.sessions_used / plan.sessions_total) * 100
        : 0;
    const leftDays = daysLeft(plan.expiry_date);
    const expiring = leftDays >= 0 && leftDays <= 14;

    return (
        <View style={ap.card}>
            <View style={ap.topRow}>
                <View style={{ flex: 1 }}>
                    <Text style={ap.kicker}>Your plan</Text>
                    <Text style={ap.planName}>{plan.plan_name}</Text>
                </View>
                <StatusBadge variant={expiring ? 'expiringSoon' : 'activePlan'} />
            </View>

            <View style={ap.progressRow}>
                <View style={[ap.ring, expiring && ap.ringSoon]}>
                    <Text style={ap.ringNum}>{plan.sessions_remaining}</Text>
                    <Text style={ap.ringLabel}>sessions left</Text>
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={ap.progressLabel}>Sessions used</Text>
                    <Text style={ap.progressCount}>
                        {plan.sessions_used} of {plan.sessions_total}
                    </Text>
                    <View style={ap.bar}>
                        <View style={[ap.fill, expiring && ap.fillSoon, { width: `${Math.min(pct, 100)}%` as any }]} />
                    </View>
                    <Text style={ap.remaining}>
                        {leftDays >= 0 ? `${leftDays} day${leftDays === 1 ? '' : 's'} left on this plan` : 'This plan has ended'}
                    </Text>
                </View>
            </View>

            <View style={ap.dates}>
                <View style={ap.dateItem}>
                    <Text style={ap.dateLabel}>Started</Text>
                    <Text style={ap.dateValue}>{fmtDate(plan.start_date)}</Text>
                </View>
                <View style={ap.dateDivider} />
                <View style={ap.dateItem}>
                    <Text style={ap.dateLabel}>Expires</Text>
                    <Text style={ap.dateValue}>{fmtDate(plan.expiry_date)}</Text>
                </View>
            </View>
        </View>
    );
}

function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

const ap = StyleSheet.create({
    card: {
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        padding: spacing.base,
        marginBottom: spacing.md,
        ...shadows.card,
    },
    topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
    kicker: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5, color: colors.textSecondary, textTransform: 'uppercase' },
    planName:    { ...typography.h2, color: colors.textPrimary, marginTop: 2 },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.base, marginTop: spacing.base },
    ring: {
        width: 96, height: 96, borderRadius: 48,
        borderWidth: 8, borderColor: colors.accent,
        alignItems: 'center', justifyContent: 'center',
    },
    ringSoon: { borderColor: colors.amberText },
    ringNum: { ...typography.h2, color: colors.textPrimary },
    ringLabel: { fontSize: 10, color: colors.textSecondary, textAlign: 'center' },
    progressLabel:   { ...typography.caption, color: colors.textSecondary },
    progressCount:   { ...typography.h3, color: colors.textPrimary, marginTop: 2 },
    bar: {
        height: 8,
        backgroundColor: colors.border,
        borderRadius: 4,
        overflow: 'hidden',
        marginBottom: spacing.xs,
    },
    fill: {
        height: '100%',
        backgroundColor: colors.accent,
        borderRadius: 4,
    },
    fillSoon: { backgroundColor: colors.amberText },
    remaining:    { ...typography.body,  color: colors.textSecondary },
    remainingNum: { ...typography.bodyLg, color: colors.textPrimary, fontWeight: '700' },

    dates: {
        flexDirection: 'row',
        paddingTop: spacing.base,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    dateItem: { flex: 1, alignItems: 'center' },
    dateDivider: { width: 1, backgroundColor: colors.border },
    dateLabel: { ...typography.micro, color: colors.textSecondary, marginBottom: 2 },
    dateValue:  { ...typography.label, color: colors.textPrimary, fontWeight: '600' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ClientPlanScreen() {
    const insets = useSafeAreaInsets();

    const [loading,         setLoading]         = useState(true);
    const [paying,          setPaying]           = useState(false);
    // Synchronous lock — prevents double-tap race condition before React re-renders
    const payingRef = useRef(false);
    const [selecting,       setSelecting]        = useState<string | null>(null);
    const [error,           setError]            = useState<string | null>(null);

    // Plan state from API
    const [planStatus,      setPlanStatus]       = useState<PlanStatus>('none');
    const [selectedPlanId,  setSelectedPlanId]   = useState<string | null>(null);
    const [activePlan,      setActivePlan]        = useState<ActivePlan | null>(null);
    const [selectedDetails, setSelectedDetails]  = useState<PlanCatalogue | null>(null);

    // Catalogue
    const [catalogue, setCatalogue] = useState<PlanCatalogue[]>([]);

    // Controls the inline upgrade/renew panel shown below the active plan card
    const [showUpgrade, setShowUpgrade] = useState(false);

    // ── Data fetch ──────────────────────────────────────────────────────

    const fetchData = useCallback(async () => {
        console.log('[MyPlan] fetchData started');
        setLoading(true);
        setError(null);
        try {
            console.log('[MyPlan] calling getMyPlan + getPlans');
            const [planResp, catalogueResp] = await Promise.all([
                getMyPlan(),
                getPlans(),
            ]);
            console.log('[MyPlan] fetchData success — plan_status:', planResp.plan_status);

            setPlanStatus((planResp.plan_status as PlanStatus) ?? 'none');
            setSelectedPlanId(planResp.selected_plan_id ?? null);
            setActivePlan(planResp.active_plan ?? null);
            setSelectedDetails(planResp.selected_plan_details as PlanCatalogue ?? null);
            setCatalogue((catalogueResp.plans as unknown as PlanCatalogue[]) ?? []);
        } catch (err: any) {
            console.error('[MyPlan] fetchData error:', err.message);
            setError(err.message ?? 'Failed to load plan. Please try again.');
        } finally {
            console.log('[MyPlan] fetchData finally — setLoading(false)');
            setLoading(false);
        }
    }, []);

    useFocusEffect(useCallback(() => {
        fetchData();
        // Always close the upgrade panel when navigating back to this screen
        setShowUpgrade(false);
    }, [fetchData]));

    // ── Plan selection ─────────────────────────────────────────────────

    const handleSelectPlan = async (plan_id: string) => {
        setSelecting(plan_id);
        try {
            await selectPlan(plan_id);
            // In upgrade mode, do NOT change planStatus to 'selected' — the inline
            // upgrade panel already shows the selection. Setting planStatus here
            // would also trigger the standalone 'selected' render block, causing
            // a duplicate confirm card to appear below the upgrade panel.
            if (!showUpgrade) {
                setPlanStatus('selected');
            }
            setSelectedPlanId(plan_id);
            const plan = catalogue.find(p => p.id === plan_id);
            if (plan) setSelectedDetails(plan);
        } catch (err: any) {
            Alert.alert('Error', err.message ?? 'Could not select plan.');
        } finally {
            setSelecting(null);
        }
    };


    // ── Payment (create + confirm in one step for simulated provider) ──

    const handlePay = async () => {
        if (!selectedPlanId) return;
        // Use ref for synchronous guard — React state is async and can miss rapid double-taps
        if (payingRef.current) return;
        payingRef.current = true;
        setPaying(true);
        try {
            // Step 1: create payment intent
            const createResult = await clientCreatePayment();

            // Step 2: confirm immediately (SimulatedPaymentProvider always succeeds)
            // When a real provider is integrated, this is where the payment UI
            // (Stripe PaymentSheet / HitPay WebView) would appear before confirming.
            const confirmResult = await clientConfirmPayment(
                createResult.payment_id,
                createResult.intent_id,
            );

            if (!confirmResult.success) {
                throw new Error(confirmResult.error ?? 'Payment failed. Please try again.');
            }

            // Close upgrade panel — fetchData() will refresh the active plan card
            setShowUpgrade(false);
            setPlanStatus('active');
            Alert.alert(
                'Plan activated! 🎉',
                `You now have ${confirmResult.sessions_remaining} sessions available. Your plan expires on ${confirmResult.expiry_date}.`,
                [{ text: 'Great!', onPress: fetchData }]
            );
        } catch (err: any) {
            Alert.alert('Payment failed', err.message ?? 'Please try again.');
        } finally {
            payingRef.current = false;
            setPaying(false);
        }
    };

    // ── Loading / error states ─────────────────────────────────────────

    if (loading) {
        return (
            <View style={s.centred}>
                <ActivityIndicator color={colors.accent} size="large" />
                <Text style={s.hintTxt}>Loading plan…</Text>
            </View>
        );
    }

    if (error) {
        return (
            <View style={s.centred}>
                <Text style={s.errorTxt}>{error}</Text>
                <TouchableOpacity style={s.retryBtn} onPress={fetchData}>
                    <Text style={s.retryTxt}>Try Again</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // ── Render ─────────────────────────────────────────────────────────

    return (
        <ScrollView
            style={s.root}
            contentContainerStyle={[s.content, { paddingTop: 0, paddingBottom: insets.bottom + 40 }]}
            showsVerticalScrollIndicator={false}
        >
            <View style={[s.hero, { paddingTop: insets.top + spacing.sm }]}>
                <Text style={s.heroTitle}>My Plan</Text>
                <Text style={s.heroSub}>Your coaching package and sessions.</Text>
            </View>

            {/* ── ACTIVE PLAN ─────────────────────────────────────────── */}
            {(planStatus === 'active' || activePlan) && activePlan && (
                <>
                    <ActivePlanCard plan={activePlan} />

                    {/* Upgrade button — visible when upgrade panel is closed */}
                    {!showUpgrade && (
                        <TouchableOpacity
                            style={s.upgradeBtn}
                            onPress={() => {
                                // Clear any stale selection so the catalogue renders fresh
                                setSelectedPlanId(null);
                                setSelectedDetails(null);
                                setShowUpgrade(true);
                            }}
                            activeOpacity={0.80}
                            accessibilityRole="button"
                            accessibilityLabel="Upgrade or Renew Plan"
                        >
                            <Text style={s.upgradeBtnTxt}>⬆ Upgrade or Renew Plan</Text>
                        </TouchableOpacity>
                    )}

                    {/* Inline upgrade panel — appears below the active card */}
                    {showUpgrade && (
                        <View style={s.upgradePanel}>
                            <Text style={s.upgradePanelTitle}>Choose a new package</Text>
                            <Text style={s.upgradePanelHint}>
                                Your new plan activates immediately after payment. Sessions from
                                your current plan will be replaced by the new package.
                            </Text>

                            {catalogue.map(plan => (
                                <PlanCard
                                    key={plan.id}
                                    plan={plan}
                                    selected={selectedPlanId === plan.id}
                                    onSelect={() => handleSelectPlan(plan.id)}
                                    disabled={!!selecting || paying}
                                />
                            ))}

                            {/* Pay button — appears once a package is selected */}
                            {selectedPlanId && (
                                <TouchableOpacity
                                    style={[s.payBtn, paying && s.payBtnDisabled]}
                                    onPress={handlePay}
                                    disabled={paying}
                                    activeOpacity={0.85}
                                >
                                    {paying
                                        ? <ActivityIndicator color="#fff" />
                                        : <Text style={s.payBtnTxt}>
                                            Pay SGD {catalogue.find(p => p.id === selectedPlanId)?.price_sgd.toLocaleString()} — Replace Current Plan
                                          </Text>
                                    }
                                </TouchableOpacity>
                            )}

                            {/* Cancel — returns to the normal active-plan view */}
                            <TouchableOpacity
                                style={s.changePlanBtn}
                                onPress={() => {
                                    setShowUpgrade(false);
                                    setSelectedPlanId(null);
                                    setSelectedDetails(null);
                                }}
                                activeOpacity={0.7}
                            >
                                <Text style={s.changePlanTxt}>Cancel — keep current plan</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                </>
            )}


            {/* ── NO PLAN / EXPIRED — show catalogue ──────────────────── */}
            {/* Guard: never show this block when an active plan exists.  */}
            {/* Active-plan clients use the inline upgrade panel in Block 1 */}
            {!activePlan && (planStatus === 'none' || planStatus === 'expired' || planStatus === 'cancelled') && (
                <>
                    {planStatus === 'expired' && (
                        <View style={s.statusRow}>
                            <StatusBadge variant="expiringSoon" label="Expired" />
                        </View>
                    )}
                    {planStatus === 'cancelled' && (
                        <View style={s.statusRow}>
                            <StatusBadge variant="cancelled" />
                        </View>
                    )}
                    <Text style={s.sectionTitle}>
                        {planStatus === 'none' ? 'Select your programme' : 'Renew your plan'}
                    </Text>
                    <Text style={s.sectionHint}>
                        {planStatus === 'none'
                            ? 'Choose the package that suits your goals. Your sessions activate immediately after payment.'
                            : 'Your previous plan has ended. Select a package below to continue.'
                        }
                    </Text>
                    {catalogue.map(plan => (
                        <PlanCard
                            key={plan.id}
                            plan={plan}
                            selected={selectedPlanId === plan.id}
                            onSelect={() => handleSelectPlan(plan.id)}
                            disabled={!!selecting}
                        />
                    ))}
                    {selectedPlanId && (
                        <TouchableOpacity
                            style={[s.payBtn, paying && s.payBtnDisabled]}
                            onPress={handlePay}
                            disabled={paying}
                            activeOpacity={0.85}
                        >
                            {paying
                                ? <ActivityIndicator color="#fff" />
                                : <Text style={s.payBtnTxt}>
                                    Pay SGD {catalogue.find(p => p.id === selectedPlanId)?.price_sgd.toLocaleString()} — Activate Plan
                                  </Text>
                            }
                        </TouchableOpacity>
                    )}
                </>
            )}

            {/* ── SELECTED — confirm payment ───────────────────────────── */}
            {/* Guard: only show for clients with NO active plan.          */}
            {/* Active-plan clients complete payment from the upgrade panel */}
            {!activePlan && planStatus === 'selected' && selectedDetails && (
                <>
                    <View style={s.selectedCard}>
                        <Text style={s.selectedLabel}>Selected plan</Text>
                        <Text style={s.selectedName}>{selectedDetails.name}</Text>
                        <Text style={s.selectedDesc}>{selectedDetails.description}</Text>
                    </View>

                    <TouchableOpacity
                        style={[s.payBtn, paying && s.payBtnDisabled]}
                        onPress={handlePay}
                        disabled={paying}
                        activeOpacity={0.85}
                    >
                        {paying
                            ? <ActivityIndicator color="#fff" />
                            : <Text style={s.payBtnTxt}>
                                Pay SGD {selectedDetails.price_sgd.toLocaleString()} — Activate Plan
                              </Text>
                        }
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={s.changePlanBtn}
                        onPress={() => { setPlanStatus('none'); setSelectedPlanId(null); }}
                        activeOpacity={0.7}
                    >
                        <Text style={s.changePlanTxt}>Choose a different plan</Text>
                    </TouchableOpacity>
                </>
            )}



            {/* ── PAYMENT PENDING ──────────────────────────────────────── */}
            {planStatus === 'payment_pending' && (
                <View style={s.centredCard}>
                    <ActivityIndicator color={colors.accent} size="large" />
                    <Text style={s.pendingTxt}>Confirming payment…</Text>
                </View>
            )}
        </ScrollView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    root:    { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.base },

    centred: {
        flex: 1, alignItems: 'center', justifyContent: 'center',
        padding: spacing.xl, gap: spacing.base,
    },
    hintTxt:  { ...typography.body, color: colors.textSecondary },
    errorTxt: { ...typography.body, color: colors.errorText, textAlign: 'center' },
    retryBtn: {
        backgroundColor: colors.accent, borderRadius: radius.card,
        paddingHorizontal: spacing.xl, paddingVertical: spacing.sm,
    },
    retryTxt: { ...typography.body, color: '#fff', fontWeight: '700' },

    statusRow: { marginBottom: spacing.sm },
    hero: {
        backgroundColor: colors.primary,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.xl,
        marginBottom: spacing.base,
    },
    heroTitle: { ...typography.h2, color: colors.textOnPrimary },
    heroSub: { ...typography.body, color: 'rgba(255,255,255,0.78)', marginTop: 4 },
    screenTitle: {
        ...typography.h1,
        color: colors.textPrimary,
        marginBottom: spacing.xl,
    },

    sectionTitle: {
        ...typography.h3,
        color: colors.textPrimary,
        marginBottom: spacing.xs,
    },
    sectionHint: {
        ...typography.body,
        color: colors.textSecondary,
        marginBottom: spacing.base,
    },

    // ── Upgrade / Renew button ──────────────────────────────────────────
    upgradeBtn: {
        height: 48,
        borderRadius: radius.card,
        borderWidth: 1.5,
        borderColor: colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.xl,
    },
    upgradeBtnTxt: {
        ...typography.body,
        color: colors.accent,
        fontWeight: '700',
    },

    // ── Inline upgrade panel ────────────────────────────────────────────
    upgradePanel: {
        backgroundColor: colors.surface,
        borderRadius: radius.cardLg,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.base,
        marginBottom: spacing.xl,
        gap: spacing.sm,
    },
    upgradePanelTitle: {
        ...typography.h3,
        color: colors.textPrimary,
        marginBottom: spacing.xs,
    },
    upgradePanelHint: {
        ...typography.body,
        color: colors.textSecondary,
        marginBottom: spacing.sm,
        lineHeight: 20,
    },

    selectedCard: {
        backgroundColor: colors.accentSubtle,
        borderRadius: radius.card,
        borderWidth: 1.5,
        borderColor: colors.accent,
        padding: spacing.base,
        marginBottom: spacing.base,
    },
    selectedLabel: { ...typography.micro, color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.xs },
    selectedName:  { ...typography.h2, color: colors.textPrimary },
    selectedDesc:  { ...typography.body, color: colors.textSecondary, marginTop: 2 },

    centredCard: {
        alignItems: 'center', padding: spacing.xxl, gap: spacing.base,
        backgroundColor: colors.surface, borderRadius: radius.cardLg,
        borderWidth: 1, borderColor: colors.border,
    },
    pendingTxt: { ...typography.body, color: colors.textSecondary },

    payBtn: {
        height: 54,
        backgroundColor: colors.accent,
        borderRadius: radius.card,
        alignItems: 'center', justifyContent: 'center',
        marginTop: spacing.base,
        ...shadows.cardElevated,
    },
    payBtnDisabled: { backgroundColor: colors.buttonDisabledBg },
    payBtnTxt: { ...typography.bodyLg, color: '#fff', fontWeight: '700' },

    changePlanBtn: {
        alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.xs,
    },
    changePlanTxt: { ...typography.body, color: colors.textSecondary },
});
