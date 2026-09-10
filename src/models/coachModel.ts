/**
 * Coach model — stored in MongoDB 'coaches' collection.
 * Coaches are the authenticated users (fitness trainers).
 *
 * Subscription logic has been removed — this app is a coach management
 * tool, not a SaaS. Coaches are paid outside the app.
 */

/**
 * User role — determines which navigator the mobile app renders after login.
 * 'coach' → AppTabs (Clients / CheckIn / Insights / Bookings)
 * 'client' → ClientAppTabs (Home / Progress / Profile)
 *
 * New Google OAuth users default to 'client'.
 * Coaches are created via email/password registration or manual promotion.
 */
export type UserRole = 'coach' | 'client';

/**
 * Auth provider — 'local' = email/password, 'google' = Google OAuth.
 * Google users have no password_hash (stored as '').
 */
export type AuthProvider = 'local' | 'google';

export interface Coach {
    _id?: string;
    email: string;           // Unique — used as login identifier
    password_hash?: string;  // bcrypt hash — present for 'local'; empty string for 'google'
    name: string;
    createdAt: Date;

    // ── Role ────────────────────────────────────────────────────────
    role: UserRole;          // 'coach' | 'client'; determines mobile navigator

    // ── Auth provider ────────────────────────────────────────────────
    provider:  AuthProvider;  // 'local' | 'google'
    googleId?: string;        // Google's 'sub' claim — unique per Google account
    picture?:  string;        // Profile photo URL from Google (optional)

    // ── Invite code ──────────────────────────────────────────────────
    /**
     * Short alphanumeric code coach shares with clients.
     * Clients enter this during self-registration to be linked to this coach.
     * Generated on-demand by GET /api/auth/invite-code (lazy — not created at registration).
     * Stored in lowercase, displayed in uppercase.
     */
    inviteCode?: string;
}

/**
 * Safe public coach response — strips password_hash and sensitive fields.
 * Returned by /api/auth/login, /api/auth/register, /api/auth/me, /api/auth/google.
 */
export interface CoachPublic {
    _id: string;
    email: string;
    name: string;
    role: UserRole;   // 'coach' | 'client' — mobile uses this for navigation
    createdAt: Date;
    inviteCode?: string; // included when coach requests their own profile
}

/**
 * Converts a full Coach document to the safe public shape.
 * Used in every auth route response.
 */
export function toPublicCoach(coach: Coach & { _id: any }): CoachPublic {
    return {
        _id:        coach._id.toString(),
        email:      coach.email,
        name:       coach.name,
        role:       coach.role ?? 'coach',
        createdAt:  coach.createdAt,
        inviteCode: coach.inviteCode, // undefined for coaches that haven't generated a code yet
    };
}
