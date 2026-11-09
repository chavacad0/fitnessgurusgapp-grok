import { BASE_URL } from '../config/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AUTH_TOKEN_KEY } from '../config/constants';
import { authEvents } from './authEvents';
import {
    AuthUser,
    Role,
    ClientPublic,
    ClientStatusItem,
    CheckIn,
    CheckInRequest,
    CheckInResponse,
    RedFlag,
    LoginResponse,
    GoogleLoginResponse,
    ClientLoginResponse,
    CoachAvailabilitySlot,
    BookingSlot,
    SessionStatusResponse,
    DashboardSummary,
    ClientPlanAssignment,
    Payment,
    PaymentMethod,
    SessionPlanCatalogue,
    QuickBookPayload,
    WorkoutAssignmentWithLog,
    WorkoutAssignment,
    ExerciseLog,
    WorkoutHistoryResponse,
} from '../types';



/**
 * Mobile API client — all HTTP calls to the FitnessGuruSG backend.
 *
 * Auth pattern:
 *  - Public calls (login, register, health): plain Content-Type header only.
 *  - Protected calls: getAuthHeaders() reads JWT from AsyncStorage automatically.
 *
 * Error handling:
 *  - HTTP 401 → throws "Your session has expired. Please log in again."
 *  - Other non-OK responses → throws with backend error message or HTTP status.
 *
 * Storage key: imported from config/constants.ts (AUTH_TOKEN_KEY).
 */

/**
 * Reads stored JWT from AsyncStorage and returns auth headers.
 * Used by all protected API calls.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
    const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

/**
 * fetch() with a hard timeout.
 *
 * WHY: React Native's fetch() hangs indefinitely when the server is
 * unreachable (e.g. the Mac's IP has changed). This causes screens to stay
 * stuck on their loading spinner forever — the catch block never fires.
 *
 * Default: 15 seconds. Pass a custom ms as the 3rd argument if needed.
 */
async function fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs: number = 15000,
): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        return response;
    } catch (err: any) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
            throw new Error(
                'Cannot connect to server. Check your network or update EXPO_PUBLIC_API_URL in .env.'
            );
        }
        throw err;
    }
}

// Dedup flag — prevents multiple concurrent 401s from firing N logout events.
let _sessionExpiredFired = false;

/** Reset the dedup flag after a successful login (called by AuthContext). */
export function resetSessionExpiredFlag(): void {
    _sessionExpiredFired = false;
}

/**
 * Centralised response handler.
 * Translates HTTP errors into human-readable Error instances.
 *
 * 401 handling:
 *  - Clears the stored JWT from AsyncStorage immediately.
 *  - Fires a 'session-expired' event (AuthContext listens and triggers logout).
 *  - Throws a user-friendly error message.
 *  - Deduped: only fires once per session to avoid N simultaneous logout events.
 *
 * WHY loginCoach does NOT use this function:
 *  A 401 from /api/auth/login means "wrong password", NOT "session expired".
 *  Sending the wrong message here would confuse the user and make the login
 *  screen appear broken. loginCoach has its own targeted error handling below.
 */
async function handleResponse<T>(response: Response): Promise<T> {
    if (response.status === 401) {
        // Clear stored token immediately so hydration on next app start won't
        // try to use the expired token again.
        try {
            await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
        } catch (_) {
            // Best-effort — if this fails, AuthContext.logout() will retry.
        }

        // Fire the event exactly once per session expiration.
        if (!_sessionExpiredFired) {
            _sessionExpiredFired = true;
            console.warn('[API] 401 detected — session expired, triggering logout.');
            authEvents.emit('session-expired');
        }

        throw new Error('Your session has expired. Please log in again.');
    }

    if (!response.ok) {
        try {
            const body = await response.json();
            throw new Error(body.error || `Request failed (${response.status})`);
        } catch (parseError) {
            if (parseError instanceof Error && parseError.message !== `Request failed (${response.status})`) {
                throw parseError;
            }
            throw new Error(`Request failed (${response.status})`);
        }
    }

    return response.json() as Promise<T>;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

interface RegisterResponse {
    success: boolean;
    message: string;
    coach:   { _id: string; email: string; name: string; role: string };
}

/**
 * POST /api/auth/login — public, no auth header.
 *
 * Handles its own response parsing (does NOT use handleResponse) because:
 *  - 401 here means WRONG CREDENTIALS, not session expired.
 */
export async function loginCoach(email: string, password: string): Promise<LoginResponse> {
    const url = `${BASE_URL}/api/auth/login`;
    console.log('[LOGIN] request URL:', url);

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });

    console.log('[LOGIN] response status:', response.status);

    if (response.status === 401) {
        throw new Error('Invalid email or password. Please try again.');
    }

    if (!response.ok) {
        let errorMsg = `Login failed (${response.status})`;
        try {
            const body = await response.json();
            errorMsg = body.error || errorMsg;
        } catch { /* ignore parse error */ }
        throw new Error(errorMsg);
    }

    const data = await response.json() as LoginResponse;
    console.log('[LOGIN] success — token length:', data.token?.length ?? 0);
    return data;
}

