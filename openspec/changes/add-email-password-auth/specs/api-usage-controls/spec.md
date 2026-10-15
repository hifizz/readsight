## ADDED Requirements

### Requirement: Cost-bearing product APIs require authentication
The system MUST authenticate requests before executing chat, translation, lookup, encounter, history, known-item, or selection-context product operations.

#### Scenario: Anonymous chat request
- **WHEN** an unauthenticated client calls the chat endpoint
- **THEN** the server returns `401 Unauthorized` before invoking a model or persisting a message

#### Scenario: Anonymous translation or lookup request
- **WHEN** an unauthenticated client calls a translation or model-capable lookup endpoint
- **THEN** the server returns `401 Unauthorized` before reading a cache, calling an external provider, or recording usage

#### Scenario: CORS preflight request
- **WHEN** the browser sends a valid preflight request for a protected endpoint
- **THEN** the server returns the required CORS response without treating the preflight as product usage

### Requirement: Model-related usage is limited per user and UTC day
The system SHALL atomically account for accepted chat requests, submitted translation characters, and lookup requests per authenticated user and UTC day and SHALL enforce configurable limits.

#### Scenario: Usage remains within the limit
- **WHEN** a user's requested operation fits within the configured daily limit
- **THEN** the server atomically records the accepted usage and continues the operation

#### Scenario: Usage would exceed the limit
- **WHEN** accepting a request would exceed that user's configured daily limit
- **THEN** the server rejects it with `429 Too Many Requests`, a stable quota error code, and the UTC reset time without starting paid provider work

#### Scenario: Two users consume the same operation
- **WHEN** two users make otherwise identical requests
- **THEN** each user's quota is calculated and updated independently

#### Scenario: Concurrent requests approach a limit
- **WHEN** concurrent requests for one user collectively reach the configured limit
- **THEN** atomic accounting prevents the accepted total from exceeding the limit

#### Scenario: UTC day changes
- **WHEN** a user makes a request after the next UTC day begins
- **THEN** the new day's usage is evaluated independently of the prior day

### Requirement: Usage metrics bound actual abuse surfaces
The system SHALL measure chat by accepted requests, translation by submitted characters, and lookup by requests, regardless of whether a global content cache satisfies the operation.

#### Scenario: Translation cache hit consumes allowance
- **WHEN** an authenticated translation request is served entirely from the global cache
- **THEN** its submitted character count is included in that user's daily translation usage

#### Scenario: Dictionary cache hit consumes allowance
- **WHEN** an authenticated lookup request is served from a dictionary cache
- **THEN** the request is included in that user's daily lookup usage

#### Scenario: Request validation fails
- **WHEN** a request is rejected as structurally invalid before usage reservation
- **THEN** the server does not increment the user's daily model-related usage

### Requirement: Authentication endpoints resist burst abuse
The system SHALL apply configurable client-oriented burst limits to registration and sign-in before expensive password hashing or verification can be abused.

#### Scenario: Registration burst exceeds the limit
- **WHEN** a client exceeds the configured registration burst threshold
- **THEN** additional registration attempts are temporarily rejected without creating accounts

#### Scenario: Sign-in burst exceeds the limit
- **WHEN** a client exceeds the configured sign-in burst threshold
- **THEN** additional sign-in attempts are temporarily rejected without revealing whether submitted accounts exist

### Requirement: Security-sensitive values are excluded from observability
The system MUST NOT log plaintext passwords, bearer credentials, auth cookies, or full Authorization headers and SHALL avoid logging private reading text as part of authentication or quota telemetry.

#### Scenario: Authentication fails
- **WHEN** registration, sign-in, or bearer-session validation fails
- **THEN** operational logs contain a safe error category and no submitted password or session credential

#### Scenario: Quota is rejected
- **WHEN** a user exceeds a daily quota
- **THEN** telemetry may record the user identifier, metric, and numeric usage but does not include chat content, selected text, or translation input
