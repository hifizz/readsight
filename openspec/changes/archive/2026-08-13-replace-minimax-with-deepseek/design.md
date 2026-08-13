## Context

The server currently has four AI workloads with inconsistent routing:

- `/api/chat` streams sidepanel tutoring responses from MiniMax M2.1.
- Full-page translation already uses DeepSeek `deepseek-v4-flash` with thinking disabled, followed by Zhipu and OpenRouter fallbacks, and uses a historical cache namespace that must remain stable.
- Dictionary lookup normally resolves from ECDICT or Free Dictionary, but its Chinese-definition enrichment and unknown-token fallback can still call MiniMax.
- `/api/tts` calls MiniMax `speech-2.8-hd`; the extension falls back to browser speech only after that request fails.

DeepSeek's official model list currently exposes `deepseek-v4-flash` and `deepseek-v4-pro`. V4-Pro is the higher-capability conversational choice, while V4-Flash is the existing cost-sensitive translation model. DeepSeek does not expose a speech-synthesis model compatible with the current TTS path.

The repository has no prior OpenSpec project metadata or capability specs; `openspec/project.md` and `openspec/AGENTS.md` were absent when this proposal was created. The design is therefore grounded in the repository instructions, current source, package manifests, and deployment documentation.

## Goals / Non-Goals

**Goals:**

- Ensure every primary server text-model workload uses the DeepSeek provider and no runtime code can send a MiniMax request.
- Use `deepseek-v4-pro` for sidepanel tutoring chat without changing the AI SDK UI-message streaming contract.
- Preserve full-page translation on `deepseek-v4-flash`, including its non-thinking behavior, fallback order, and cache compatibility.
- Use `deepseek-v4-flash` for dictionary enrichment and unknown-token generation.
- Preserve sentence/phrase playback without a cloud speech request by using browser speech synthesis.
- Remove obsolete MiniMax SDK, model configuration, and operational documentation.

**Non-Goals:**

- Changing translation prompts, batch sizing, provider fallbacks, or stored translations.
- Automatically discovering and adopting future DeepSeek models at runtime.
- Adding a new cloud TTS vendor or guaranteeing a consistent voice across operating systems.
- Deleting existing `tts_cache` rows or dropping the database table; destructive data cleanup is unnecessary to stop MiniMax traffic.
- Removing Zhipu or OpenRouter from the existing full-page translation fallback chain.

## Decisions

### 1. Define separate, explicit DeepSeek workload profiles

The DeepSeek provider module will expose distinct chat and lightweight-text model bindings rather than one misleading `deepseekChat` export:

- chat: `deepseek-v4-pro`, thinking disabled;
- translation and lookup: `deepseek-v4-flash`, thinking disabled.

Both bindings will share the existing OpenAI-compatible base URL, `DEEPSEEK_API_KEY`, undici transport, and request-body injection for `thinking: { type: 'disabled' }`.

This separation prevents a future chat upgrade from silently changing translation output or invalidating assumptions around translation cost and latency. Explicit model IDs are preferred over querying `/models` at runtime because "latest" discovery would make behavior change without a code review and could select a model with incompatible cost or response characteristics.

Alternative considered: use V4-Flash for every workload. It is cheaper and faster, but it would not satisfy the request to put the sidepanel on DeepSeek's higher-capability current model. Alternative considered: use V4-Pro's default thinking mode. The tutoring prompts are short and interactive, so hidden reasoning would add first-token latency and increase the risk of exceeding the route's 30-second budget without a clear user benefit.

### 2. Keep `/api/chat` as the single sidepanel streaming boundary

`/api/chat` will swap only its model binding. System-prompt construction, selection context, action-tag behavior, persistence in `onFinish`, encounter logging, and `toUIMessageStreamResponse()` remain unchanged. The extension transport therefore needs no protocol or rendering changes.

If `DEEPSEEK_API_KEY` is missing, the route must fail explicitly and must not fall back to MiniMax. A controlled service-unavailable response is preferable to a late provider exception or silently using an unintended model.

### 3. Consolidate lookup's LLM work on V4-Flash

Free Dictionary definition enrichment and unknown-token entry generation will use the same non-thinking V4-Flash binding used for mechanical text work. Existing ECDICT, cache, Free Dictionary, result-shape, and `estimated` behavior remain intact.

