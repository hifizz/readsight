## 1. DeepSeek Model Routing

- [x] 1.1 Refactor the DeepSeek provider module to expose pinned non-thinking `deepseek-v4-pro` chat and `deepseek-v4-flash` lightweight-text bindings that share the existing credential and transport.
- [x] 1.2 Switch `/api/chat` to the V4-Pro binding, preserve the UI-message stream and persistence hooks, and return a controlled configuration error when DeepSeek is unavailable.
- [x] 1.3 Switch dictionary-definition enrichment and unknown-token generation to the V4-Flash binding, removing lookup's Zhipu/MiniMax-specific retry and token-budget branches.
- [x] 1.4 Verify that `/api/translate` still selects V4-Flash in non-thinking mode, retains DeepSeek → Zhipu → OpenRouter default routing, and uses the unchanged cache-hash namespace.

## 2. Browser Speech and MiniMax Removal

- [x] 2.1 In parallel after task 1.1, simplify `SpeakButton` to start, stop, clean up, and report errors for direct `en-US` browser speech without a backend URL or audio-blob path.
- [x] 2.2 Remove the `/api/tts` route and MiniMax TTS library while leaving the `tts_cache` schema and stored data untouched.
- [x] 2.3 After tasks 1.2, 1.3, and 2.2, remove the MiniMax provider module, `vercel-minimax-ai-provider` dependency, and lockfile entries.

## 3. Configuration and Documentation

- [x] 3.1 In parallel after task 2.3, remove MiniMax variables from current environment/setup and deployment guidance, document `DEEPSEEK_API_KEY` as required for chat and model-assisted lookup, and flag deployment secrets for post-rollout removal.
- [x] 3.2 Update current architecture/status documentation and active source comments to describe V4-Pro chat, V4-Flash translation/lookup, and browser speech; keep clearly historical milestone records unchanged.

## 4. Validation

- [x] 4.1 Run backend TypeScript and lint/build validation plus the extension compile/build checks, resolving all failures introduced by provider and playback changes.
- [x] 4.2 Search active source, manifests, lockfiles, and current operational docs for MiniMax imports, endpoints, SDK references, and required environment variables; confirm no executable MiniMax request path remains.
- [x] 4.3 Smoke-test `/api/chat` streaming with selection context, lookup cache-hit/Free-Dictionary/LLM-miss paths, and a translation cache miss to confirm the specified model routing and unchanged response shapes.
- [x] 4.4 Manually verify browser speech start, stop, completion, unmount cleanup, and unsupported/error handling without any `/api/tts` network request.
- [x] 4.5 Confirm the change generates no destructive database migration and leaves existing translation and TTS cache rows intact.
