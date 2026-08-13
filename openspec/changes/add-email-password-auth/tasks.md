## 1. Authentication Foundation

- [x] 1.1 Add the pinned Better Auth dependency and configure its Drizzle/PostgreSQL adapter, email/password provider, bearer support, 30-day session policy, password bounds, trusted origins, and redacted error handling.
- [x] 1.2 Generate and review the authentication-table schema and committed Drizzle migration so it coexists with the existing `readsight` schema and deployment-time migration workflow.
- [x] 1.3 Mount the Better Auth Next.js handler and add a shared server `requireUser` boundary that converts missing, expired, and revoked sessions into the specified `401` response.
- [x] 1.4 Add production/development configuration for the auth secret, base URL, extension origin, bearer response-header exposure, and proxy-aware auth throttling without weakening current HTTPS or CORS behavior.

## 2. User Ownership Schema and Migration

- [x] 2.1 Add nullable `user_id` ownership columns and owner-aware indexes to selection contexts, encounter events, and chat messages in an additive first-stage migration.
- [ ] 2.2 Add same-owner relation definitions/constraints for encounter and chat references to selection contexts, structured so they can be finalized only after backfill.
- [x] 2.3 Create an idempotent owner-backfill command that resolves one explicit normalized owner email, refuses unsafe resolution, updates only unowned rows, and verifies before/after counts without exposing credentials.
- [ ] 2.4 Add the final migration that refuses remaining unowned or cross-owned rows, makes private ownership non-null, and enables the final referential constraints.

## 3. Server-Side Data Isolation

- [x] 3.1 Change selection-context creation/loading helpers to require the authenticated user, assign immutable ownership, and reject or hide cross-user ID collisions.
- [x] 3.2 Change encounter recording, passive daily deduplication, and canonical item-key selection to require and filter by the authenticated user.
- [x] 3.3 Change chat-message persistence and thread references to assign the authenticated user and preserve same-user selection-context ownership.
- [x] 3.4 Change history aggregation and context hydration to filter and group within the authenticated user's records.
- [x] 3.5 Change known-item discovery to use only the authenticated user's active encounter events.
- [x] 3.6 Verify dictionary, translation, and retained TTS caches remain global and contain no new user/session fields.

## 4. Usage Accounting and Abuse Controls

- [x] 4.1 Add the daily per-user usage table, unique key, indexes, configurable quota defaults, and atomic reserve/check helper for chat requests, translation characters, and lookup requests.
- [x] 4.2 Enforce chat quota before model streaming and return the stable `429` quota response with UTC reset metadata.
- [x] 4.3 Validate translation input before atomically reserving its submitted character count, then enforce the daily translation limit before cache/provider work.
- [x] 4.4 Enforce lookup request quota before dictionary cache/provider work and retain the existing passive encounter per-request bound.
- [x] 4.5 Configure and test registration/sign-in burst limiting at the auth boundary using only trusted proxy-derived client addressing.

## 5. Protected API Integration

- [x] 5.1 Require a valid session before product work in chat, translation, lookup, encounter, history, known-items, and selection-context routes while leaving auth handlers and OPTIONS preflight reachable.
- [x] 5.2 Thread the server-resolved user ID through every protected route into the owner-aware helpers without accepting identity from request bodies or query parameters.
- [x] 5.3 Normalize unauthorized, not-found, quota, and validation error contracts so cross-user resource checks disclose no ownership information and `401` remains distinguishable from `429`.
- [x] 5.4 Audit current server logging and remove/redact passwords, bearer values, Authorization headers, and private input from auth/quota diagnostics.

## 6. Extension Authentication Runtime

- [x] 6.1 Add a shared extension auth store/helper that keeps the opaque credential in `chrome.storage.local`, resolves the current session, broadcasts account-state changes, and never exposes credentials to page-world storage or logs.
- [x] 6.2 Add a shared authenticated fetch wrapper that attaches the current bearer token at request time and clears account state only on `401`, preserving distinct handling for validation, authorization, and quota errors.
- [x] 6.3 Update sidepanel chat transport to attach a fresh bearer credential to each streaming request without capturing a stale token.
- [x] 6.4 Route background translation/encounter calls, popup lookup calls, sidepanel history/context calls, and content known-item calls through the authenticated request layer.
- [x] 6.5 Make the five-minute known-items cache account-aware and clear it on sign-in, sign-out, and invalid-session transitions.

## 7. Registration, Sign-In, and Account UX

- [x] 7.1 Add a signed-out sidepanel gate with email/password registration and sign-in modes, client validation, generic credential errors, loading states, and the explicit no-verification/no-recovery notice.
- [x] 7.2 After successful registration or sign-in, capture the bearer session safely, load the authenticated user, and transition to the existing chat/records/settings product shell.
- [x] 7.3 Add the authenticated account summary and sign-out control, revoking the server session before clearing all local account-specific state.
- [x] 7.4 Add compact signed-out behavior for injected lookup/translation entry points that directs the user to open the sidepanel instead of invoking protected APIs.
- [ ] 7.5 Add clear expired-session and daily-quota UI states without displaying raw tokens, internal provider errors, or misleading email-verification claims.

## 8. Automated Validation

- [ ] 8.1 Add auth integration coverage for registration, normalized duplicate email, password bounds, generic sign-in failure, bearer persistence, expiry/revocation, sign-out, and auth burst limits.
- [ ] 8.2 Add two-user isolation coverage for selection context, history, known items, chat persistence, canonical item selection, and passive encounter deduplication, including non-disclosing cross-user ID access.
- [ ] 8.3 Add usage-control coverage for independent users/days, atomic concurrent reservations, validation-before-accounting, cache-hit accounting, and stable `429` reset metadata.
- [ ] 8.4 Add extension tests for auth-state restoration, dynamic Authorization headers, `401` clearing, `429` preservation, account-aware known-item caching, and signed-out API gating.
- [ ] 8.5 Apply and validate both migration stages against the available local PostgreSQL database, seed disposable pre-auth and two-user fixtures, exercise the owner backfill and constraints, then run server lint/typecheck/build, extension compile/build, and a static secret/logging audit; resolve all regressions introduced by the change.
- [ ] 8.6 Start the local app dependencies and use `ego-browser` in a dedicated isolated task space to load the test extension, register two disposable accounts, verify sign-in persistence and sign-out, exercise authenticated lookup/translation/chat/history flows, capture snapshot or screenshot evidence, and close the task space when complete.
- [x] 8.7 Use `ego-browser` in a dedicated isolated task space with mocked extension APIs to verify the sidepanel registration gate, transition into the product shell, account display, sign-out transition, and session-refresh behavior; close the task space and remove its disposable local accounts afterward.

## 9. Deployment and Operational Verification

- [x] 9.1 Document required auth/quota environment variables, the no-email/no-recovery limitation, owner-backfill procedure, coordinated rollout order, rollback boundaries, and safe monitoring fields.
- [ ] 9.2 Take and verify a production database backup, record private-table counts, and rehearse the owner registration/backfill/finalization sequence against a production-shaped copy before touching production.
- [ ] 9.3 During an approved maintenance window, deploy the matching auth-capable backend and extension, register the designated owner, run and verify the owner backfill, then apply final ownership constraints.
- [ ] 9.4 Use `ego-browser` plus direct API/database assertions to smoke-test two accounts across registration, sign-in persistence, lookup, translation, streaming chat, records, passive encounters, quota rejection, cross-user denial, sign-out, and revoked-session reuse.
- [ ] 9.5 Monitor authentication failures, quota rejections, database constraint errors, and model spend after rollout, confirming that logs contain no passwords, bearer credentials, or private reading text.