/**
 * POST /api/auth/client-login — client login.
 *
 * Supports two modes (handled transparently by the backend):
 *  - Self-registered clients: email + password required
 *  - Coach-provisioned clients (old MVP): email only (password ignored if no password_hash)
 *
 * Always sends both fields so the backend can choose.
 */
export async function loginClient(email: string, password?: string): Promise<ClientLoginResponse> {
    const url = `${BASE_URL}/api/auth/client-login`;
    console.log('[CLIENT LOGIN] request URL:', url);

    const body: Record<string, string> = { email };
    if (password) body['password'] = password;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    console.log('[CLIENT LOGIN] response status:', response.status);

    if (response.status === 401 || response.status === 400) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as any).error ?? 'Invalid email or password.');
    }
    if (!response.ok) {
        let errorMsg = `Login failed (${response.status})`;
        try { const body = await response.json(); errorMsg = (body as any).error || errorMsg; } catch { /* */ }
        throw new Error(errorMsg);
    }

    return response.json() as Promise<ClientLoginResponse>;
}

/**
 * POST /api/auth/register — coach account creation (coaches collection).
 */
export async function registerCoach(
    email:    string,
    password: string,
    name:     string,
): Promise<RegisterResponse> {
    const url = `${BASE_URL}/api/auth/register`;
    console.log('[REGISTER] request URL:', url);

    const response = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password, name }),
    });

    console.log('[REGISTER] response status:', response.status);

    if (response.status === 409) {
        throw new Error('An account with this email already exists.');
    }
    if (!response.ok) {
        let errorMsg = `Registration failed (${response.status})`;
        try { const body = await response.json(); errorMsg = (body as any).error || errorMsg; } catch { /* */ }
        throw new Error(errorMsg);
    }

    const data = await response.json() as RegisterResponse;
    console.log('[REGISTER] success — coach:', data.coach?.email);
    return data;
}

/**
 * POST /api/auth/client-register — self-registration for clients.
 *
 * SINGLE-COACH ARCHITECTURE:
 *  No invite code needed. The backend auto-assigns the single coach.
 *
 * Body: { name, email, password }
 * Returns: { success, token, client: { _id, id, email, name, coach_id } }
 */
export async function registerClient(params: {
    name:     string;
    email:    string;
    password: string;
}): Promise<{ success: boolean; token: string; client: { _id: string; id: string; email: string; name: string; coach_id: string } }> {
    const url = `${BASE_URL}/api/auth/client-register`;
    console.log('[CLIENT REGISTER] request URL:', url);

    const response = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
            name:     params.name,
            email:    params.email,
            password: params.password,
        }),
    });

    console.log('[CLIENT REGISTER] response status:', response.status);

    if (response.status === 400) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as any).error ?? 'Registration failed. Please check your details.');
    }
    if (response.status === 409) {
        throw new Error('An account with this email already exists. Please sign in.');
    }
    if (response.status === 503) {
        throw new Error('Registration is temporarily unavailable. Please try again later.');
    }
    if (!response.ok) {
        let errorMsg = `Registration failed (${response.status})`;
        try { const body = await response.json(); errorMsg = (body as any).error || errorMsg; } catch { /* */ }
        throw new Error(errorMsg);
    }

    return response.json();
}

/**
 * POST /api/auth/connect-coach — links an authenticated client to a coach.
 *
 * Called from ConnectToCoachScreen when a client who signed up without a
 * code later wants to connect. Requires a valid coach invite code.
 *
 * Body: { inviteCode }   — the client identity comes from the JWT, never the body.
 * Returns: { success, message, coachName, alreadyConnected? }
 * Errors:  400 invalid code · 409 already connected to a different coach
 */
export async function connectToCoach(
    inviteCode: string,
): Promise<{ success: boolean; message: string; coachName: string; alreadyConnected?: boolean }> {
    const headers  = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/auth/connect-coach`, {
        method:  'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ inviteCode: inviteCode.trim().toUpperCase() }),
    });

    if (response.status === 400) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as any).error ?? "That code doesn't match. Check with your coach.");
    }
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as any).error ?? `Failed to connect (${response.status})`);
    }

    return response.json();
}

/**
 * GET /api/auth/invite-code — returns (or generates) the coach's unique invite code.
 * Protected: requires coach JWT.
 *
 * Returns: { success, inviteCode: 'ABCD12', shareMessage: 'Hi! Use code ...' }
 */
export async function getInviteCode(): Promise<{ success: boolean; inviteCode: string; shareMessage: string }> {
    const headers  = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/auth/invite-code`, {
        method: 'GET',
        headers,
    });
    return handleResponse(response);
}

// ─── Client Plan + Payment ─────────────────────────────────────────────────────

