## Why

The backend still sends MiniMax requests from sidepanel chat, dictionary fallback, and server-side speech synthesis, which leaves model behavior and credentials split across providers. DeepSeek now exposes `deepseek-v4-pro` as its higher-capability V4 model, so conversational tutoring can move to that model while the established translation path stays on `deepseek-v4-flash` to preserve its latency, cost, and cache behavior.

## What Changes

- Route sidepanel and contextual chat through DeepSeek `deepseek-v4-pro` in non-thinking mode, using the existing DeepSeek credential and preserving the current streaming response contract.
- Route dictionary-definition translation and unknown-token lookup through DeepSeek `deepseek-v4-flash` in non-thinking mode, removing both MiniMax calls and the lookup path's separate text-model routing.
- Keep full-page translation on its current `deepseek-v4-flash` model, provider order, and cache namespace; this change does not upgrade or invalidate translation results.
- Remove the MiniMax provider module, chat-model configuration, SDK dependency, and all remaining MiniMax text-model request paths.
- **BREAKING**: retire the backend `/api/tts` MiniMax speech endpoint and make sentence/phrase playback use browser `speechSynthesis` directly, because DeepSeek does not provide a compatible speech model.
- Remove obsolete MiniMax environment-variable and deployment documentation, while leaving existing translation fallbacks through Zhipu and OpenRouter unchanged.

## Capabilities

### New Capabilities

- `deepseek-model-routing`: Defines the DeepSeek model assigned to chat, translation, and lookup workloads, and requires that no runtime path sends MiniMax requests.
- `browser-speech-playback`: Defines local browser speech playback after removal of the MiniMax-backed server TTS endpoint.

### Modified Capabilities

None. The repository has no existing OpenSpec capability specifications.

## Impact

- Backend provider and request paths: `server/src/lib/deepseek.ts`, `server/src/lib/lookup.ts`, `server/src/app/api/chat/route.ts`, and the retired MiniMax/TTS modules and route.
- Extension playback UI: `components/speak-button.tsx` and its callers.
- Dependency and configuration surface: `server/package.json`, lockfile, DeepSeek/MiniMax environment-variable references, deployment guidance, and current architecture documentation.
- External behavior: `/api/chat` keeps its AI SDK UI-message stream shape; `/api/translate` retains its model/cache behavior; `/api/tts` is removed and audio quality/voice selection becomes browser-dependent.
