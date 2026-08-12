## Requirements

### Requirement: Sentence and phrase playback uses browser speech

The extension SHALL play sentence and phrase text through the browser `speechSynthesis` API with an English locale and SHALL NOT make a backend speech request.

#### Scenario: User starts playback

- **WHEN** the user activates the listen control for non-empty text in a browser that supports speech synthesis
- **THEN** the extension starts an `en-US` speech utterance locally without requesting `/api/tts`

#### Scenario: User stops playback

- **WHEN** the user activates the listen control while an utterance is playing
- **THEN** the extension cancels the current browser utterance and returns the control to its idle state

#### Scenario: Playback component unmounts

- **WHEN** the playback component is removed while an utterance may be active
- **THEN** the extension cancels browser speech so audio does not continue after the relevant UI is gone

#### Scenario: Browser speech is unavailable or fails

- **WHEN** the browser does not support speech synthesis or the utterance emits an error
- **THEN** the listen control enters an error state without attempting a cloud TTS request

### Requirement: MiniMax TTS API is retired

The backend SHALL no longer expose an active `/api/tts` implementation that calls MiniMax, and removal SHALL NOT delete existing TTS cache data as part of this change.

#### Scenario: Repository playback callers are inspected

- **WHEN** active extension source is searched for `/api/tts` callers
- **THEN** no playback code depends on the retired endpoint

#### Scenario: Existing TTS cache data is migrated

- **WHEN** the provider-removal change is deployed
- **THEN** no destructive database migration drops the `tts_cache` table or deletes its existing rows