/**
 * POST /api/clients/select-plan — client selects a plan (does not pay yet).
 * Protected: requires client JWT.
 *
 * Body: { plan_id: 'starter' | 'performance' | 'elite' }
 * Returns: { success, plan_status: 'selected', selected_plan: { ... } }
 */
export async function selectPlan(plan_id: string): Promise<{
    success: boolean;
    plan_status: string;
    selected_plan: { id: string; name: string; sessions: number; price_sgd: number; description: string };
}> {
    const headers  = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/clients/select-plan`, {
        method:  'POST',
        headers,
        body:    JSON.stringify({ plan_id }),
    });
    return handleResponse(response);
}

/**
 * GET /api/clients/me/plan — returns client's full plan state.
 * Protected: requires client JWT.
 *
 * Returns: { plan_status, selected_plan_id, active_plan?, selected_plan_details? }
 */
export async function getMyPlan(): Promise<{
    success: boolean;
    plan_status: string;
    selected_plan_id: string | null;
    active_plan?: {
        plan_name: string;
        sessions_total: number;
        sessions_used: number;
        sessions_remaining: number;
        start_date: string;
        expiry_date: string;
        status: string;
    };
    selected_plan_details?: {
        id: string;
        name: string;
        sessions: number;
        price_sgd: number;
        description: string;
    };
}> {
    const headers  = await getAuthHeaders();
    console.log('[API] GET /clients/me/plan');
    const response = await fetchWithTimeout(`${BASE_URL}/api/clients/me/plan`, {
        method: 'GET',
        headers,
    });
    return handleResponse(response);
}

/**
 * POST /api/payments/client-create — client initiates payment for selected plan.
 * Protected: requires client JWT.
 *
 * Returns: { success, payment_id, intent_id, amount_sgd }
 */
export async function clientCreatePayment(): Promise<{
    success: boolean;
    payment_id: string;
    intent_id: string;
    amount_sgd: number;
    clientSecret?: string;
    redirectUrl?: string;
}> {
    const headers  = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/payments/client-create`, {
        method: 'POST',
        headers,
        body:   JSON.stringify({}), // plan_id is read from client doc on backend
    });
    return handleResponse(response);
}

/**
 * POST /api/payments/client-confirm — confirms payment and activates plan.
 * Protected: requires client JWT.
 *
 * Body: { payment_id, intent_id }
 * Returns: { success, plan_status: 'active', sessions_total, expiry_date }
 */
export async function clientConfirmPayment(payment_id: string, intent_id: string): Promise<{
    success: boolean;
    plan_status?: string;
    sessions_total?: number;
    sessions_remaining?: number;
    expiry_date?: string;
    error?: string;
}> {
    const headers  = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/payments/client-confirm`, {
        method:  'POST',
        headers,
        body:    JSON.stringify({ payment_id, intent_id }),
    });
    return handleResponse(response);
}

/**
 * @deprecated Use `loginCoach()` or `loginClient()` directly based on the user's selected role.
 *
 * WHY deprecated:
 *   The dual-fallback pattern (try /api/auth/login, then /api/auth/client-login on 401)
 *   is ambiguous — a user whose email exists in both collections could land in the wrong
 *   navigator. LoginScreen now shows an explicit role toggle so the correct endpoint is
 *   called directly.
 *
 *   This function is kept for backwards compatibility only (e.g. deep links, tests).
 *   Do NOT add new call sites.
 *
 * Unified login — tries POST /api/auth/login (coaches + Google-linked clients)
 * and falls back to POST /api/auth/client-login (coach-created client accounts).
 */
export async function loginUser(
    email:    string,
    password: string,
): Promise<{ token: string; user: AuthUser }> {
    // ── Step 1: Primary login (coaches + Google-linked accounts) ─────────────
    const primaryResp = await fetch(`${BASE_URL}/api/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
    });
    console.log('[loginUser] primary status:', primaryResp.status);

    if (primaryResp.ok) {
        const data = await primaryResp.json() as LoginResponse;
        return {
            token: data.token,
            user: {
                id:    data.coach._id,
                email: data.coach.email,
                name:  data.coach.name,
                role:  (data.coach.role ?? 'coach') as Role,
            },
        };
    }

    // ── Step 2: Fallback — coach-created client accounts ─────────────────────
    //   Only attempt if primary endpoint signalled "credentials wrong" (401),
    //   not a server error. This avoids double-hitting on network errors.
    if (primaryResp.status === 401) {
        let clientResp: Response | null = null;
        try {
            clientResp = await fetch(`${BASE_URL}/api/auth/client-login`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ email, password }),
            });
            console.log('[loginUser] client fallback status:', clientResp.status);
        } catch {
            // Network error on fallback — fall through to generic error
        }

        if (clientResp?.ok) {
            const data = await clientResp.json() as ClientLoginResponse;
            return {
                token: data.token,
                user: {
                    id:       data.client._id,
                    email:    data.client.email,
                    name:     data.client.name,
                    role:     'client' as Role,
                    clientId: data.client.id,
                },
            };
        }
    }

    // ── Both paths failed — surface a clean error ─────────────────────────────
    throw new Error('Invalid email or password. Please try again.');
}

