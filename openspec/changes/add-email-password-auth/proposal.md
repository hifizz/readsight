## Why

Readsight currently behaves as a single-user service: its public API has no authentication, and all learning history is stored and queried globally. Before other people can use the extension safely, the service needs a small self-hosted account boundary so each person has private learning data and model-backed endpoints cannot be consumed anonymously.

## What Changes

- Add self-service registration and sign-in with email and password, backed by the existing PostgreSQL database; email verification and outbound email are explicitly deferred.
- Add persistent, revocable sessions suitable for a Chrome MV3 extension, with the extension authenticating API calls through a bearer credential rather than cross-site cookies.
- Add sign-out and expired-session handling in the extension, while documenting that password recovery and password changes are unavailable in this release.
- Associate selection contexts, encounter events, and chat messages with a user and require every private read and write to be scoped to the authenticated user.
- Keep dictionary entries, translations, and the retained TTS cache global and content-addressed so users continue sharing safe, non-personal caches.
- Add per-user usage accounting and enforce conservative limits on model-backed chat, translation, and lookup work, alongside basic registration and sign-in rate limits.
- Migrate the existing single-user learning records to a designated owner account before making user ownership mandatory.
- **BREAKING**: Require authentication for extension API operations that read or write learning data or can consume paid model capacity; an old unauthenticated extension build will receive `401 Unauthorized` after the protected backend is deployed.

## Capabilities

### New Capabilities

- `extension-user-auth`: Email/password registration, sign-in, bearer sessions, sign-out, and extension authentication state without email verification or recovery.
- `user-data-isolation`: Ownership and authorization rules for private learning records while preserving global shared caches.
- `api-usage-controls`: Per-user accounting, model-usage limits, and authentication abuse controls for the public self-hosted API.

### Modified Capabilities

None. Existing model-routing and browser-speech requirements do not change.

## Impact

- Backend authentication and API boundaries: new auth configuration/routes plus session checks across chat, lookup, translation, encounter, history, known-items, and selection-context handlers.
- Database and migrations: authentication tables, user ownership columns and indexes, usage-accounting data, and a controlled backfill of existing private rows.
- Extension runtime: login/register UI, local session storage, a shared authenticated request layer, bearer-aware AI chat transport, sign-out, and `401` handling across background, sidepanel, popup, and content contexts.
- Deployment: new authentication secrets and an owner identity/backfill procedure; no new infrastructure, Redis service, email provider, or managed auth vendor.
- Security and operations: password-policy defaults, registration/login throttling, per-user model quotas, session revocation, and removal of anonymous access to cost-bearing routes.
