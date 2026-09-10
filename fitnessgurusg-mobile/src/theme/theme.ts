/**
 * FitnessGuruSG — Premium Design System
 *
 * Aesthetic: Executive · Minimal · Singapore boutique fitness quality
 * No loud gradients. No playful colors. Clean typographic hierarchy.
 *
 * Color Rules (enforced by design):
 *   Navy  (#183A4A) = primary brand, buttons, active nav, header
 *   Green (#16A34A) = positive / completed / on-track
 *   Amber (#B45309) = needs attention / follow-up / expiring soon
 *   Red   (#DC2626) = CRITICAL ONLY — expired plan, failed payment, serious alert
 */

// ─── Colors ──────────────────────────────────────────────────────────────────

export const colors = {
    // ── Backgrounds ───────────────────────────────────────────────────────────
    background: '#F7F8FA',         // clean neutral — per spec
    surface: '#FFFFFF',            // cards, inputs, modals
    border: '#E5E7EB',             // subtle dividers — per spec

    // ── Text ──────────────────────────────────────────────────────────────────
    textPrimary: '#111827',        // near-black — per spec
    textSecondary: '#6B7280',      // meta, captions — per spec
    placeholder: '#9CA3AF',        // inputs

    // ── Accent — teal ─────────────────────────────────────────────────────────
    accent: '#0F766E',             // Teal Accent — per spec
    accentSubtle: '#E6F7F1',       // Soft Mint — per spec

    // ── Primary button / brand chrome — deep navy ──────────────────────────────
    buttonPrimaryBg: '#183A4A',    // Primary Navy — per spec
    buttonPrimaryText: '#FFFFFF',
    buttonDisabledBg: '#D1D5DB',

    // ── Status badges (inline pills on cards) ─────────────────────────────────
    //    SUCCESS — soft sage green: present, calm, confident
    badgeSuccessBg: '#DCFCE7',     // Success Green tint — per spec
    badgeSuccessText: '#16A34A',   // Success Green — per spec

    //    WARNING — soft amber: needs attention, NOT emergency
    badgeWarningBg: '#FEF3C7',     // Soft Amber Background — per spec
    badgeWarningText: '#92400E',   // Warm amber-brown — readable, not saturated

    //    NEUTRAL
    badgeNeutralBg: '#F3F4F6',
    badgeNeutralText: '#6B7280',

    // ── Error — system errors & auth failures ────────────────────────────────
    errorBg: '#FEF2F2',
    errorBorder: '#FECACA',
    errorText: '#DC2626',          // Danger Red — per spec

    // ── AMBER — "needs attention" (follow-up, low sessions, expiring soon) ─────
    //    Rule: amber = attention, not emergency. Coach needs to act, but no crisis.
    amberBg: '#FFFBEB',           // Soft amber wash — calm, professional
    amberBorder: '#FDE68A',       // Amber border — visible but gentle
    amberText: '#B45309',         // Deep amber — WCAG AA contrast on amber tint

    //    Deprecated mapping (use amber tokens instead)
    urgentBg: '#FFFBEB',
    urgentBorder: '#FDE68A',
    urgentText: '#B45309',

    // ── CRITICAL — true urgency only ─────────────────────────────────────────
    //    Use ONLY for: expired plan, repeated missed sessions, failed payment,
    //    serious health alert, critical app error.
    criticalBg: '#FEF2F2',         // Rose red tint
    criticalBorder: '#FECACA',     // Light red border
    criticalText: '#DC2626',       // Danger Red — per spec

    // ── WARNING card backgrounds (pending/expiring) — warm amber ──────────────
    warningBg: '#FFFBEB',          // matches amberBg
    warningBorder: '#FDE68A',      // matches amberBorder

    //    SUCCESS card backgrounds (checked-in/completed) — soft sage
    successBg: '#F0FDF4',
    successBorder: '#BBF7D0',

    // ── Dashboard stat tiles ──────────────────────────────────────────────────
    statBg: '#183A4A',             // Primary Navy — per spec
    statText: '#FFFFFF',

    // ── Celebration / streak ──────────────────────────────────────────────────
    celebrationAccent: '#6D28D9',  // deep violet — slightly deeper than before

    // ── Tab bar ───────────────────────────────────────────────────────────────
    tabActive: '#183A4A',          // Primary Navy — per spec
    tabInactive: '#9CA3AF',
};


// ─── Spacing scale ────────────────────────────────────────────────────────────

export const spacing = {
    xs: 4,
    sm: 8,
    md: 12,
    base: 16,
    lg: 20,
    xl: 24,
    xxl: 32,
    section: 40,
};

// ─── Border radius ────────────────────────────────────────────────────────────

export const radius = {
    sm: 8,
    md: 12,
    input: 14,
    card: 16,
    cardLg: 18,
    pill: 100,
};

// ─── Typography ───────────────────────────────────────────────────────────────

export const typography = {
    displayLg: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.5, lineHeight: 36 },
    h1: { fontSize: 26, fontWeight: '700' as const, letterSpacing: -0.3, lineHeight: 32 },
    h2: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.2 },
    h3: { fontSize: 17, fontWeight: '600' as const },
    bodyLg: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
    body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
    label: { fontSize: 13, fontWeight: '600' as const, letterSpacing: 0.1 },
    caption: { fontSize: 12, fontWeight: '400' as const, lineHeight: 16 },
    micro: { fontSize: 11, fontWeight: '500' as const, letterSpacing: 0.5 },
};

// ─── Component sizes ──────────────────────────────────────────────────────────

export const componentSize = {
    input: 52,
    button: 52,
    buttonSm: 40,
};

// ─── Shadows — minimal, use borders instead ───────────────────────────────────

export const shadows = {
    card: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
        elevation: 1,
    },
    cardElevated: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.10,
        shadowRadius: 8,
        elevation: 4,
    },
};