/**
 * POST /api/auth/google — exchange a Google ID token for a FitnessGuruSG JWT.
 *
 * Response is discriminated by `role`:
 *   role 'coach'  → { coach }   (JWT sub = coaches._id)
 *   role 'client' → { client }  (JWT sub = clients.id UUID; client.has_coach may be false)
 */
export async function googleLogin(idToken: string): Promise<GoogleLoginResponse> {
    const url = `${BASE_URL}/api/auth/google`;
    console.log('[GOOGLE LOGIN] request URL:', url);

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
    });

    console.log('[GOOGLE LOGIN] response status:', response.status);

    if (response.status === 401) {
        let errorMsg = 'Google sign-in failed. Please try again.';
        try {
            const body = await response.json();
            // Surface actionable server messages (e.g. unverified Google email)
            if (typeof body.error === 'string' && body.error.toLowerCase().includes('verif')) {
                errorMsg = body.error;
            }
        } catch { /* ignore parse error */ }
        throw new Error(errorMsg);
    }
    if (response.status === 500) {
        let errorMsg = 'Google login is not configured on this server.';
        try {
            const body = await response.json();
            errorMsg = body.error || errorMsg;
        } catch { /* ignore parse error */ }
        throw new Error(errorMsg);
    }
    if (!response.ok) {
        let errorMsg = `Google login failed (${response.status})`;
        try {
            const body = await response.json();
            errorMsg = body.error || errorMsg;
        } catch { /* ignore parse error */ }
        throw new Error(errorMsg);
    }

    const data = await response.json() as GoogleLoginResponse;
    console.log('[GOOGLE LOGIN] success — role:', data.role, '| token length:', data.token?.length ?? 0);
    return data;
}

// ─── Health ──────────────────────────────────────────────────────────────────

interface HealthResponse {
    status: string;
    timestamp: string;
}

export async function getHealth(): Promise<HealthResponse> {
    const response = await fetch(`${BASE_URL}/api/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse<HealthResponse>(response);
}

// ─── Clients ─────────────────────────────────────────────────────────────────

interface ClientsResponse {
    success: boolean;
    clients: ClientPublic[];
    count: number;
}

/** GET /api/clients — returns clients scoped to the authenticated coach. */
export async function getClients(): Promise<ClientsResponse> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/clients`, { method: 'GET', headers });
    return handleResponse<ClientsResponse>(response);
}

// ─── Check-Ins ───────────────────────────────────────────────────────────────

export async function submitCheckIn(clientId: string, data: CheckInRequest): Promise<CheckInResponse> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/clients/${clientId}/checkins`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
    });
    return handleResponse<CheckInResponse>(response);
}

interface CheckInsResponse {
    success: boolean;
    checkins: CheckIn[];
    count: number;
}

export async function getCheckIns(clientId: string): Promise<CheckInsResponse> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/clients/${clientId}/checkins`, {
        method: 'GET',
        headers,
    });
    return handleResponse<CheckInsResponse>(response);
}

/**
 * GET /api/clients/:clientId/profile  (coach-scoped)
 * Returns body profile fields for a specific client belonging to the coach.
 * Any unset field is null — callers must handle null gracefully.
 */
export async function getClientBodyProfile(clientId: string): Promise<{
    success: boolean;
    profile: ClientBodyProfile;
}> {
    const headers  = await getAuthHeaders();
    const response = await fetchWithTimeout(
        `${BASE_URL}/api/clients/${clientId}/profile`,
        { method: 'GET', headers },
    );
    return handleResponse(response);
}

// ─── Red Flags ───────────────────────────────────────────────────────────────

interface RedFlagsResponse {
    success: boolean;
    redflags: RedFlag[];
    count: number;
}

export async function getRedFlags(clientId: string): Promise<RedFlagsResponse> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/clients/${clientId}/redflags`, {
        method: 'GET',
        headers,
    });
    return handleResponse<RedFlagsResponse>(response);
}

// ─── Client Status (Coach Action Queue) ──────────────────────────────────────

interface ClientStatusResponse {
    success: boolean;
    date: string;
    clients: ClientStatusItem[];
}

/**
 * GET /api/clients/status?date=YYYY-MM-DD
 *
 * Returns check-in status + session plan data for all of the coach's clients.
 * Session plan fields (sessions_remaining, expiry_date, plan_status, etc.) are
 * included per client when they have an active coaching package.
 */
export async function getClientStatus(date?: string): Promise<ClientStatusResponse> {
    const queryDate = date ?? new Date().toISOString().split('T')[0];
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/clients/status?date=${queryDate}`, {
        method: 'GET',
        headers,
    });
    return handleResponse<ClientStatusResponse>(response);
}

// ─── Session Plans ────────────────────────────────────────────────────────────

interface AssignPlanResponse {
    success: boolean;
    plan: ClientPlanAssignment & { plan_status: string; sessions_remaining: number };
}

