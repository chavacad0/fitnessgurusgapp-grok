# Changelog

Notable changes to FitnessGuruSG, in plain language.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Headings use dates, because this app is not shipped as numbered public releases yet.

## How to update this file

- While a pull request is open, add one short entry under **Unreleased / in review**. Link the pull request. Say what a person using the app will notice.
- When that pull request merges, move the entry into a new dated section (`## [YYYY-MM-DD]`) and take it out of Unreleased. Do not rewrite older dated sections.
- Group lines as Added, Changed, or Fixed when that makes the list easier to scan.
- Leave out secrets, tokens, and personal data. Open problems belong in [docs/AUDIT.md](docs/AUDIT.md), not here, until a change actually fixes them.

## [Unreleased]

### In review

- [Pull request #7](https://github.com/chavacad0/fitnessgurusgapp-grok/pull/7) — Docs only. Inside the Motivation & Rewards future plan, `PROJECT_STATUS.md` adds Holiday mode (pause): the client sets dates, the streak freezes, reminders pause, and the coach sees a calm holiday badge. Whether paid plan dates extend is an open decision. Nothing in the app is built. The audit log is unchanged.

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
