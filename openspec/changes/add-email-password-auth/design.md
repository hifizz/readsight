## Context

Readsight is a Chrome MV3 extension whose content script, injected popup, sidepanel, and background service worker call a self-hosted Next.js 16 API on `readsight-api.zilin.im`. The API and its PostgreSQL database currently assume one user. `selection_contexts`, `encounter_events`, and `chat_messages` contain private reading and learning history but have no owner column; history and known-item queries aggregate every row. Model-backed routes are publicly callable and CORS currently permits any origin.

The extension cannot rely comfortably on a conventional same-origin `HttpOnly` cookie. Requests originate from multiple `chrome-extension://` contexts, and the MV3 service worker may be suspended at any time. Authentication therefore has to survive worker restarts and be attached explicitly to direct streaming and non-streaming requests.

The deployment already supplies the components required for self-hosted authentication: Next.js, Drizzle, PostgreSQL, HTTPS, Coolify-managed environment variables, and file-based migrations. The product is still in a controlled early stage, so a coordinated extension/backend rollout and a short maintenance window are acceptable. No email provider is available or desired in this change.

The local PostgreSQL database is available for implementation and test operations. Local migrations, disposable users, fixture insertion, quota-boundary setup, and ownership assertions may be executed directly; this authorization does not extend to destructive production database operations.

## Goals / Non-Goals

**Goals:**

- Support account registration and sign-in using only email and password.
- Keep authentication fully self-hosted in the existing Next.js/PostgreSQL deployment.
- Give the MV3 extension a persistent, revocable session that works across its execution contexts.
- Ensure every private record is owned by exactly one user and every access is scoped server-side.
- Preserve global sharing for non-personal dictionary and translation caches.
- Prevent anonymous or excessive consumption of paid model endpoints.
- Assign all existing learning records to the current owner without losing history.

**Non-Goals:**

- Email verification, OTP, magic links, transactional email, or Resend.
- Forgotten-password recovery, password-change UI, account deletion, or administrative user management UI.
- GitHub or other social login, passkeys, MFA, account linking, teams, organizations, or workspaces.
- Offline accounts or a client-side learning database.
- Moving authentication or data to a managed service.
- Redis, distributed rate limiting, billing, subscriptions, or paid-plan enforcement.
- Synchronizing the existing extension preferences in `chrome.storage.sync` through the backend.

## Decisions

### 1. Use Better Auth with the existing Drizzle/PostgreSQL database

The server will use Better Auth's Drizzle adapter and email/password provider. Authentication tables (`user`, `account`, `session`, and `verification` where required by the library schema) will live in PostgreSQL alongside the Readsight schema and be managed through committed migrations. Password hashing, session generation, password comparison, and account-provider bookkeeping remain library responsibilities.

Email verification will not be required. Registration accepts an email and password only; if the auth library requires a name, the server derives a non-authoritative display value from the normalized email rather than adding another required form field. The email is a unique account identifier but is not evidence that the user controls that mailbox.

Passwords will use the library's supported hashing implementation and never be logged or stored by Readsight code. The minimum accepted password length will be 10 characters, with the library maximum retained to bound hashing input. Error responses shown by the extension will not distinguish an unknown email from an incorrect password.

Alternative considered: implement a small custom user table and password hashing. It appears smaller initially but makes hashing upgrades, session invalidation, timing-safe comparisons, and future recovery/social login Readsight's responsibility. Alternative considered: a managed auth provider. It adds a new external dependency and recurring pricing to a deployment that already has the required database.

### 2. Use an opaque, revocable bearer session for extension API calls

Better Auth's bearer support will expose the authenticated session token after successful registration/sign-in. The extension stores that opaque token in `chrome.storage.local`, not `chrome.storage.sync`, `chrome.storage.session`, a page DOM, or a content-page storage API. The token is sent as `Authorization: Bearer <token>` on protected requests. The server resolves the token to a live session and obtains `user.id`; client-supplied user IDs are never accepted.

The initial session lifetime will be 30 days, with normal server-side expiry and explicit revocation on sign-out. The token is not a GitHub/provider token and contains no user data. A shared extension auth/API helper will own token reads, header attachment, authenticated-session discovery, and clearing invalid credentials. Streaming chat transport must obtain the current token at request time rather than capturing it when the sidepanel component is created.

The extension's unauthenticated state is an auth gate in the sidepanel with register/sign-in modes. Page-level entry points that are invoked while signed out show a compact instruction to open the extension and sign in; they do not attempt paid or private API calls. A `401` from any protected endpoint clears the local credential and returns the UI to the signed-out state. `403`/`429` remain distinct authorization/quota failures and do not destroy a valid session.