/**
 * POST /api/clients/:clientId/plan
 * Assigns a session plan to a client.
 * Any previously active plan is automatically expired.
 */
export async function assignPlan(clientId: string, plan: ClientPlanAssignment): Promise<AssignPlanResponse> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/clients/${clientId}/plan`, {
        method: 'POST',
        headers,
        body: JSON.stringify(plan),
    });
    return handleResponse<AssignPlanResponse>(response);
}

/**
 * GET /api/clients/:clientId/session-status
 * Lightweight session status — used for per-client badge rendering.
 */
export async function getSessionStatus(clientId: string): Promise<SessionStatusResponse> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/clients/${clientId}/session-status`, {
        method: 'GET',
        headers,
    });
    return handleResponse<SessionStatusResponse>(response);
}

/**
 * POST /api/clients/:clientId/complete-session
 * Deducts 1 session from the client's active plan.
 * Use this when a session occurs outside of the booking system.
 */
export async function completeSession(clientId: string): Promise<{
    success: boolean;
    sessions_remaining: number;
    sessions_total: number;
    plan_status: string;
    message: string;
}> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/clients/${clientId}/complete-session`, {
        method: 'POST',
        headers,
    });
    return handleResponse(response);
}

// ─── Coach Availability ───────────────────────────────────────────────────────

/**
 * GET /api/coach/availability?from=YYYY-MM-DD
 * Returns the coach's upcoming availability slots.
 */
export async function getCoachAvailability(fromDate?: string): Promise<{ success: boolean; slots: CoachAvailabilitySlot[]; count: number }> {
    const headers = await getAuthHeaders();
    const query   = fromDate ? `?from=${fromDate}` : '';
    const response = await fetch(`${BASE_URL}/api/coach/availability${query}`, {
        method: 'GET',
        headers,
    });
    return handleResponse(response);
}

/**
 * POST /api/coach/availability
 * Creates a new availability slot for the coach.
 */
export async function createAvailabilitySlot(slot: {
    date: string;
    start_time: string;
    end_time: string;
}): Promise<{ success: boolean; slot: CoachAvailabilitySlot }> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/coach/availability`, {
        method: 'POST',
        headers,
        body: JSON.stringify(slot),
    });
    return handleResponse(response);
}

/**
 * POST /api/coach/availability/block
 * Coach blocks a time window — creates a slot with status 'blocked'.
 * Blocked slots are hidden from clients automatically.
 *
 * @param slot.reason  Optional private reason (e.g. 'Lunch break', 'Personal appointment')
 */
export async function blockAvailabilitySlot(slot: {
    date: string;
    start_time: string;
    end_time: string;
    reason?: string;
}): Promise<{ success: boolean; slot: CoachAvailabilitySlot }> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/coach/availability/block`, {
        method: 'POST',
        headers,
        body: JSON.stringify(slot),
    });
    return handleResponse(response);
}

/**
 * PATCH /api/coach/availability/:slotId/unblock
 * Coach removes a block — slot returns to 'available' status.
 */
export async function unblockAvailabilitySlot(slotId: string): Promise<{ success: boolean; slot: CoachAvailabilitySlot }> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/coach/availability/${slotId}/unblock`, {
        method: 'PATCH',
        headers,
    });
    return handleResponse(response);
}

// ─── Bookings ─────────────────────────────────────────────────────────────────

/**
 * POST /api/bookings
 * Books a client into an availability slot.
 */
export async function createBooking(payload: {
    client_id: string;
    availability_slot_id: string;
    notes?: string;
}): Promise<{ success: boolean; booking: BookingSlot }> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/bookings`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });
    return handleResponse(response);
}

/**
 * PATCH /api/bookings/:bookingId/complete
 * Marks a booking as completed. Automatically deducts 1 session.
 */
export async function completeBooking(bookingId: string): Promise<{
    success: boolean;
    booking: BookingSlot;
    sessions_remaining: number;
    plan_status: string;
    message: string;
}> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/bookings/${bookingId}/complete`, {
        method: 'PATCH',
        headers,
    });
    return handleResponse(response);
}

/**
 * PATCH /api/bookings/:bookingId/cancel
 * Cancels a booking. Slot is released; no session deducted.
 */
export async function cancelBooking(bookingId: string): Promise<{ success: boolean; booking: BookingSlot }> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/bookings/${bookingId}/cancel`, {
        method: 'PATCH',
        headers,
    });
    return handleResponse(response);
}

/**
 * PATCH /api/bookings/:bookingId/reschedule
 * Updates start_time and end_time of a 'booked' session.
 * Used by drag-to-reschedule on BookingScreen.
 */
export async function rescheduleBooking(
    bookingId: string,
    start_time: string,
    end_time: string,
): Promise<{ success: boolean; booking: BookingSlot }> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/bookings/${bookingId}/reschedule`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ start_time, end_time }),
    });
    return handleResponse(response);
}

