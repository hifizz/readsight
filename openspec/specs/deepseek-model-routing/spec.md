## Requirements

### Requirement: Sidepanel chat uses DeepSeek V4 Pro

The system SHALL generate all sidepanel tutoring and contextual chat responses with `deepseek-v4-pro` in non-thinking mode through the existing DeepSeek API credential, while preserving the current AI SDK UI-message streaming response contract.

#### Scenario: User sends a sidepanel message

- **WHEN** a user submits a message through the sidepanel chat
- **THEN** the backend streams the response from `deepseek-v4-pro` in non-thinking mode using the existing UI-message stream format

#### Scenario: User invokes a contextual action

- **WHEN** a sidepanel request includes a selection context or action tag
- **THEN** the backend sends the existing contextual system prompt and conversation messages to `deepseek-v4-pro` and preserves the existing persistence and encounter-recording behavior

#### Scenario: DeepSeek chat is not configured

- **WHEN** `/api/chat` receives a request without a usable DeepSeek API credential
- **THEN** the backend returns an explicit provider-configuration failure and does not attempt a MiniMax request

### Requirement: Full-page translation model remains unchanged

The system SHALL continue to use `deepseek-v4-flash` in non-thinking mode as the primary full-page translation model and SHALL preserve the current translation provider order and historical cache-hash namespace.

#### Scenario: A translation cache miss is processed

- **WHEN** `/api/translate` receives translatable text that is absent from the translation cache
- **THEN** the primary model request uses `deepseek-v4-flash` in non-thinking mode before the existing Zhipu and OpenRouter fallback providers

#### Scenario: Existing translation is cached

- **WHEN** a paragraph matches an existing translation cache hash
- **THEN** the system returns the cached translation without invalidating or recomputing it because of the chat-model change

### Requirement: Dictionary model work uses DeepSeek V4 Flash

The system SHALL use `deepseek-v4-flash` in non-thinking mode for dictionary-definition Chinese enrichment and for generating estimated entries when local and external dictionaries do not resolve a token.

#### Scenario: Free Dictionary returns English definitions

- **WHEN** ECDICT misses and Free Dictionary returns definitions without Chinese glosses
- **THEN** the system requests Chinese glosses from `deepseek-v4-flash` and retains the existing dictionary response shape and cache behavior

#### Scenario: All dictionaries miss

- **WHEN** cache, ECDICT, and Free Dictionary cannot resolve a token
- **THEN** the system requests an estimated bilingual entry from `deepseek-v4-flash` and marks the result as estimated

#### Scenario: Dictionary cache hits

- **WHEN** a complete dictionary entry already exists in the local cache
- **THEN** the system returns that entry without sending any model request

### Requirement: Active runtime contains no MiniMax request path

The system MUST NOT import, configure, or call a MiniMax text or speech provider from active source code, and runtime operation MUST NOT require a MiniMax API credential.

#### Scenario: Active provider surfaces are inspected

- **WHEN** active source files, package manifests, and current environment/deployment documentation are searched for MiniMax provider imports, endpoints, SDK dependencies, or required credentials
- **THEN** no executable request path or current configuration requirement is present

#### Scenario: DeepSeek request fails

- **WHEN** a DeepSeek chat or lookup request fails
- **THEN** the system reports or handles the failure without falling back to MiniMax