Alternative considered: cross-site cookies. They complicate credentials-mode CORS, browser cookie policy, and multiple extension contexts. Alternative considered: a self-contained long-lived JWT. It is easy to validate but harder to revoke immediately; the existing database makes opaque server sessions the safer simple choice. Alternative considered: proxy every request through the background worker. That centralizes the token but makes streaming chat and large responses substantially more complex; an extension-only shared helper provides an acceptable security boundary without page-world exposure.

### 3. Separate public auth/preflight endpoints from authenticated product APIs

Registration, sign-in, auth callback/handler routes, and CORS preflight remain callable without a session. Product endpoints that access learning state or can consume server/model resources require authentication:

- `/api/chat`
- `/api/translate`
- both production lookup paths, including model-capable lookup requests
- `/api/encounter`
- `/api/history`
- `/api/known-items`
- `/api/selection-context/:id`

Every handler resolves the session before parsing or performing expensive work. Authentication is enforced through one server helper so missing, expired, and malformed sessions produce a consistent `401` JSON response. Auth routes keep Better Auth's required response shape and headers.

CORS will allow the `Authorization` and content headers required by the extension and expose the bearer-token response header used after sign-in. CORS is transport policy, not an authorization boundary. Where the packaged Chrome extension ID is stable, production origin configuration will be narrowed to that extension origin; development origins remain explicit configuration rather than falling back silently to arbitrary origins.

Alternative considered: leave cache-hit lookup and translation anonymous. The distinction between a hit and miss is known only after request processing and would expose useful infrastructure for scraping and denial-of-wallet attacks. Requiring a session for the whole product API gives a simpler, auditable boundary.

### 4. Add explicit ownership to private learning tables only

`selection_contexts`, `encounter_events`, and `chat_messages` gain a non-null `user_id` referencing the auth user. User ownership is immutable after creation. The server adds `user_id` to all inserts and includes it in every select, aggregation, deduplication, and update condition.

Indexes follow actual access patterns rather than adding a bare owner index everywhere:

- selection contexts: owner plus captured time, and an owner-aware identity lookup;
- encounter events: owner plus item key, and owner plus event time;
- chat messages: owner plus thread ID and creation time.

References from encounter events and chat messages to a selection context must preserve same-user ownership. This is enforced with owner-aware database constraints where supported by the migration/schema representation, and always enforced by server queries. If an incoming context ID already belongs to another user, the server rejects the collision and never reuses or reveals the row.

`dictionary_entries`, `translations`, and `tts_cache` remain global because they are content-addressed, contain no account identity, and reduce model cost when shared. Settings remain in `chrome.storage.sync` and are not attached to the new account in this change.

Alternative considered: create a workspace for each user and attach data to the workspace. There is no sharing or organization requirement; this adds an unnecessary join and lifecycle object. Alternative considered: PostgreSQL row-level security. The application currently connects with one privileged service role and has no transaction-scoped user identity, so mandatory application predicates plus database ownership constraints are clearer for this deployment. RLS can be revisited if direct multi-role database access is introduced.

### 5. Scope learning algorithms and caches correctly

History aggregation groups by `(user_id, item_key)` and returns only the authenticated user's records. Known-lemma discovery, canonical item-key selection, passive re-encounter deduplication, and selection-context loading all include `user_id`. The per-user canonical-item and daily-dedup behavior must not be influenced by another user's activity.

The extension's five-minute known-items cache becomes user-aware. It is keyed by the authenticated user/session identity or cleared on sign-in and sign-out so one account cannot temporarily see another account's lemma set on the same Chrome profile.

Dictionary and translation result caches stay independent of users. A cache hit may be shared, but the request is still authenticated and subject to lightweight abuse controls.

### 6. Use PostgreSQL for durable per-user usage accounting and conservative quotas

A daily usage table keyed by `(user_id, UTC date, metric)` records accepted consumption. Quota reservation and increment occur atomically so concurrent requests cannot all pass the same limit. Initial limits are environment-configurable, with conservative defaults:

- 50 chat requests per UTC day;
- 200,000 submitted translation characters per UTC day;
- 500 lookup requests per UTC day;
- 200 passive encounter items per request, retaining the existing request bound.

Translation accounting uses submitted characters rather than provider-reported tokens, which is deterministic before model execution and still bounds abuse when caches hit. Lookup accounting counts requests rather than only LLM misses to prevent cache scraping; normal dictionary use remains comfortably below the default. A rejected request returns `429` with a stable error code and the UTC reset time. Failed provider work is not refunded in the first version because refund transactions add complexity and the request still consumed server work.

Registration and sign-in receive separate IP-oriented burst limits using Better Auth's supported rate-limiting facility or a small server boundary configured for the single-instance deployment. Forwarded client IP is trusted only from the Coolify/Traefik proxy path. Limits are intentionally configurable because real usage data does not yet exist.

Alternative considered: Redis token buckets. They are useful for multiple application replicas and sub-second global throttling, neither of which exists here. Alternative considered: in-memory usage quotas. Restarts would reset them and concurrent instances would disagree, while PostgreSQL is already durable and available.

