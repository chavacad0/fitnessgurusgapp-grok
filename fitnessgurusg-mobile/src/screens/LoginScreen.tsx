import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, StyleSheet,
    ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
    TextInput as RNTextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { loginCoach, loginClient, googleLogin } from '../services/apiClient';
import { colors, spacing, radius, typography, componentSize, shadows } from '../theme/theme';
import { AuthUser, Role } from '../types';

// ── Google OAuth config ───────────────────────────────────────────────────────
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';

if (__DEV__) {
    if (!GOOGLE_WEB_CLIENT_ID) console.warn('[LoginScreen] ⚠️  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set in .env');
    if (!GOOGLE_IOS_CLIENT_ID) console.warn('[LoginScreen] ⚠️  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is not set in .env');
}

// ── Navigation types ──────────────────────────────────────────────────────────
export type AuthStackParams = {
    Welcome:  undefined;
    Login:    undefined;
    Register: undefined;
};

type Props = {
    navigation: NativeStackNavigationProp<AuthStackParams, 'Login'>;
};

/**
 * LoginScreen — role-aware sign-in for coaches and clients.
 *
 * Role selection rationale:
 *   A segmented "Sign in as" toggle at the top of the form makes the user's
 *   intent explicit BEFORE they enter credentials. This prevents the ambiguity
 *   of the previous dual-fallback approach where a client email could
 *   accidentally match a coach record (or vice versa).
 *
 *   Defaults to "Client" — the most common user type.
 *   Coach selection is quiet but clearly labelled — coaches know who they are.
 *
 * Security: Role is determined by the BACKEND endpoint called, not by what
 *   the user selects. A coach toggling "Client" and entering coach credentials
 *   will get a 401 from /api/auth/client-login. Role is NEVER sent as a field.
 *
 * Google login: Goes to /api/auth/google which reads role from the DB — the
 *   toggle does not affect Google login (role is always backend-authoritative).
 */
