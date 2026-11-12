/**
 * FitnessGuruSG — Premium Design System
 *
 * Aesthetic: Premium global wellness · Professional coaching · Calm & trustworthy
 * No loud gradients. No playful colors. Clean typographic hierarchy.
 *
 * Color Rules (enforced by design):
 *   Navy  (#183A4A) = primary brand, buttons, active nav, header text
 *   Teal  (#0F766E) = accent CTAs, links, active elements
 *   Green (#16A34A) = positive / completed / on-track / success
 *   Amber (#B45309) = needs attention / follow-up / expiring soon
 *   Red   (#DC2626) = CRITICAL ONLY — expired plan, failed payment, serious alert
 *   Blue  (#2563EB) = informational / booked status / tips
 *
 * Design-kit tokens (`palette`, `tints`, `badgeColors`) repeat these same
 * colours. They do not introduce a second, brighter set.
 */

// ─── Colors ──────────────────────────────────────────────────────────────────

export const colors = {
    // ── Brand ─────────────────────────────────────────────────────────────────
    /** Deep navy — headers, primary buttons, navigation */
    primary:        '#183A4A',
    /** Darker navy — pressed states, status bar */
    primaryDark:    '#0F2A37',

    // ── Backgrounds ───────────────────────────────────────────────────────────
    /** App-wide background */
    background:     '#F7F8FA',
    /** Cards, inputs, modals */
    surface:        '#FFFFFF',
    /** Inactive sections, disabled backgrounds, alt card surfaces */
    surfaceMuted:   '#F3F4F6',
    /** Subtle dividers */
    border:         '#E5E7EB',
    /** Inner dividers, very subtle separators */
    borderLight:    '#F0F1F3',

    // ── Text ──────────────────────────────────────────────────────────────────
    /** Main content text — near-black */
    textPrimary:    '#111827',
    /** Meta, captions, secondary labels */
    textSecondary:  '#6B7280',
    /** Placeholders, hints, disabled text */
    textTertiary:   '#9CA3AF',
    /** Text on navy/teal buttons */
    textOnPrimary:  '#FFFFFF',
    /** Input placeholders (alias for textTertiary) */
    placeholder:    '#9CA3AF',

    // ── Accent — teal ─────────────────────────────────────────────────────────
    /** Teal — CTAs, links, active elements */
    accent:         '#0F766E',
    /** Soft mint — accent backgrounds, subtle tint */
    accentSubtle:   '#E6F7F1',

    // ── Primary button / brand chrome — deep navy ──────────────────────────────
    buttonPrimaryBg:   '#183A4A',
    buttonPrimaryText: '#FFFFFF',
    buttonDisabledBg:  '#D1D5DB',

    // ── Status badges (inline pills on cards) ─────────────────────────────────
    //    SUCCESS — soft sage green: present, calm, confident
    badgeSuccessBg:    '#DCFCE7',
    badgeSuccessText:  '#16A34A',

    //    WARNING — soft amber: needs attention, NOT emergency
    badgeWarningBg:    '#FEF3C7',
    badgeWarningText:  '#92400E',

    //    NEUTRAL
    badgeNeutralBg:    '#F3F4F6',
    badgeNeutralText:  '#6B7280',

    // ── Error — system errors & auth failures ────────────────────────────────
    errorBg:     '#FEF2F2',
    errorBorder: '#FECACA',
    errorText:   '#DC2626',

    // ── AMBER — "needs attention" (follow-up, low sessions, expiring soon) ─────
    //    Rule: amber = attention, not emergency. Coach needs to act, but no crisis.
    amberBg:     '#FFFBEB',
    amberBorder: '#FDE68A',
    amberText:   '#B45309',

    //    Deprecated mapping (use amber tokens instead)
    urgentBg:     '#FFFBEB',
    urgentBorder: '#FDE68A',
    urgentText:   '#B45309',

    // ── CRITICAL — true urgency only ─────────────────────────────────────────
    //    Use ONLY for: expired plan, repeated missed sessions, failed payment,
    //    serious health alert, critical app error.
    criticalBg:     '#FEF2F2',
    criticalBorder: '#FECACA',
    criticalText:   '#DC2626',

    // ── WARNING card backgrounds (pending/expiring) — warm amber ──────────────
    warningBg:     '#FFFBEB',
    warningBorder: '#FDE68A',

    //    SUCCESS card backgrounds (checked-in/completed) — soft sage
    successBg:     '#F0FDF4',
    successBorder: '#BBF7D0',

    // ── INFO — informational states (booked, tips, educational) ───────────────
    infoBg:     '#EFF6FF',
    infoBorder: '#BFDBFE',
    infoText:   '#2563EB',

    // ── Dashboard stat tiles ──────────────────────────────────────────────────
    statBg:   '#183A4A',
    statText: '#FFFFFF',

    // ── Celebration / streak ──────────────────────────────────────────────────
    celebrationAccent: '#6D28D9',

    // ── Tab bar ───────────────────────────────────────────────────────────────
    tabActive:   '#183A4A',
    tabInactive: '#9CA3AF',

    // ── Avatar defaults ───────────────────────────────────────────────────────
    /** Default avatar background — mint tint */
    avatarBg:   '#E6F7F1',
    /** Default avatar initials — teal */
    avatarText: '#0F766E',
};

/**
 * Design-kit swatches. Same colours as the live app, including the coach
 * dashboard: navy cards, teal Assign Workout card, sage green, amber, greys.
 */