### 7. Treat unverified email and missing recovery as explicit product constraints

The registration UI states that email verification and password recovery are not available yet. The server does not send email and does not claim that an address is verified. Duplicate normalized email registration fails without exposing sensitive account details beyond what a person attempting registration already supplied.

The absence of recovery is acceptable for this early release but creates real lockout risk. It is not replaced with an insecure administrator endpoint. Operational recovery, if ever needed before a formal flow exists, requires an explicit database-backed operator procedure outside the public API and is not part of this change.

### 8. Add auth-focused tests at the ownership boundary

Tests will prioritize security invariants over UI snapshots:

- register, sign in, persist, expire, and sign out a bearer session;
- reject missing and invalid sessions consistently;
- prove two users cannot read each other's selection contexts, history, chat messages, known items, or influence encounter deduplication;
- prove global dictionary/translation cache reuse does not leak private ownership;
- prove quota increments are atomic and isolated per user/day;
- prove account changes clear extension-local known-items and auth state;
- prove passwords and bearer tokens do not appear in application logs.

Browser acceptance testing will be driven by the agent with `ego-browser` in a dedicated isolated task space. The agent will start the required local application services, load or reuse a testable extension build in the Chromium environment, exercise the real registration/sign-in/sign-out and protected-product flows, and verify meaningful transitions with semantic snapshots or screenshots after each action. Test accounts and credentials will be disposable and must not be printed in the final report or application logs. The task space will be closed after evidence is captured unless user intervention is genuinely required.

If the isolated Chromium environment cannot load the unpacked MV3 extension, that is treated as a test-environment blocker to solve or report explicitly; it is not permission to silently replace extension acceptance testing with API-only checks. API integration tests and ego-browser UI tests serve different purposes and both remain required.

## Risks / Trade-offs

- [A user registers with an address they do not own] → Treat email as an unverified login identifier, display no verification claim, and add verification later without changing user ownership IDs.
- [A user forgets their password and is locked out] → State the limitation before registration and defer a secure recovery flow rather than adding an operator backdoor.
- [A bearer token is copied from the local Chrome profile] → Use opaque revocable sessions, HTTPS, bounded expiry, explicit sign-out, and never sync or inject the token into page-world storage.
- [One missed `user_id` predicate leaks data] → Centralize session resolution, require owner arguments in data helpers, add compound indexes/constraints, and test every read/write path with two users.
- [Old extension builds fail after backend protection] → Use a coordinated release/maintenance window and surface `401` as “update or sign in”; do not retain an anonymous compatibility bypass.
- [Daily defaults inconvenience legitimate heavy readers] → Make thresholds environment-configurable and observe aggregate rejection counts without logging private text.
- [PostgreSQL quota writes add latency] → Use one atomic upsert per protected cost metric; the database is local to the app network and the overhead is small relative to model calls.
- [Auth schema and Readsight schema migrations diverge] → Commit generated/verified SQL and Drizzle metadata, run migrations through the existing deployment command, and validate a clean database plus a production-shaped upgrade.

## Migration Plan

1. Take a recoverable PostgreSQL backup and record counts for the three private tables.
2. Add Better Auth configuration, auth tables, nullable ownership columns, quota storage, and required indexes/constraints that are valid before backfill.
3. Apply the migrations to the local database, build and validate the extension auth UI and authenticated request path, and use disposable local accounts/data to rehearse ownership, quota, backfill, and finalization behavior. Create the intended production owner account later through the same registration flow users will use.
4. Enter a short maintenance window. Deploy the auth-capable backend with protected product endpoints and deploy/reload the matching extension build.
5. Run a one-off, idempotent owner-backfill command that resolves an explicitly supplied owner email to a user ID, refuses ambiguous/nonexistent owners, assigns only currently unowned private rows, and prints before/after counts without secrets.
6. Validate that no private rows remain unowned or cross-owned, then apply the final migration making ownership non-null and enabling the owner-aware reference constraints.
7. Smoke-test registration, sign-in, chat streaming, lookup, translation, records, passive encounter reporting, sign-out, two-user isolation, and quota rejection on production.
8. Remove the maintenance restriction and monitor authentication failures, quota rejections, database errors, and model spend without logging passwords, tokens, or reading text.

Rollback before the final ownership constraint consists of redeploying the prior app and extension while preserving the additive auth/owner columns. Rollback after the final migration requires redeploying the prior application plus a reviewed compatibility migration or restoring the pre-change backup; owner data must not be dropped merely to make old code run. The protected backend must never be rolled back to anonymous public model access without an explicit operator decision.

## Open Questions

None required for implementation. Quota defaults are deliberately configurable and can be tuned after observing real use; adding verified email and password recovery will be a separate future change.