The lookup-specific Zhipu-first/MiniMax-fallback branch is removed rather than replacing only its last step. This makes DeepSeek the primary model for lookup, matches the requested provider consolidation, and removes per-provider token-budget branching. Existing cached dictionary entries remain valid and continue to bypass model calls.

Alternative considered: retain Zhipu as lookup primary and replace only MiniMax fallback. That would minimize code changes, but primary lookup model traffic would still not be unified on DeepSeek.

### 4. Preserve full-page translation behavior exactly at the routing boundary

The translation route keeps `deepseek-v4-flash`, forced non-thinking mode, `glm-4-flash` historical cache-hash namespace, and its current DeepSeek → Zhipu → OpenRouter fallback order. Provider refactoring may rename imports, but it must not change those observable choices or rewrite cached rows.

Translation and lookup share a model ID but not a cache policy: dictionary entries retain their lemma cache, while full-page translations retain the existing paragraph hash namespace.

### 5. Replace server TTS with direct browser speech synthesis

`SpeakButton` will invoke `SpeechSynthesisUtterance` immediately instead of fetching `/api/tts`. It retains play/stop/error state and cleanup on unmount, but removes backend URL, blob, and `HTMLAudioElement` handling. The MiniMax TTS route and library can then be removed, guaranteeing that playback cannot trigger a MiniMax request.

The `tts_cache` schema/table and existing rows remain untouched. They become unused data, which avoids an unrelated destructive migration and keeps rollback possible.

Alternative considered: keep `/api/tts` and return an error so the current client falls back. That would add a needless network round trip on every click and preserve a dead API contract. Alternative considered: replace MiniMax with another cloud TTS provider. That adds a new vendor and credential outside the user's request.

### 6. Remove MiniMax integration surfaces and verify absence statically

The MiniMax provider file, SDK dependency, lockfile entries, environment-variable documentation, and route imports will be removed. Historical planning documents may retain past-tense references when they are clearly archival, but current architecture, setup, and deployment instructions must no longer direct operators to configure MiniMax.

Validation will include a repository search across active source and manifests for MiniMax provider imports, endpoints, environment variables, and SDK references. This static check complements typecheck/build validation and directly proves that no live request path remains.

## Risks / Trade-offs

- [V4-Pro latency or cost is higher than V4-Flash] → Keep thinking disabled, retain the current concise tutoring prompts, and validate streaming time-to-first-content during smoke testing.
- [DeepSeek credential becomes a single point of failure for chat and lookup] → Fail clearly when it is absent; retain data/API fallbacks that do not require an LLM and keep the existing full-page translation provider fallbacks.
- [Browser speech voices vary by OS and Chrome profile] → Set `en-US`, preserve clear play/stop/error states, and document that voice quality is browser-dependent.
- [Removing `/api/tts` breaks an unknown external caller] → Treat the route removal as breaking, verify repository callers, and deploy the extension and backend together.
- [Provider refactor accidentally changes translation behavior] → Pin separate model constants, preserve the cache namespace, and add validation for the exact translation model ID and provider order.
- [Historical MiniMax text remains in archived docs] → Distinguish executable/current references from historical records; require zero hits in active source, manifests, and current operational docs rather than rewriting project history.

## Migration Plan

1. Introduce explicit V4-Pro chat and V4-Flash text bindings behind the existing DeepSeek credential.
2. Switch `/api/chat` and lookup LLM paths, then validate their response shapes before removing MiniMax integration code.
3. Convert playback to browser speech and remove the backend TTS route/library.
4. Remove the MiniMax SDK and current configuration/documentation references; keep `tts_cache` data in place.
5. Run typechecks, lint/build checks, static provider searches, and API/UI smoke tests.
6. Deploy backend and extension together, then remove `MINIMAX_API_KEY` and `MINIMAX_CHAT_MODEL` from external secret stores after confirming no rollback is needed.

Rollback consists of redeploying the prior backend and extension revision. The retained `tts_cache` table allows the prior TTS code to resume without a database restore; the MiniMax secret would need to remain recoverable in the deployment platform until the rollback window closes.

## Open Questions

None. The model IDs and TTS limitation are confirmed by current DeepSeek documentation, and the repository already contains a browser speech fallback suitable as the replacement behavior.