export default function LoginScreen({ navigation }: Props) {
    const { login } = useAuth();

    // ── Role toggle state — 'client' is the default ───────────────────────────
    const [selectedRole,  setSelectedRole]  = useState<'client' | 'coach'>('client');
    const [email,         setEmail]         = useState('');
    const [password,      setPassword]      = useState('');
    const [loading,       setLoading]       = useState(false);
    const [googleLoading, setGoogleLoading] = useState(false);
    const [error,         setError]         = useState<string | null>(null);

    const passwordRef  = useRef<RNTextInput>(null);
    const isAnyLoading = loading || googleLoading;

    useEffect(() => {
        GoogleSignin.configure({
            webClientId: GOOGLE_WEB_CLIENT_ID,
            iosClientId: GOOGLE_IOS_CLIENT_ID,
            scopes: ['profile', 'email'],
            offlineAccess: true,
        });
    }, []);

    // ── Role toggle handler ───────────────────────────────────────────────────
    const handleRoleSelect = (role: 'client' | 'coach') => {
        setSelectedRole(role);
        setError(null); // Clear errors when switching role
    };

    // ── Email + password login ────────────────────────────────────────────────
    /**
     * Routes to the correct backend endpoint based on the selected role:
     *   'client' → POST /api/auth/client-login  (looks up 'clients' collection)
     *   'coach'  → POST /api/auth/login          (looks up 'coaches' collection)
     *
     * No fallback between endpoints — if credentials don't match the selected
     * role, the user sees a clear error and can switch role and try again.
     */
    const handleLogin = async () => {
        if (!email.trim() || !password.trim()) {
            setError('Please enter your email and password.');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            if (selectedRole === 'coach') {
                // ── Coach path ────────────────────────────────────────────────
                console.log('[LOGIN] Attempting coach login for:', email.trim());
                const data = await loginCoach(email.trim().toLowerCase(), password);
                const user: AuthUser = {
                    id:    data.coach._id,
                    email: data.coach.email,
                    name:  data.coach.name,
                    role:  (data.coach.role ?? 'coach') as Role,
                };
                await login(data.token, user);
            } else {
                // ── Client path ───────────────────────────────────────────────
                console.log('[LOGIN] Attempting client login for:', email.trim());
                const data = await loginClient(email.trim().toLowerCase(), password);
                const user: AuthUser = {
                    id:       data.client._id,
                    email:    data.client.email,
                    name:     data.client.name,
                    role:     'client',
                    clientId: data.client.id,
                };
                await login(data.token, user);
            }
        } catch (err: any) {
            const msg = err.message ?? '';
            if (msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('credentials')) {
                setError(
                    selectedRole === 'coach'
                        ? 'Incorrect email or password for a coach account.'
                        : 'Incorrect email or password. New client? Use "Join a programme" instead.'
                );
            } else {
                setError(msg || 'Sign in failed. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    };

    // ── Google ────────────────────────────────────────────────────────────────
    const handleGoogleLogin = async () => {
        setGoogleLoading(true);
        setError(null);
        try {
            await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
            await GoogleSignin.signIn();
            const { idToken } = await GoogleSignin.getTokens();
            if (!idToken) throw new Error('No ID token received from Google.');
            const response = await googleLogin(idToken);
            // Backend returns either a coach profile or the canonical client record.
            // Clients are identified by clients.id (UUID) — never by a coach document ID.
            const user: AuthUser = response.role === 'client'
                ? {
                    id:       response.client._id,
                    email:    response.client.email,
                    name:     response.client.name,
                    role:     'client',
                    clientId: response.client.id,
                }
                : {
                    id:    response.coach._id,
                    email: response.coach.email,
                    name:  response.coach.name,
                    role:  (response.coach.role ?? 'coach') as Role,
                };
            await login(response.token, user);
        } catch (err: any) {
            if (err.code === statusCodes.SIGN_IN_CANCELLED) return;
            if (err.code === statusCodes.IN_PROGRESS) return;
            await AsyncStorage.removeItem('authToken').catch(() => { });
            setError(err.message || 'Google sign-in failed. Please try again.');
        } finally {
            setGoogleLoading(false);
        }
    };

    return (
        <SafeAreaView style={s.root}>
            <KeyboardAvoidingView
                style={s.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                {/* ── Ghost back button ─────────────────────────────────────── */}
                <TouchableOpacity
                    style={s.backBtn}
                    onPress={() => navigation.goBack()}
                    hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                >
                    <Text style={s.backIcon}>←</Text>
                </TouchableOpacity>

                <ScrollView
                    contentContainerStyle={s.scroll}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    {/* ── Brand identity ───────────────────────────────────── */}
                    <View style={s.brandBlock}>
                        <View style={s.mark}>
                            <Text style={s.markFG}>FG</Text>
                            <Text style={s.markSG}>SG</Text>
                        </View>
                        <Text style={s.brandName}>FitnessGuruSG</Text>
                    </View>

                    {/* ── Page heading ─────────────────────────────────────── */}
                    <View style={s.pageHeader}>
                        <Text style={s.title}>Welcome back</Text>
                        <Text style={s.subtitle}>
                            Select your role, then enter your credentials.
                        </Text>
                    </View>

                    {/* ── Role toggle ───────────────────────────────────────── */}
                    {/*
                        WHY explicit role selection:
                        Makes the user's intent unambiguous BEFORE credentials
                        are entered. Each role maps to a distinct backend endpoint
                        and DB collection — no fallback guesswork.
                    */}
                    <View style={s.roleToggleContainer}>
                        <Text style={s.roleToggleLabel}>SIGN IN AS</Text>
                        <View style={s.roleToggle}>
                            <TouchableOpacity
                                style={[
                                    s.roleBtn,
                                    selectedRole === 'client' && s.roleBtnActive,
                                ]}
                                onPress={() => handleRoleSelect('client')}
                                disabled={isAnyLoading}
                                accessibilityRole="button"
                                accessibilityLabel="Sign in as Client"
                                accessibilityState={{ selected: selectedRole === 'client' }}
                            >
                                <Text style={[
                                    s.roleBtnText,
                                    selectedRole === 'client' && s.roleBtnTextActive,
                                ]}>
                                    🏃 Client
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[
                                    s.roleBtn,
                                    selectedRole === 'coach' && s.roleBtnActive,
                                ]}
                                onPress={() => handleRoleSelect('coach')}
                                disabled={isAnyLoading}
                                accessibilityRole="button"
                                accessibilityLabel="Sign in as Coach"
                                accessibilityState={{ selected: selectedRole === 'coach' }}
                            >
                                <Text style={[
                                    s.roleBtnText,
                                    selectedRole === 'coach' && s.roleBtnTextActive,
                                ]}>
                                    💪 Coach
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* ── Form ─────────────────────────────────────────────── */}
                    <View style={s.formSection}>
                        <Text style={s.sectionLabel}>CREDENTIALS</Text>

                        {/* Email */}
                        <View style={s.fieldGroup}>
                            <Text style={s.fieldLabel}>Email address</Text>
                            <TextInput
                                style={[s.input, !!error && s.inputError]}
                                placeholder="you@example.com"
                                placeholderTextColor={colors.placeholder}
                                value={email}
                                onChangeText={t => { setEmail(t); setError(null); }}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!isAnyLoading}
                                accessibilityLabel="Email address"
                                returnKeyType="next"
                                onSubmitEditing={() => passwordRef.current?.focus()}
                            />
                        </View>

                        {/* Password */}
                        <View style={[s.fieldGroup, { marginBottom: 0 }]}>
                            <View style={s.fieldLabelRow}>
                                <Text style={s.fieldLabel}>Password</Text>
                                <TouchableOpacity
                                    onPress={() => { /* TODO: ForgotPasswordScreen */ }}
                                    hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                                    accessibilityRole="button"
                                    accessibilityLabel="Forgot password"
                                >
                                    <Text style={s.forgotLink}>Forgot?</Text>
                                </TouchableOpacity>
                            </View>
                            <TextInput
                                ref={passwordRef}
                                style={[s.input, !!error && s.inputError]}
                                placeholder="••••••••"
                                placeholderTextColor={colors.placeholder}
                                value={password}
                                onChangeText={t => { setPassword(t); setError(null); }}
                                secureTextEntry
                                editable={!isAnyLoading}
                                accessibilityLabel="Password"
                                returnKeyType="done"
                                onSubmitEditing={handleLogin}
                            />
                        </View>
                    </View>

                    {/* ── Error banner ─────────────────────────────────────── */}
                    {error ? (
                        <View style={s.errorBanner}>
                            <Text style={s.errorIcon}>⚠</Text>
                            <Text style={s.errorText}>{error}</Text>
                        </View>
                    ) : null}

                    {/* ── Primary CTA ──────────────────────────────────────── */}
                    <TouchableOpacity
                        style={[s.btnPrimary, isAnyLoading && s.btnDisabled]}
                        onPress={handleLogin}
                        disabled={isAnyLoading}
                        activeOpacity={0.88}
                        accessibilityRole="button"
                        accessibilityLabel={`Sign in as ${selectedRole}`}
                    >
                        {loading
                            ? <ActivityIndicator color={colors.buttonPrimaryText} />
                            : <Text style={s.btnPrimaryText}>
                                {selectedRole === 'coach' ? 'Sign in as Coach' : 'Sign in as Client'}
                              </Text>
                        }
                    </TouchableOpacity>

                    {/* ── Divider ──────────────────────────────────────────── */}
                    <View style={s.divider}>
                        <View style={s.divLine} />
                        <Text style={s.divText}>or continue with</Text>
                        <View style={s.divLine} />
                    </View>

                    {/* ── Google — secondary ───────────────────────────────── */}
                    <TouchableOpacity
                        style={[s.btnGoogle, isAnyLoading && s.btnDisabled]}
                        onPress={handleGoogleLogin}
                        disabled={isAnyLoading}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel="Continue with Google"
                    >
                        {googleLoading ? (
                            <ActivityIndicator color={colors.textPrimary} />
                        ) : (
                            <>
                                <View style={s.googleMark}>
                                    <Text style={s.googleMarkText}>G</Text>
                                </View>
                                <Text style={s.btnGoogleText}>Continue with Google</Text>
                            </>
                        )}
                    </TouchableOpacity>

                    {/* ── New client link ───────────────────────────────────── */}
                    <View style={s.switchRow}>
                        <Text style={s.switchText}>New client? </Text>
                        <TouchableOpacity
                            onPress={() => navigation.navigate('Register')}
                            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                            accessibilityRole="button"
                            accessibilityLabel="Join a coaching programme"
                        >
                            <Text style={s.switchLink}>Join a programme →</Text>
                        </TouchableOpacity>
                    </View>

                    <Text style={s.footer}>FitnessGuruSG · Singapore</Text>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },

    // ── Ghost back button ──────────────────────────────────────────────────────
    backBtn: {
        position: 'absolute',
        top: 12, left: 16,
        zIndex: 10,
        width: 40, height: 40,
        borderRadius: radius.md,
        backgroundColor: colors.surface,
        borderWidth: 1, borderColor: colors.border,
        alignItems: 'center', justifyContent: 'center',
        ...shadows.card,
    },
    backIcon: { fontSize: 20, color: colors.textPrimary, lineHeight: 24 },

    // ── Scroll ─────────────────────────────────────────────────────────────────
    scroll: {
        flexGrow: 1,
        paddingHorizontal: spacing.xl,
        paddingTop: 72,          // clears the absolute back button
        paddingBottom: spacing.section,
    },

    // ── Brand block ────────────────────────────────────────────────────────────
    brandBlock: {
        alignItems: 'center',
        marginBottom: spacing.section,
    },
    mark: {
        width: 72, height: 72,
        borderRadius: radius.cardLg,
        backgroundColor: colors.buttonPrimaryBg,
        alignItems: 'center', justifyContent: 'center',
        marginBottom: spacing.md,
        ...shadows.cardElevated,
    },
    markFG: {
        fontSize: 20, fontWeight: '800', color: '#FFF',
        letterSpacing: 2, lineHeight: 24,
    },
    markSG: {
        fontSize: 9, fontWeight: '600',
        color: 'rgba(255,255,255,0.55)',
        letterSpacing: 3,
    },
    brandName: {
        fontSize: 15, fontWeight: '700',
        color: colors.textPrimary, letterSpacing: 0.2,
    },

    // ── Page header ────────────────────────────────────────────────────────────
    pageHeader: { marginBottom: spacing.xl },
    title: {
        ...typography.h1,
        color: colors.textPrimary,
        marginBottom: spacing.xs,
    },
    subtitle: {
        ...typography.body,
        color: colors.textSecondary,
        lineHeight: 22,
    },

    // ── Role toggle ────────────────────────────────────────────────────────────
    roleToggleContainer: {
        marginBottom: spacing.xl,
    },
    roleToggleLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: colors.textSecondary,
        letterSpacing: 1.2,
        marginBottom: spacing.sm,
    },
    roleToggle: {
        flexDirection: 'row',
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 4,
        ...shadows.card,
    },
    roleBtn: {
        flex: 1,
        paddingVertical: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.md,
    },
    roleBtnActive: {
        backgroundColor: colors.buttonPrimaryBg,
        ...shadows.card,
    },
    roleBtnText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textSecondary,
        letterSpacing: 0.3,
    },
    roleBtnTextActive: {
        color: colors.buttonPrimaryText,
    },

    // ── Form section ───────────────────────────────────────────────────────────
    formSection: {
        backgroundColor: colors.surface,
        borderRadius: radius.cardLg,
        borderWidth: 1, borderColor: colors.border,
        padding: spacing.xl,
        marginBottom: spacing.base,
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
    fieldLabelRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
    },
    fieldLabel: {
        fontSize: 13, fontWeight: '500',
        color: colors.textSecondary,
    },
    forgotLink: {
        fontSize: 13, fontWeight: '500',
        color: colors.accent,
    },
    input: {
        height: componentSize.input,
        backgroundColor: colors.background,
        borderWidth: 1, borderColor: colors.border,
        borderRadius: radius.input,
        paddingHorizontal: spacing.base,
        ...typography.body,
        color: colors.textPrimary,
    },
    inputError: { borderColor: colors.errorBorder, backgroundColor: colors.errorBg },

    // ── Error banner ───────────────────────────────────────────────────────────
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
        fontWeight: '400', flex: 1, lineHeight: 18,
    },

    // ── Primary CTA ────────────────────────────────────────────────────────────
    btnPrimary: {
        height: componentSize.button,
        backgroundColor: colors.buttonPrimaryBg,
        borderRadius: radius.card,
        alignItems: 'center', justifyContent: 'center',
        marginTop: spacing.lg,
        ...shadows.card,
    },
    btnPrimaryText: {
        fontSize: 16, fontWeight: '600',
        color: colors.buttonPrimaryText,
        letterSpacing: 0.2,
    },
    btnDisabled: { backgroundColor: colors.buttonDisabledBg },

    // ── Divider ────────────────────────────────────────────────────────────────
    divider: {
        flexDirection: 'row', alignItems: 'center',
        gap: spacing.sm,
        marginVertical: spacing.lg,
    },
    divLine: { flex: 1, height: 1, backgroundColor: colors.border },
    divText: {
        ...typography.caption,
        color: colors.textSecondary,
        letterSpacing: 0.5,
    },

    // ── Google ─────────────────────────────────────────────────────────────────
    btnGoogle: {
        height: componentSize.button,
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1.5, borderColor: colors.border,
        flexDirection: 'row',
        alignItems: 'center', justifyContent: 'center',
        gap: spacing.sm,
        ...shadows.card,
    },
    googleMark: {
        width: 22, height: 22, borderRadius: 11,
        backgroundColor: '#FFF',
        borderWidth: 1, borderColor: '#E0E0E0',
        alignItems: 'center', justifyContent: 'center',
    },
    googleMarkText: {
        fontSize: 13, fontWeight: '800',
        color: '#4285F4', lineHeight: 16,
    },
    btnGoogleText: {
        fontSize: 15, fontWeight: '600',
        color: colors.textPrimary,
    },

    // ── Switch + notes ─────────────────────────────────────────────────────────
    switchRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: spacing.xxl,
    },
    switchText: { ...typography.body, color: colors.textSecondary },
    switchLink: {
        ...typography.body,
        color: colors.accent, fontWeight: '600',
    },
    footer: {
        ...typography.micro,
        color: colors.placeholder,
        textAlign: 'center',
        letterSpacing: 0.8,
        marginTop: spacing.lg,
    },
});