/**
 * POST /api/bookings/quick
 * One-step booking: creates slot + booking in a single request.
 * Only works for clients with an active plan and sessions remaining.
 */
export async function quickBook(payload: QuickBookPayload): Promise<{ success: boolean; booking: BookingSlot }> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/bookings/quick`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });
    return handleResponse(response);
}

// ─── Availability ─────────────────────────────────────────────────────────────

/**
 * GET /api/coach/availability?from=YYYY-MM-DD
 * Returns this coach's availability slots from the given date onwards.
 * If no `from` is specified, defaults to today (backend behaviour).
 *
 * Response shape: { success: true, slots: CoachAvailabilitySlot[], count: number }
 *
 * Mobile usage: called with today's date to get today's availability windows,
 * then used to populate the "Available" section in BookingScreen.
 */
export async function getAvailability(from?: string): Promise<{
    success: boolean;
    slots: CoachAvailabilitySlot[];
    count: number;
}> {
    const headers  = await getAuthHeaders();
    const query    = from ? `?from=${from}` : '';
    const response = await fetch(`${BASE_URL}/api/coach/availability${query}`, {
        method: 'GET',
        headers,
    });
    return handleResponse(response);
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

/**
 * GET /api/coach/dashboard
 * Returns coach summary: total clients, low-session alerts, bookings for the given date.
 *
 * @param date  Optional YYYY-MM-DD. Defaults to today (Asia/Singapore) when omitted.
 */
export async function getDashboard(date?: string): Promise<{ success: boolean } & DashboardSummary> {
    const headers = await getAuthHeaders();
    const query   = date ? `?date=${date}` : '';
    const response = await fetch(`${BASE_URL}/api/coach/dashboard${query}`, {
        method: 'GET',
        headers,
    });
    return handleResponse(response);
}

// ─── Revenue Summary ──────────────────────────────────────────────────────────

export interface ExpiringClientSummary {
    clientId:     string;
    clientName:   string;
    planName:     string;
    expiresInDays: number;
    renewalValue: number;
}

export interface PlanBreakdownItem {
    planName: string;
    count:    number;
    revenue:  number;
}

export interface RevenueSummary {
    success:          boolean;
    month:            string;       // "YYYY-MM"
    currency:         string;       // "SGD"
    actualRevenue:    number;
    projectedRevenue: number;
    activePlans:      number;
    expiringSoon:     number;
    planBreakdown:    PlanBreakdownItem[];
    expiringClients:  ExpiringClientSummary[];
}

/**
 * GET /api/coach/revenue-summary?month=YYYY-MM
 *
 * Returns business overview for the authenticated coach.
 * month defaults to the current SGT calendar month when omitted.
 */
export async function getRevenueSummary(month?: string): Promise<RevenueSummary> {
    const headers = await getAuthHeaders();
    const query   = month ? `?month=${month}` : '';
    const response = await fetch(`${BASE_URL}/api/coach/revenue-summary${query}`, {
        method: 'GET',
        headers,
    });
    return handleResponse(response);
}

// ─── Plan Catalogue ───────────────────────────────────────────────────────────

/**
 * GET /api/plans — PUBLIC, no auth required.
 * Returns the 3 fixed session plan definitions.
 */
export async function getPlans(): Promise<{ success: boolean; plans: SessionPlanCatalogue[] }> {
    console.log('[API] GET /plans');
    const response = await fetchWithTimeout(`${BASE_URL}/api/plans`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse(response);
}

// ─── Payments ─────────────────────────────────────────────────────────────────

/**
 * POST /api/payments
 * Coach initiates a payment record for a client.
 * Creates a Payment with status: 'pending'.
 */
export async function initiatePaymentRequest(payload: {
    client_id: string;
    plan_id: string;
    payment_method: PaymentMethod;
    reference?: string;
    notes?: string;
}): Promise<{ success: boolean; payment: Payment; plan_details: SessionPlanCatalogue }> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/payments`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });
    return handleResponse(response);
}

/**
 * PATCH /api/payments/:paymentId/confirm
 * Coach marks payment as received → sessions are unlocked.
 */
export async function confirmPayment(paymentId: string): Promise<{
    success: boolean;
    payment: Payment;
    sessions_remaining: number;
    expiry_date: string;
}> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/payments/${paymentId}/confirm`, {
        method: 'PATCH',
        headers,
    });
    return handleResponse(response);
}

/**
 * GET /api/payments/pending
 * Coach's queue of payments awaiting confirmation.
 */
export async function getPendingPayments(): Promise<{ success: boolean; payments: Payment[]; count: number }> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/payments/pending`, {
        method: 'GET',
        headers,
    });
    return handleResponse(response);
}

/**
 * GET /api/payments/client/:clientId
 * Full payment history for a specific client (coach-scoped).
 */
