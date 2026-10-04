# TypeScript conventions

Use strict TypeScript. Prefer `let` and named `function` declarations. Avoid default exports, `any`, casts and assertions. Define untrusted formats with Effect Schema; use effectful decoders at asynchronous boundaries and synchronous decoders where pure domain code needs them. Packet, role, room, presence and operation envelope schemas live in `src/shared/model.ts`; narrow DOM elements with `instanceof`.

Make operation boundaries visible: yield persistence before reporting success, catch failures where the caller can recover, and preserve unsaved work for retry. Keep platform APIs behind a small domain interface when it hides meaningful complexity, rather than wrapping every API call.

Prefer Effect services, layers, scopes, fibers, streams, caches, schemas and configuration before creating infrastructure. Import through Effect module subpaths so Bun can remove unused code. Keep native promises inside platform adapters and runtime entry points. Test cancellation and resource release alongside successful behavior.

Use `FiberHandle` for one replaceable task, `FiberSet` for a component’s callbacks, and `FiberMap` for tasks keyed by workspace. Use `SubscriptionRef` for state that observers follow, `PubSub` for notices, and `Deferred` for a one-time completion signal. Use `RcMap` for keyed resources and `ScopedCache` when cached values own resources. These primitives already supply interruption and cleanup; domain code decides who owns the scope.

Comments explain a decision that the code cannot express. Descriptive names and short functions explain the rest.

written with GPT-6 in Codex
