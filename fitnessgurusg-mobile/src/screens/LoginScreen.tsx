import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, StyleSheet,
    ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
    TextInput as RNTextInput, Image, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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

const COACH_LOG_IN_ERROR =
    "We couldn't sign you in as a coach. If you're a client, switch to Client above.";
const CLIENT_LOG_IN_ERROR =
    "We couldn't sign you in as a client. If you're a coach, switch to Coach above.";

/**
 * LoginScreen — role-aware sign-in for coaches and clients.
 *
 * Role selection rationale:
 *   A segmented "Log in as" toggle at the top of the form makes the user's
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
    const [showPassword,  setShowPassword]  = useState(false);
    const [emailFocused,  setEmailFocused]  = useState(false);
    const [passwordFocused, setPasswordFocused] = useState(false);

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
                    hasCoach: data.client.has_coach ?? !!data.client.coach_id,
                };
                await login(data.token, user);
            }
        } catch (err: any) {
            const msg = err.message ?? '';
            const lower = msg.toLowerCase();
            if (lower.includes('sign you in as')) {
                setError(msg);
            } else if (lower.includes('invalid') || lower.includes('credentials')) {
                setError(selectedRole === 'coach' ? COACH_LOG_IN_ERROR : CLIENT_LOG_IN_ERROR);
            } else {
                setError(msg || 'Log in failed. Please try again.');
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
            const response = await googleLogin(idToken, selectedRole);
            // The toggle is sent to the server. If a response still comes back
            // for the other role, do not save a session.
            if (response.role !== selectedRole) {
                throw new Error(selectedRole === 'coach' ? COACH_LOG_IN_ERROR : CLIENT_LOG_IN_ERROR);
            }
            // Backend returns either a coach profile or the canonical client record.
            // Clients are identified by clients.id (UUID) — never by a coach document ID.
            let user: AuthUser;
            if (response.role === 'client') {
                if (!response.client?.id) {
                    throw new Error('Sign-in succeeded but your client profile was missing. Please try again.');
                }
                user = {
                    id:       response.client._id,
                    email:    response.client.email,
                    name:     response.client.name,
                    role:     'client',
                    clientId: response.client.id,
                    hasCoach: response.client.has_coach,
                };
            } else {
                if (!response.coach?._id) {
                    throw new Error('Sign-in succeeded but your coach profile was missing. Please try again.');
                }
                user = {
                    id:    response.coach._id,
                    email: response.coach.email,
                    name:  response.coach.name,
                    role:  (response.coach.role ?? 'coach') as Role,
                };
            }
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
            <StatusBar barStyle="dark-content" />
            <KeyboardAvoidingView
                style={s.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <View style={s.backRow}>
                    <TouchableOpacity
                        style={s.backBtn}
                        onPress={() => navigation.goBack()}
                        accessibilityRole="button"
                        accessibilityLabel="Go back"
                    >
                        <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
                    </TouchableOpacity>
                </View>

                <ScrollView
                    contentContainerStyle={s.scroll}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    {/* ── Page heading ─────────────────────────────────────── */}
                    <View style={s.pageHeader}>
                        <Text style={s.title}>Welcome back</Text>
                        <Text style={s.subtitle}>
                            Already have an account? Choose Client or Coach, then log in.
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
                        <Text style={s.roleToggleLabel}>LOG IN AS</Text>
                        <View style={s.roleToggle}>
                            <TouchableOpacity
                                style={[
                                    s.roleBtn,
                                    selectedRole === 'client' && s.roleBtnActive,
                                ]}
                                onPress={() => handleRoleSelect('client')}
                                disabled={isAnyLoading}
                                accessibilityRole="button"
                                accessibilityLabel="Log in as Client"
                                accessibilityState={{ selected: selectedRole === 'client' }}
                            >
                                <Ionicons
                                    name="person-outline"
                                    size={16}
                                    color={selectedRole === 'client' ? '#FFFFFF' : colors.textSecondary}
                                />
                                <Text style={[
                                    s.roleBtnText,
                                    selectedRole === 'client' && s.roleBtnTextActive,
                                ]}>
                                    Client
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
                                accessibilityLabel="Log in as Coach"
                                accessibilityState={{ selected: selectedRole === 'coach' }}
                            >
                                <Ionicons
                                    name="clipboard-outline"
                                    size={16}
                                    color={selectedRole === 'coach' ? '#FFFFFF' : colors.textSecondary}
                                />
                                <Text style={[
                                    s.roleBtnText,
                                    selectedRole === 'coach' && s.roleBtnTextActive,
                                ]}>
                                    Coach
                                </Text>
                            </TouchableOpacity>
                        </View>
                        {selectedRole === 'coach' ? (
                            <View style={s.coachNote}>
                                <Ionicons name="information-circle-outline" size={16} color={colors.accent} />
                                <Text style={s.coachNoteText}>
                                    Coach accounts are set up by FitnessGuruSG.
                                </Text>
                            </View>
                        ) : null}
                    </View>

                    {/* ── Form ─────────────────────────────────────────────── */}
                    <View style={s.formSection}>
                        {/* Email */}
                        <View style={s.fieldGroup}>
                            <Text style={[s.fieldLabel, s.fieldLabelGap]}>Email address</Text>
                            <View style={[s.inputRow, emailFocused && s.inputFocused, !!error && s.inputError]}>
                                <Ionicons
                                    name="mail-outline"
                                    size={18}
                                    color={emailFocused ? colors.accent : colors.placeholder}
                                />
                                <TextInput
                                    style={s.input}
                                    placeholder="you@example.com"
                                    placeholderTextColor={colors.placeholder}
                                    value={email}
                                    onChangeText={t => { setEmail(t); setError(null); }}
                                    onFocus={() => setEmailFocused(true)}
                                    onBlur={() => setEmailFocused(false)}
                                    keyboardType="email-address"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    editable={!isAnyLoading}
                                    accessibilityLabel="Email address"
                                    returnKeyType="next"
                                    onSubmitEditing={() => passwordRef.current?.focus()}
                                />
                            </View>
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
                            <View style={[s.inputRow, passwordFocused && s.inputFocused, !!error && s.inputError]}>
                                <Ionicons
                                    name="lock-closed-outline"
                                    size={18}
                                    color={passwordFocused ? colors.accent : colors.placeholder}
                                />
                                <TextInput
                                    ref={passwordRef}
                                    style={s.input}
                                    placeholder="Enter your password"
                                    placeholderTextColor={colors.placeholder}
                                    value={password}
                                    onChangeText={t => { setPassword(t); setError(null); }}
                                    onFocus={() => setPasswordFocused(true)}
                                    onBlur={() => setPasswordFocused(false)}
                                    secureTextEntry={!showPassword}
                                    editable={!isAnyLoading}
                                    accessibilityLabel="Password"
                                    returnKeyType="done"
                                    onSubmitEditing={handleLogin}
                                />
                                <TouchableOpacity
                                    style={s.eyeBtn}
                                    onPress={() => setShowPassword(current => !current)}
                                    accessibilityRole="button"
                                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                                >
                                    <Ionicons
                                        name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                                        size={20}
                                        color={colors.textSecondary}
                                    />
                                </TouchableOpacity>
                            </View>
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
                        accessibilityLabel={selectedRole === 'coach' ? 'Log in as Coach' : 'Log in as Client'}
                    >
                        {loading
                            ? <ActivityIndicator color={colors.buttonPrimaryText} />
                            : <Text style={s.btnPrimaryText}>
                                {selectedRole === 'coach' ? 'Log in as Coach' : 'Log in as Client'}
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
                        style={[s.btnGoogle, isAnyLoading && s.btnGoogleDisabled]}
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
                                <Image
                                    source={require('../../assets/google-g.png')}
                                    style={s.googleMark}
                                    accessible={false}
                                />
                                <Text style={s.btnGoogleText}>Continue with Google</Text>
                            </>
                        )}
                    </TouchableOpacity>

                    {/* ── Sign up ───────────────────────────────────────────── */}
                    {/* Sign up always opens client registration. There is no way
                        to create a coach account from the app. */}
                    <View style={s.signupBlock}>
                        <View style={s.switchRow}>
                            <Text style={s.switchText}>
                                {selectedRole === 'coach' ? 'New client? ' : 'New here? '}
                            </Text>
                            <TouchableOpacity
                                onPress={() => navigation.navigate('Register')}
                                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                                accessibilityRole="button"
                                accessibilityLabel="Sign up as a new client"
                            >
                                <Text style={s.switchLink}>Sign up</Text>
                            </TouchableOpacity>
                        </View>
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

    backRow: {
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.sm,
        paddingBottom: spacing.xs,
    },
    backBtn: {
        width: 44,
        height: 44,
        borderRadius: radius.md,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
    },

    scroll: {
        flexGrow: 1,
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.sm,
        paddingBottom: spacing.section,
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
        backgroundColor: '#F3F4F6',
        borderRadius: radius.card,
        padding: 4,
        gap: 4,
    },
    roleBtn: {
        flex: 1,
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
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
        fontSize: 13, fontWeight: '600',
        color: colors.textPrimary,
    },
    fieldLabelGap: { marginBottom: 6 },
    forgotLink: {
        fontSize: 13, fontWeight: '600',
        color: colors.accent,
    },
    inputRow: {
        height: componentSize.input,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.input,
        paddingHorizontal: spacing.md,
    },
    inputFocused: {
        borderColor: colors.accent,
        borderWidth: 1.5,
    },
    input: {
        flex: 1,
        height: '100%',
        ...typography.body,
        color: colors.textPrimary,
        paddingVertical: 0,
    },
    eyeBtn: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    inputError: { borderColor: colors.errorBorder, backgroundColor: colors.errorBg },
    coachNote: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: spacing.md,
        backgroundColor: colors.accentSubtle,
        borderRadius: radius.md,
        paddingVertical: 10,
        paddingHorizontal: spacing.md,
    },
    coachNoteText: {
        ...typography.caption,
        color: colors.accent,
        flex: 1,
        lineHeight: 18,
    },

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
        backgroundColor: '#FFFFFF',
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: '#DADCE0',
        flexDirection: 'row',
        alignItems: 'center', justifyContent: 'center',
        gap: spacing.sm,
    },
    btnGoogleDisabled: { opacity: 0.6 },
    googleMark: {
        width: 18,
        height: 18,
    },
    btnGoogleText: {
        fontSize: 15, fontWeight: '600',
        color: colors.textPrimary,
    },

    // ── Switch + notes ─────────────────────────────────────────────────────────
    signupBlock: {
        marginTop: spacing.xxl,
        alignItems: 'center',
        gap: spacing.sm,
    },
    switchRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
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