export async function getClientPayments(clientId: string): Promise<{ success: boolean; payments: Payment[]; count: number }> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/payments/client/${clientId}`, {
        method: 'GET',
        headers,
    });
    return handleResponse(response);
}


/**
 * POST /api/upload/checkin-photo
 * Upload a SINGLE progress photo immediately after the user selects it.
 * Called once per photo (upload-on-select pattern).
 *
 * Returns a relative URL string: "/uploads/filename.jpg"
 * Compose the full URL for display as: `${BASE_URL}${url}`
 *
 * @param photoUri - local file URI from expo-image-picker
 */
export async function uploadSingleCheckInPhoto(photoUri: string): Promise<string> {
    const headers = await getAuthHeaders();
    // Remove Content-Type — let fetch set the correct multipart boundary
    delete (headers as any)['Content-Type'];

    const filename = photoUri.split('/').pop() ?? 'photo.jpg';
    const ext      = filename.split('.').pop()?.toLowerCase() ?? 'jpeg';
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

    const formData = new FormData();
    formData.append('photo', { uri: photoUri, name: filename, type: mimeType } as any);

    const response = await fetch(`${BASE_URL}/api/upload/checkin-photo`, {
        method:  'POST',
        headers,
        body:    formData,
    });
    const result = await handleResponse<{ success: boolean; url: string }>(response);
    return result.url;  // e.g. "/uploads/1744728000000-abc123.jpg"
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────

/**
 * POST /api/whatsapp/send-message
 * Sends a WhatsApp text message to a recipient via Meta Cloud API.
 *
 * Protected: requires coach JWT (handled automatically by getAuthHeaders).
 *
 * @param to      - Recipient phone number in E.164 format, e.g. "+6591234567"
 * @param message - Plain text message body (max 4096 chars)
 *
 * Usage example (from any coach screen):
 *
 *   import { sendWhatsAppMessage } from '../services/apiClient';
 *   await sendWhatsAppMessage('+6591234567', 'Hi John, your plan expires in 3 days!');
 *
 * Common uses:
 *   - Renewal reminders (plan expiring soon)
 *   - Check-in nudges (client hasn't logged today)
 *   - Session confirmations (booking created or rescheduled)
 */
export async function sendWhatsAppMessage(
    to:      string,
    message: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/whatsapp/send-message`, {
        method:  'POST',
        headers,
        body:    JSON.stringify({ to, message }),
    });
    return handleResponse(response);
}

// ─── Client Booking (client JWT) ──────────────────────────────────────────────

/**
 * GET /api/clients/me/availability
 * Returns open (unbooked, future) availability slots for the coach.
 * Called by ClientBookingScreen to show slots the client can book.
 */
export async function getClientAvailableSlots(): Promise<{
    success: boolean;
    slots: CoachAvailabilitySlot[];
}> {
    const headers  = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/clients/me/availability`, { headers });
    return handleResponse(response);
}

/**
 * POST /api/clients/me/bookings
 * Client self-books an open slot.
 * Returns the created booking on success.
 * Throws if slot is already booked (409) or client has no active plan (400).
 */
export async function clientBookSlot(params: {
    slot_id: string;
    notes?:  string;
}): Promise<{ success: boolean; booking: BookingSlot }> {
    const headers  = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/clients/me/bookings`, {
        method:  'POST',
        headers,
        body:    JSON.stringify(params),
    });
    return handleResponse(response);
}

/**
 * GET /api/clients/me/bookings
 * Returns the client's full booking history (all statuses).
 * Used by ClientMyBookingsScreen.
 */
export async function getClientBookings(): Promise<{
    success: boolean;
    bookings: BookingSlot[];
}> {
    const headers  = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/clients/me/bookings`, { headers });
    return handleResponse(response);
}

/**
 * PATCH /api/clients/me/bookings/:bookingId/cancel
 * Client cancels their own upcoming booking.
 * Slot is released back to open. Sessions are NOT deducted.
 */
export async function clientCancelBooking(bookingId: string): Promise<{
    success: boolean;
    booking: BookingSlot;
}> {
    const headers  = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/clients/me/bookings/${bookingId}/cancel`, {
        method: 'PATCH',
        headers,
    });
    return handleResponse(response);
}

// ─── Client body profile ──────────────────────────────────────────────────────

export interface ClientBodyProfile {
    height_cm:           number | null;
    weight_kg:           number | null;
    fitness_goal:        string | null;
    injuries_notes:      string | null;
    training_experience: string | null;
    // Body measurements (cm)
    neck_cm:             number | null;
    chest_cm:            number | null;
    waist_cm:            number | null;
    hips_cm:             number | null;
}

/**
 * GET /api/clients/me/profile
 * Fetch the client's saved body profile fields.
 * Returns null for any field the client hasn't filled in yet.
 */
