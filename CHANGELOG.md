# Changelog

Notable changes to FitnessGuruSG, in plain language.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Headings use dates, because this app is not shipped as numbered public releases yet.

## How to update this file

- While a pull request is open, add one short entry under **Unreleased / in review**. Link the pull request. Say what a person using the app will notice.
- When that pull request merges, move the entry into a new dated section (`## [YYYY-MM-DD]`) and take it out of Unreleased. Do not rewrite older dated sections.
- Group lines as Added, Changed, or Fixed when that makes the list easier to scan.
- Leave out secrets, tokens, and personal data. Open problems belong in [docs/AUDIT.md](docs/AUDIT.md), not here, until a change actually fixes them.

## [Unreleased]

### Changed

- [Pull request #14](https://github.com/chavacad0/fitnessgurusgapp-grok/pull/14) — Welcome is a full-screen navy screen with a white FG tile, a white Log in button, and an outlined Sign up button. The feature chips are gone. Log in puts the back button on its own row, uses line icons for Client and Coach, and shows the coach note under that switch. The Google button uses the coloured G. Signing in works the same way.

### Fixed

- Booking reliability, [pull request #17](https://github.com/chavacad0/fitnessgurusgapp-grok/pull/17) (AUD-010, AUD-011, AUD-012): a cancelled time slot can be booked again. A booking is refused when the client has no sessions left, and the coach's Book-a-client sheet shows that client as unavailable. A normal check-in no longer raises a false missed-workout flag.

- Security, [pull request #15](https://github.com/chavacad0/fitnessgurusgapp-grok/pull/15): coach-only routes now refuse a client login. A login token with no role is logged out (401) instead of being treated as a coach. WhatsApp sending from the server is coach-only and switched off until `WHATSAPP_ENABLED` is true (AUD-003). Booking another coach's client is refused before any plan lookup. `npm run test:auth` uses `TEST_MONGODB_URI` only.

- Security (AUD-005), [pull request #13](https://github.com/chavacad0/fitnessgurusgapp-grok/pull/13): `npm test` no longer deletes every client from the database the app is configured with. It connects only through `TEST_MONGODB_URI`, and it refuses to delete unless `NODE_ENV` is `test` and the database name ends with `_test`. It deletes only the rows that test created.

### In review

- [Pull request #7](https://github.com/chavacad0/fitnessgurusgapp-grok/pull/7) — Docs only. Inside the Motivation & Rewards future plan, `PROJECT_STATUS.md` adds Holiday mode (pause): the client sets dates, the streak freezes, reminders pause, and the coach sees a calm holiday badge. Whether paid plan dates extend is an open decision. Nothing in the app is built. The audit log is unchanged.
- [Pull request #10](https://github.com/chavacad0/fitnessgurusgapp-grok/pull/10) — Client Progress, Book, and My Plan follow the approved mockups, using only information the app already stores. Progress shows check-in and workout counts, current weight, waist, and height, recent workouts, and check-in history. Book has a navy header, a clearer day strip, and slot cards with the same booking steps. My Plan shows sessions left and an Expiring Soon pill when the end date is close. The consistency ring, energy chart, badges, session-type switch, and weight-change history are not shown. Payment button words and booking rules are unchanged.
- [Pull request #9](https://github.com/chavacad0/fitnessgurusgapp-grok/pull/9) — Client Home and Profile follow the approved mockups, using only information the app already stores. Home has a navy greeting, a shorter reminder card, and larger 1–10 buttons in two rows. Profile shows a navy header and a body-measurement figure with the saved neck, bust, waist, and hips numbers, or “Not set” when a number is missing. Streaks, badges, holiday mode, and profile tabs are not shown. Login, payments, photos, and coach screens are unchanged.
- [Pull request #11](https://github.com/chavacad0/fitnessgurusgapp-grok/pull/11) — On Home, the Energy and Appetite rating cards stay closed until you tap that tile in Today so far. Tap again to close it. The number on the tile still updates, and it is still saved as 1 to 10. Steps, reminders, and Submit are unchanged.
- [Pull request #12](https://github.com/chavacad0/fitnessgurusgapp-grok/pull/12) — Body Measurements on Profile uses the approved figure, with tape marks on the neck, chest, waist, and hips. The chest tile is labelled Chest. Saved numbers, Add, Edit, and the tap-for-instructions notes work the same way.

### Added

- [Pull request #8](https://github.com/chavacad0/fitnessgurusgapp-grok/pull/8) — PROJECT_STATUS: all-in-one client app roadmap based on Trainerize comparison. Docs only. Nothing in the app is built.

## [2026-11-12]

### Added

- [Pull request #1](https://github.com/chavacad0/fitnessgurusgapp-grok/pull/1) — A client can connect to their coach with the coach's invite code (Option C). Google sign-in still keeps a real coach as a coach. Everyone else is stored as a client, with no coach attached until they enter a code. A client with no coach sees Connect-to-Coach on the Book tab. Create Account can take an optional code; a wrong code does not create the account. A second code cannot replace a coach who is already linked. New client login tokens carry the client's own id, the same id used on bookings, plans, and payments. Older tokens still work. The API gained `npm run test:auth` and `npm run typecheck` (via a new `tsconfig.server.json`, because the root TypeScript config still points at Expo).
- [Pull request #3](https://github.com/chavacad0/fitnessgurusgapp-grok/pull/3) — Shared design kit for the phone app: colours, spacing, cards, buttons, status pills, empty messages, session icons, and initials avatars. Poppins (headings) and Inter (body) load when the app opens, and the phone's normal font is used if they fail. The coach Dashboard is polished with the same colours it already had. The client Profile circle shows initials as a small preview. Other coach screens, and Log in / Sign up, are unchanged in this pull request.
- [Pull request #5](https://github.com/chavacad0/fitnessgurusgapp-grok/pull/5) — Docs only. `PROJECT_STATUS.md` adds a second future plan, Motivation & Rewards (gamification), next to the Client Community Feed. It is not started. Nothing in the app changes. The audit log is unchanged: pull requests #2 and #3 did not fix any open finding.

### Changed

- [Pull request #2](https://github.com/chavacad0/fitnessgurusgapp-grok/pull/2) — Log in with the wrong role shows one safe message. A client who picks Coach, a coach who picks Client, an unknown email, and a wrong password all see the same sentence for that switch, so the screen does not reveal which emails are registered. Welcome, Log in, and Sign up use those words consistently. Sign up still creates a client account. Coach accounts are still set up by FitnessGuruSG. `PROJECT_STATUS.md` records a future idea for a client community feed. That feed is not built.
- [Pull request #6](https://github.com/chavacad0/fitnessgurusgapp-grok/pull/6) — Client screens look a bit calmer, using the shared cards, buttons, and status pills. Home reminders are navy and white instead of a blue banner. Progress and Book show clearer empty messages. My Plan shows an Active Plan pill. Profile empty values are quieter. Colours, fonts, coach screens, login, and payments are unchanged.