export const palette = {
    /** Navy cards, greeting, primary buttons. Same as `colors.primary`. */
    primary:    '#183A4A',
    /** Links and active states. Same as `colors.accent`. */
    teal:       '#0F766E',
    /** Assign Workout card on the coach dashboard. */
    tealAction: '#0D7B76',
    /** Positive green. Same as `colors.badgeSuccessText`. */
    mint:       '#16A34A',
    success:    '#16A34A',
    /** Attention, not an emergency. Same as `colors.amberText`. */
    warning:    '#B45309',
    /** Critical only. Same as `colors.errorText`. */
    danger:     '#DC2626',
    gray900:    '#111827',
    gray600:    '#6B7280',
    gray400:    '#9CA3AF',
    gray300:    '#D1D5DB',
    gray100:    '#F3F4F6',
    /** App background. Same as `colors.background`. */
    background: '#F7F8FA',
    white:      '#FFFFFF',
} as const;

/**
 * Pale fills already used behind icons and badges.
 */
export const tints = {
    /** Same as `colors.accentSubtle`. */
    tealSoft: '#E6F7F1',
    /** Same as `colors.surfaceMuted`. */
    navySoft: '#F3F4F6',
} as const;

/**
 * Status pills. Each pair is an existing badge colour from `colors`
 * (sage, amber, grey, red, teal, blue). Follow-up and expiring soon
 * share the calm amber pair — not a red alert.
 */
export const badgeColors = {
    activePlan:    { background: '#DCFCE7', text: '#16A34A' },
    followUp:      { background: '#FEF3C7', text: '#92400E' },
    noPlan:        { background: '#F3F4F6', text: '#6B7280' },
    missedCheckIn: { background: '#FEF2F2', text: '#DC2626' },
    completed:     { background: '#DCFCE7', text: '#16A34A' },
    cancelled:     { background: '#F3F4F6', text: '#6B7280' },
    open:          { background: '#E6F7F1', text: '#0F766E' },
    booked:        { background: '#EFF6FF', text: '#2563EB' },
    expiringSoon:  { background: '#FEF3C7', text: '#92400E' },
} as const;


// ─── Spacing scale ────────────────────────────────────────────────────────────
//
// xs  (4)  — icon gaps, tight inline spacing
// sm  (8)  — between related elements inside a card
// md  (12) — card internal padding (compact sections)
// base(16) — standard card padding, horizontal margins
// lg  (20) — between cards within a section
// xl  (24) — between sections
// xxl (32) — major section separation
// section (40) — screen-level section breaks

export const spacing = {
    xs:      4,
    sm:      8,
    md:      12,
    base:    16,
    lg:      20,
    xl:      24,
    xxl:     32,
    section: 40,
};

// ─── Border radius ────────────────────────────────────────────────────────────

export const radius = {
    xs:    4,     // tiny elements, inline badges
    sm:    8,     // small buttons, tags
    md:    12,    // inputs, inner cards
    input: 14,    // ← legacy alias, prefer md
    card:  16,    // primary cards
    cardLg: 18,   // ← legacy alias, prefer lg
    lg:    20,    // modal sheets, large cards
    pill:  100,   // badges, chips, full-round elements
};

// ─── Typography ───────────────────────────────────────────────────────────────
//
// Sizes and weights below stay free of a font family on purpose.
// Poppins (headings) and Inter (body) are applied by fontStyle() in
// src/theme/fonts.tsx, and only after the font files have loaded.
// Screens that do not opt in keep the phone's built-in font.

export const typography = {
    /** Hero greetings, display headings */
    display:  { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5, lineHeight: 34 },
    /** Legacy alias for display — prefer `display` */
    displayLg: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5, lineHeight: 34 },
    /** Screen titles */
    h1:       { fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.3, lineHeight: 30 },
    /** Section headings */
    h2:       { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.2, lineHeight: 26 },
    /** Card titles */
    h3:       { fontSize: 17, fontWeight: '600' as const, lineHeight: 22 },
    /** Large body text */
    bodyLg:   { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
    /** Standard body text */
    body:     { fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
    /** Form labels, small headings */
    label:    { fontSize: 13, fontWeight: '600' as const, letterSpacing: 0.1 },
    /** Captions, timestamps */
    caption:  { fontSize: 12, fontWeight: '400' as const, lineHeight: 16 },
    /** Micro labels, badge text */
    micro:    { fontSize: 11, fontWeight: '500' as const, letterSpacing: 0.5 },
    /** Large stat numbers */
    metric:   { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5, lineHeight: 34 },
    /** Primary button text */
    buttonLg: { fontSize: 16, fontWeight: '700' as const, letterSpacing: 0.2 },
    /** Secondary/small button text */
    buttonSm: { fontSize: 13, fontWeight: '700' as const, letterSpacing: 0.1 },
};

// ─── Component sizes ──────────────────────────────────────────────────────────

export const componentSize = {
    input:    52,
    button:   52,
    buttonSm: 40,
    avatar:   40,    // default avatar size
    avatarSm: 32,    // small avatar (schedule rows, inline)
    avatarLg: 56,    // large avatar (profile headers, detail screens)
};

// ─── Shadows — minimal, use borders instead ───────────────────────────────────

export const shadows = {
    none: {},
    card: {
        shadowColor:   '#000',
        shadowOffset:  { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius:  3,
        elevation:     1,
    },
    cardElevated: {
        shadowColor:   '#000',
        shadowOffset:  { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius:  6,
        elevation:     3,
    },
    modal: {
        shadowColor:   '#000',
        shadowOffset:  { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius:  16,
        elevation:     8,
    },
    /** White cards in the design kit — a soft navy-tinted lift */
    soft: {
        shadowColor:   palette.primary,
        shadowOffset:  { width: 0, height: 8 },
        shadowOpacity: 0.06,
        shadowRadius:  16,
        elevation:     3,
    },
};
