import React, { useState, useRef } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, StyleSheet,
    ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
    TextInput as RNTextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { registerClient } from '../services/apiClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FIRST_LOGIN_KEY } from '../config/constants';
import { colors, spacing, radius, typography, componentSize, shadows } from '../theme/theme';
import type { AuthStackParams } from './LoginScreen';

type Props = {
    navigation: NativeStackNavigationProp<AuthStackParams, 'Register'>;
};

/**
 * RegisterScreen — invite-only client account creation.
 *
 * Visual design rationale:
 *   - Invite code gets an ACCENT CARD treatment (teal tint) to signal it is
 *     the gate — not just another field. If they don't have a code, they
 *     understand immediately before filling anything else.
 *   - Remaining fields live in a clean flat section below — no redundant card
 *     border wrapping them. White surface on off-white background provides
 *     natural separation with less visual noise.
 *   - Four-step progress dots orient the user — they see a short journey.
 *   - Field labels use UPPERCASE + letter-spacing — standard premium app
 *     pattern (used by Stripe, DBS, Revolut).
 *
 * Security: Role is never sent from the frontend. Backend enforces role: 'client'.
 */
export default function RegisterScreen({ navigation }: Props) {
    const { login } = useAuth();

    const [name,      setName]      = useState('');
    const [email,     setEmail]     = useState('');
    const [password,  setPassword]  = useState('');
    const [loading,   setLoading]   = useState(false);
    const [error,     setError]     = useState<string | null>(null);

    // Refs for keyboard-driven field progression
    const nameRef     = useRef<RNTextInput>(null);
    const emailRef    = useRef<RNTextInput>(null);
    const passwordRef = useRef<RNTextInput>(null);

    const handleRegister = async () => {
        // Validate required fields (invite code is NOT required)
        if (!name.trim()) {
            setError('Enter your name to continue.');
            return;
        }
        if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            setError('Enter a valid email address.');
            return;
        }
        if (password.length < 8) {
            setError('Password must be at least 8 characters.');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            console.log('[REGISTER ①] handleRegister() started');

            const regResult = await registerClient({
                name:     name.trim(),
                email:    email.trim().toLowerCase(),
                password,
            });

            console.log('[REGISTER ②] registerClient() succeeded');
            console.log('[REGISTER ②] client._id:', regResult.client._id);
            console.log('[REGISTER ②] token present:', !!regResult.token);

            try {
                const b64     = regResult.token.split('.')[1];
                const payload = JSON.parse(decodeURIComponent(escape(atob(b64))));
                console.log('[REGISTER ③] JWT payload role:', payload.role, '← should be: client');
            } catch { console.log('[REGISTER ③] could not decode JWT'); }

            const userToSave = {
                id:       regResult.client._id,
                email:    regResult.client.email,
                name:     regResult.client.name,
                role:     'client' as const,
                clientId: regResult.client.id,
            };
            console.log('[REGISTER ④] calling AuthContext.login() with role:', userToSave.role);

            await login(regResult.token, userToSave);

            // Mark as first-time login so RootNavigator shows the onboarding flow.
            // This flag is read once, then cleared after the user completes onboarding.
            await AsyncStorage.setItem(FIRST_LOGIN_KEY, 'true');

            console.log('[REGISTER ⑩] login() + first-login flag set — onboarding flow will show');
        } catch (err: any) {
            console.error('[REGISTER ERROR]', err.message);
            const raw: string = err.message ?? '';
            if (raw.toLowerCase().includes('email already') || raw.toLowerCase().includes('already registered')) {
                setError('This email is already registered. Try signing in instead.');
            } else if (raw.toLowerCase().includes('invalid email')) {
                setError('Enter a valid email address.');
            } else if (raw.toLowerCase().includes('temporarily unavailable')) {
                setError('Registration is temporarily unavailable. Please try again shortly.');
            } else {
                setError(raw || 'Something went wrong. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={s.root}>
            <KeyboardAvoidingView
                style={s.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                {/* ── Navigation bar ──────────────────────────────────────── */}
                <View style={s.navbar}>
                    <TouchableOpacity
                        style={s.backBtn}
                        onPress={() => navigation.goBack()}
                        hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
                        accessibilityRole="button"
                        accessibilityLabel="Go back"
                    >
                        <Text style={s.backIcon}>←</Text>
                    </TouchableOpacity>

                    {/* Step indicator — 4 dots, first filled */}
                    <View style={s.steps}>
                        {[0, 1, 2, 3].map(i => (
                            <View key={i} style={[s.step, i === 0 && s.stepActive]} />
                        ))}
                    </View>

                    <View style={s.navMark}>
                        <Text style={s.navMarkText}>FG</Text>
                    </View>
                </View>

                <ScrollView
                    contentContainerStyle={s.scroll}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    {/* ── Page header ─────────────────────────────────────── */}
                    <View style={s.pageHeader}>
                        <Text style={s.title}>Create your account</Text>
                        <Text style={s.subtitle}>
                            Sign up to start your fitness programme.
                        </Text>
                    </View>

                    {/* ── Account details section ──────────────────────────── */}
                    <View style={s.section}>
                        <Text style={s.sectionLabel}>YOUR DETAILS</Text>

                        {/* Full name */}
                        <View style={s.fieldGroup}>
                            <Text style={s.fieldLabel}>Full name</Text>
                            <TextInput
                                ref={nameRef}
                                style={[s.input, !!error && !email && s.inputError]}
                                placeholder="Your preferred name"
                                placeholderTextColor={colors.placeholder}
                                value={name}
                                onChangeText={t => { setName(t); setError(null); }}
                                autoCapitalize="words"
                                autoCorrect={false}
                                editable={!loading}
                                accessibilityLabel="Full name"
                                returnKeyType="next"
                                onSubmitEditing={() => emailRef.current?.focus()}
                            />
                        </View>

                        {/* Email */}
                        <View style={s.fieldGroup}>
                            <Text style={s.fieldLabel}>Email address</Text>
                            <TextInput
                                ref={emailRef}
                                style={[s.input, !!error && !password && s.inputError]}
                                placeholder="you@example.com"
                                placeholderTextColor={colors.placeholder}
                                value={email}
                                onChangeText={t => { setEmail(t); setError(null); }}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!loading}
                                accessibilityLabel="Email address"
                                returnKeyType="next"
                                onSubmitEditing={() => passwordRef.current?.focus()}
                            />
                        </View>

                        {/* Password */}
                        <View style={[s.fieldGroup, { marginBottom: 0 }]}>
                            <Text style={s.fieldLabel}>Create a password</Text>
                            <TextInput
                                ref={passwordRef}
                                style={[s.input, !!error && s.inputError]}
                                placeholder="Min. 8 characters"
                                placeholderTextColor={colors.placeholder}
                                value={password}
                                onChangeText={t => { setPassword(t); setError(null); }}
                                secureTextEntry
                                editable={!loading}
                                accessibilityLabel="Create a password"
                                returnKeyType="done"
                                onSubmitEditing={handleRegister}
                            />
                            <Text style={s.passwordHint}>
                                At least 8 characters — make it memorable.
                            </Text>
                        </View>
                    </View>


                    {/* ── Error banner ─────────────────────────────────────── */}
                    {error ? (
                        <View style={s.errorBanner}>
                            <Text style={s.errorIcon}>⚠</Text>
                            <Text style={s.errorText}>{error}</Text>
                        </View>
                    ) : null}

                    {/* ── Submit ───────────────────────────────────────────── */}
                    <TouchableOpacity
                        style={[s.btnPrimary, loading && s.btnDisabled]}
                        onPress={handleRegister}
                        disabled={loading}
                        activeOpacity={0.88}
                        accessibilityRole="button"
                        accessibilityLabel="Create account"
                    >
                        {loading
                            ? <ActivityIndicator color={colors.buttonPrimaryText} />
                            : <Text style={s.btnPrimaryText}>Join programme</Text>
                        }
                    </TouchableOpacity>

                    <Text style={s.termsNote}>
                        By creating an account, you agree to your coach's programme terms.
                    </Text>

                    {/* ── Sign in link ─────────────────────────────────────── */}
                    <View style={s.switchRow}>
                        <Text style={s.switchText}>Already a member? </Text>
                        <TouchableOpacity
                            onPress={() => navigation.navigate('Login')}
                            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                            accessibilityRole="button"
                            accessibilityLabel="Sign in"
                        >
                            <Text style={s.switchLink}>Sign in</Text>
                        </TouchableOpacity>
                    </View>

                    <Text style={s.footer}>FitnessGuruSG · Singapore</Text>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

// ─── Design values ────────────────────────────────────────────────────────────
//
//  Spacing rationale:
//    pageHeader → 32px bottom = generous separation before the gate field
//    between codeCard and section → 20px = visual grouping
//    between fields → 16px = standard form breathing room
//    btnPrimary → 24px top = strong CTA separation
//
//  Typography rationale:
//    sectionLabel → 11px uppercase + letter-spacing = premium form section header
//    fieldLabel   → 13px medium — readable but not competing with field values
//    title        → 28px/700 — slightly larger than h1 (26px) for more impact
//
// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },

    // ── Navigation bar ────────────────────────────────────────────────────────
    navbar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.base,
        paddingVertical: spacing.md,
        backgroundColor: colors.background,
    },
    backBtn: {
        width: 40, height: 40,
        borderRadius: radius.md,
        backgroundColor: colors.surface,
        borderWidth: 1, borderColor: colors.border,
        alignItems: 'center', justifyContent: 'center',
        ...shadows.card,
    },
    backIcon: { fontSize: 20, color: colors.textPrimary, lineHeight: 24 },
    navMark: {
        width: 40, height: 40,
        borderRadius: radius.md,
        backgroundColor: colors.buttonPrimaryBg,
        alignItems: 'center', justifyContent: 'center',
    },
    navMarkText: { fontSize: 11, fontWeight: '800', color: '#FFF', letterSpacing: 1.5 },

    // Step dots
    steps: { flexDirection: 'row', gap: 6 },
    step: {
        width: 6, height: 6, borderRadius: 3,
        backgroundColor: colors.border,
    },
    stepActive: {
        width: 20, height: 6, borderRadius: 3,
        backgroundColor: colors.buttonPrimaryBg,
    },

    // ── Scroll ────────────────────────────────────────────────────────────────
    scroll: {
        flexGrow: 1,
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.xl,
        paddingBottom: spacing.section,
    },

    // ── Page header ───────────────────────────────────────────────────────────
    pageHeader: { marginBottom: spacing.xxl },
    title: {
        fontSize: 28,
        fontWeight: '700',
        color: colors.textPrimary,
        letterSpacing: -0.5,
        lineHeight: 34,
        marginBottom: spacing.sm,
    },
    subtitle: {
        ...typography.body,
        color: colors.textSecondary,
        lineHeight: 22,
    },

    // ── Account details section ─────────────────────────────────────────────────
    section: {
        backgroundColor: colors.surface,
        borderRadius: radius.cardLg,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.xl,
        marginBottom: spacing.lg,
        ...shadows.card,
    },
    sectionLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: colors.textSecondary,
        letterSpacing: 1.2,
        marginBottom: spacing.base,
    },
    fieldGroup: { marginBottom: spacing.base },
    fieldLabel: {
        fontSize: 13,
        fontWeight: '500',
        color: colors.textSecondary,
        marginBottom: 6,
    },
    input: {
        height: componentSize.input,
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.input,
        paddingHorizontal: spacing.base,
        ...typography.body,
        color: colors.textPrimary,
    },
    inputError: { borderColor: colors.errorBorder, backgroundColor: colors.errorBg },
    passwordHint: {
        ...typography.caption,
        color: colors.placeholder,
        marginTop: spacing.xs,
        lineHeight: 16,
    },

    // ── Error banner ──────────────────────────────────────────────────────────
    errorBanner: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.sm,
        backgroundColor: colors.errorBg,
        borderWidth: 1, borderColor: colors.errorBorder,
        borderRadius: radius.md,
        padding: spacing.md,
        marginBottom: spacing.base,
    },
    errorIcon: { fontSize: 14, color: colors.errorText, lineHeight: 20 },
    errorText: {
        ...typography.label,
        color: colors.errorText,
        fontWeight: '400',
        flex: 1,
        lineHeight: 18,
    },

    // ── Submit ────────────────────────────────────────────────────────────────
    btnPrimary: {
        height: componentSize.button,
        backgroundColor: colors.buttonPrimaryBg,
        borderRadius: radius.card,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: spacing.sm,
        ...shadows.card,
    },
    btnPrimaryText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.buttonPrimaryText,
        letterSpacing: 0.2,
    },
    btnDisabled: { backgroundColor: colors.buttonDisabledBg },

    termsNote: {
        ...typography.caption,
        color: colors.placeholder,
        textAlign: 'center',
        marginTop: spacing.md,
        lineHeight: 17,
        paddingHorizontal: spacing.sm,
    },

    // ── Footer ────────────────────────────────────────────────────────────────
    switchRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: spacing.xxl,
    },
    switchText: { ...typography.body, color: colors.textSecondary },
    switchLink: {
        ...typography.body,
        color: colors.accent,
        fontWeight: '600',
    },
    footer: {
        ...typography.micro,
        color: colors.placeholder,
        textAlign: 'center',
        letterSpacing: 0.8,
        marginTop: spacing.lg,
    },
});
