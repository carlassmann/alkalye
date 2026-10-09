import * as Effect from "effect/Effect"
import { NetworkError } from "../platform/errors"
import { clientMetadataLayer } from "../server/client-metadata"

// Workers fetch cannot preserve the Bun adapter's validated address and TLS hostname binding.
export let cloudflareClientMetadataLayer = clientMetadataLayer(() =>
	Effect.fail(
		new NetworkError({
			operation: "metadata.request",
			cause: new Error(
				"URL OAuth client metadata is unavailable on this runtime; register the client instead",
			),
		}),
	),
)
