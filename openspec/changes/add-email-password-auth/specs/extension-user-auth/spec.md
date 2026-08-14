## ADDED Requirements

### Requirement: Users can register with email and password
The system SHALL allow a signed-out user to create an account with a normalized unique email address and a password of at least 10 characters, without requiring email verification or sending email.

#### Scenario: Registration succeeds
- **WHEN** a signed-out user submits a valid unused email address and acceptable password
- **THEN** the system creates the account, establishes an authenticated session, and returns the extension to the signed-in product experience

#### Scenario: Registration email is already used
- **WHEN** a user attempts to register an email address that matches an existing account after normalization
- **THEN** the system rejects the registration without creating a second account

#### Scenario: Registration input is invalid
- **WHEN** a user submits an invalid email address or a password shorter than the configured minimum
- **THEN** the system rejects the request without creating an account or session

#### Scenario: Registration requires no mailbox access
- **WHEN** a valid registration is accepted
- **THEN** the system does not send a message and does not require an email link or code before the account can be used

### Requirement: Users can sign in with email and password
The system SHALL authenticate an existing user with their normalized email and password and SHALL present a generic failure for invalid credentials.

#### Scenario: Sign-in succeeds
- **WHEN** a registered user submits the correct email and password
- **THEN** the system establishes a persistent authenticated session for that user

#### Scenario: Sign-in credentials are invalid
- **WHEN** a user submits an unknown email or an incorrect password
- **THEN** the extension reports that the email or password is incorrect without revealing which field failed

#### Scenario: Repeated sign-in attempts exceed the burst limit
- **WHEN** requests from a client exceed the configured authentication-attempt limit
- **THEN** the system temporarily rejects additional attempts with a rate-limit response and performs no password authentication work beyond the limiter boundary

### Requirement: Extension sessions use revocable bearer credentials
The system SHALL issue an opaque server-backed session credential that the extension sends in the `Authorization` header and that the server can expire or revoke.

#### Scenario: Session survives an extension worker restart
- **WHEN** an authenticated MV3 background worker is suspended and later restarted before session expiry
- **THEN** the extension restores the credential from extension-local storage and authenticated API calls continue without another sign-in

#### Scenario: Authenticated API request is accepted
- **WHEN** a request includes a valid unexpired bearer session
- **THEN** the server resolves the current user from the session and processes the protected request without accepting a client-supplied user ID

#### Scenario: Session is missing or invalid
- **WHEN** a protected endpoint receives no bearer credential or an invalid, expired, or revoked credential
- **THEN** it returns `401 Unauthorized` without reading private data or starting paid model work

#### Scenario: Session token is stored
- **WHEN** the extension receives a valid bearer credential
- **THEN** it stores the credential in `chrome.storage.local` and does not place it in sync storage, page DOM, page local storage, URLs, or logs

### Requirement: Users can sign out
The system SHALL let an authenticated user revoke the current server session and clear account-specific extension state.

#### Scenario: Sign-out succeeds
- **WHEN** an authenticated user chooses sign out
- **THEN** the current server session is revoked, the local bearer credential is removed, user-aware caches are cleared, and the extension shows the signed-out experience

#### Scenario: Signed-out credential is reused
- **WHEN** a previously signed-out bearer credential is sent to a protected endpoint
- **THEN** the server rejects it with `401 Unauthorized`

### Requirement: Authentication state gates product use
The extension SHALL display registration and sign-in controls when no valid session exists and SHALL not invoke protected product APIs until authentication succeeds.

#### Scenario: Sidepanel opens while signed out
- **WHEN** the sidepanel opens without a valid session
- **THEN** it displays email/password registration and sign-in modes instead of private records or chat

#### Scenario: Page action is invoked while signed out
- **WHEN** a user invokes lookup, translation, or another protected page action without a valid session
- **THEN** the extension directs the user to open the extension and sign in without sending the protected request

#### Scenario: Protected request returns unauthorized
- **WHEN** any extension context receives `401 Unauthorized` from a protected API
- **THEN** the extension clears the invalid local credential and transitions to the signed-out state

### Requirement: Unavailable account functions are represented honestly
The system SHALL NOT claim that an email address is verified and SHALL inform users that password recovery is unavailable in this release.

#### Scenario: User reviews registration limitations
- **WHEN** the registration experience is displayed
- **THEN** it states that email verification and forgotten-password recovery are not currently available

#### Scenario: User forgets a password
- **WHEN** a signed-out user cannot provide the account password
- **THEN** the public product exposes no insecure bypass or email-recovery flow in this release
