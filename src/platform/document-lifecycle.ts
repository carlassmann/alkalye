import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"

export class DocumentLifecycle extends Context.Service<
	DocumentLifecycle,
	{
		hidden: Stream.Stream<unknown>
		changes: Stream.Stream<unknown>
		protect(
			hasUnsaved: () => boolean,
		): Effect.Effect<{ update(): void }, never, Scope.Scope>
	}
>()("alkalye/DocumentLifecycle") {}
