## ADDED Requirements

### Requirement: Every private learning record has one owner
The system SHALL associate every selection context, encounter event, and chat message with exactly one authenticated user and SHALL keep that ownership immutable.

#### Scenario: Selection context is created
- **WHEN** an authenticated user submits a new selection context
- **THEN** the server stores it with the current session user's ID

#### Scenario: Encounter event is recorded
- **WHEN** an authenticated action records an active or passive encounter event
- **THEN** the event is owned by the current session user and any referenced selection context belongs to the same user

#### Scenario: Chat message is persisted
- **WHEN** an authenticated chat stream finishes and persists messages
- **THEN** each persisted message is owned by the current session user and any selection-context reference belongs to that user

#### Scenario: Client supplies identity data
- **WHEN** a request body or query includes a user identifier
- **THEN** the server ignores or rejects that identity and derives ownership exclusively from the authenticated session

### Requirement: Private reads are scoped to the authenticated user
The system MUST include the current user's identity in every private record lookup, aggregation, and relation traversal.

#### Scenario: User loads learning history
- **WHEN** an authenticated user requests history
- **THEN** the response aggregates only that user's encounter events and selection contexts

#### Scenario: User loads known items
- **WHEN** an authenticated user requests known lemmas
- **THEN** the response is derived only from that user's active encounter events

#### Scenario: User loads a selection context they own
- **WHEN** an authenticated user requests a selection-context ID owned by that user
- **THEN** the server returns the context

#### Scenario: User requests another user's selection context
- **WHEN** an authenticated user requests a selection-context ID owned by a different user
- **THEN** the server returns a non-disclosing not-found response and no private fields

### Requirement: Learning behavior is isolated between users
The system SHALL calculate canonical items, passive re-encounter deduplication, histories, and threads independently for each user.

#### Scenario: Two users encounter the same lemma
- **WHEN** two users have different historical item keys for the same lemma
- **THEN** each user's canonical item-key selection uses only that user's events

#### Scenario: Another user already recorded a passive encounter
- **WHEN** one user records a passive encounter for an item that another user recorded during the same day
- **THEN** the first user's event is not deduplicated against the other user's event

#### Scenario: Accounts change in one Chrome profile
- **WHEN** a user signs out and a different user signs in on the same Chrome profile
- **THEN** cached known-item data from the first account is not returned or used for the second account

### Requirement: Safe content caches remain shared
The system SHALL keep dictionary, translation, and retained TTS cache records independent of user ownership while preventing those cache records from containing session or private learning identifiers.

#### Scenario: Two users request identical cached content
- **WHEN** two authenticated users request the same dictionary lemma or translation input
- **THEN** both users may receive the same global cache result without gaining access to each other's learning records

#### Scenario: A private event is written after a cache hit
- **WHEN** an authenticated lookup uses a global dictionary cache result and records a learning event
- **THEN** the cache remains global while the new event is owned only by the requesting user

### Requirement: Existing single-user data is migrated safely
The system SHALL provide an idempotent controlled migration that assigns all pre-authentication private records to one explicitly designated owner account before ownership becomes mandatory.

#### Scenario: Owner backfill succeeds
- **WHEN** the designated owner email resolves to exactly one account and unowned private rows exist
- **THEN** the migration assigns those rows to that user's ID and reports reconciled row counts without printing credentials

#### Scenario: Owner cannot be resolved safely
- **WHEN** the designated owner account is absent or ambiguous
- **THEN** the migration aborts without assigning any records

#### Scenario: Backfill is run again
- **WHEN** the owner backfill runs after all existing rows have already been assigned
- **THEN** it makes no ownership changes and completes without duplicating data

#### Scenario: Ownership constraints are finalized
- **WHEN** validation confirms that every private row has an owner and every private reference has matching ownership
- **THEN** the database enforces non-null ownership and referential integrity for future writes