export async function getClientProfile(): Promise<{
    success: boolean;
    profile: ClientBodyProfile;
}> {
    const headers  = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/clients/me/profile`, { headers });
    return handleResponse(response);
}

/**
 * PATCH /api/clients/me/profile
 * Save (partial) profile updates — name and/or body profile fields.
 * Only send the fields you want to change — omitted fields are untouched.
 *
 * Returns { name } if a name was saved, so the caller can update AuthContext
 * immediately without an extra GET call.
 */
export async function updateClientProfile(data: Partial<{
    name:                string;
    height_cm:           number;
    weight_kg:           number;
    fitness_goal:        string;
    injuries_notes:      string;
    training_experience: string;
    neck_cm:             number;
    chest_cm:            number;
    waist_cm:            number;
    hips_cm:             number;
}>): Promise<{ success: boolean; message: string; name?: string }> {
    const headers  = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/clients/me/profile`, {
        method:  'PATCH',
        headers,
        body:    JSON.stringify(data),
    });
    return handleResponse(response);
}

/**
 * PATCH /api/clients/me/checkin-prefs
 * Persist the client's check-in reminder preference and/or pause/resume state.
 *
 * Fields (both optional — send only what changed):
 *   check_in_reminders_enabled: true = opted in | false = "not now"
 *   check_in_status: 'active' | 'paused'
 */
export async function updateCheckInPrefs(data: {
    check_in_reminders_enabled?: boolean;
    check_in_status?: 'active' | 'paused';
}): Promise<{ success: boolean; message: string }> {
    const headers  = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/clients/me/checkin-prefs`, {
        method:  'PATCH',
        headers,
        body:    JSON.stringify(data),
    });
    return handleResponse(response);
}

// ─── Workout (─────────────────────────────────────────────────────────────

/**
 * GET /api/clients/me/workout/today
 * Returns the coach-assigned workout for today + any existing log.
 *
 * Fails gracefully: never throws to the caller on network error.
 * Returns { success: false, assignment: null, log: null } on failure so
 * the caller can safely degrade without impacting the daily check-in form.
 */
export async function getTodayWorkout(): Promise<WorkoutAssignmentWithLog> {
    try {
        const headers  = await getAuthHeaders();
        const response = await fetchWithTimeout(
            `${BASE_URL}/api/clients/me/workout/today`,
            { method: 'GET', headers },
        );
        return handleResponse<WorkoutAssignmentWithLog>(response);
    } catch (err: any) {
        console.warn('[API] getTodayWorkout failed (non-fatal):', err.message);
        return { success: false, assignment: null, log: null };
    }
}

/**
 * POST /api/clients/me/workout-log
 * Client submits (or re-submits) their workout log for an assignment.
 *
 * Only exercise_id + actual performance fields are sent.
 * The backend ignores any name/target fields the client may send.
 */
export async function submitWorkoutLog(
    assignmentId:  string,
    exerciseLogs:  ExerciseLog[],
): Promise<{ success: boolean; log?: any; error?: string }> {
    const headers  = await getAuthHeaders();
    const response = await fetchWithTimeout(
        `${BASE_URL}/api/clients/me/workout-log`,
        {
            method:  'POST',
            headers,
            body:    JSON.stringify({
                assignment_id:  assignmentId,
                exercise_logs:  exerciseLogs.map(el => ({
                    exercise_id:   el.exercise_id,
                    completed:     el.completed,
                    actual_sets:   el.actual_sets,
                    actual_reps:   el.actual_reps,
                    actual_weight: el.actual_weight,
                    difficulty:    el.difficulty,
                    notes:         el.notes,
                })),
            }),
        },
    );
    return handleResponse(response);
}

/**
 * POST /api/coach/clients/:clientId/workouts
 * Coach assigns a workout to a client for a specific date.
 *
 * Body: { date, title, exercises: [{ name, target_sets, target_reps, target_weight?, notes? }] }
 */
export async function assignWorkout(
    clientId: string,
    payload: {
        date:       string;
        title:      string;
        exercises:  Array<{
            name:           string;
            target_sets:    number;
            target_reps:    number;
            target_weight?: number;
            notes?:         string;
        }>;
    },
): Promise<{ success: boolean; assignment: WorkoutAssignment }> {
    const headers  = await getAuthHeaders();
    const response = await fetchWithTimeout(
        `${BASE_URL}/api/coach/clients/${clientId}/workouts`,
        {
            method:  'POST',
            headers,
            body:    JSON.stringify(payload),
        },
    );
    return handleResponse(response);
}

// ─── Workout History ─────────────────────────────────────────────────────────

/**
 * GET /api/clients/me/workout/history
 * Returns the client's past workout assignments + logs (most recent 30).
 * Used for exercise history display and personal best computation.
 *
 * Fails gracefully — returns empty entries on error so the UI can degrade.
 */
export async function getWorkoutHistory(): Promise<WorkoutHistoryResponse> {
    try {
        const headers  = await getAuthHeaders();
        const response = await fetchWithTimeout(
            `${BASE_URL}/api/clients/me/workout/history`,
            { method: 'GET', headers },
        );
        return handleResponse<WorkoutHistoryResponse>(response);
    } catch (err: any) {
        console.warn('[API] getWorkoutHistory failed (non-fatal):', err.message);
        return { success: false, entries: [] };
    }
}
