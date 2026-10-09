import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Cipher } from "../platform/cipher"
import { RelaySecrets, RelaySettings } from "../server/settings"
import { livePollWait } from "../shared/document-live"

export interface DeploymentEnvironment extends CloudflareEnv {
	ALKALYE_MASTER_KEY: string
	PUBLIC_ORIGIN?: string
	RESEND_API_KEY?: string
	EMAIL_FROM?: string
}

export function cloudflareSettingsLayer(environment: DeploymentEnvironment) {
	return Layer.succeed(RelaySettings, {
		port: 0,
		hostname: "",
		data: "",
		assets: "",
		build: false,
		development: false,
		publicOrigin: environment.PUBLIC_ORIGIN
			? new URL(environment.PUBLIC_ORIGIN).origin
			: undefined,
		livePollWait,
		resetLog: false,
		responseCompression: false,
	})
}

export function cloudflareSecretsLayer(environment: DeploymentEnvironment) {
	return Layer.effect(
		RelaySecrets,
		Effect.gen(function* () {
			if (!environment.ALKALYE_MASTER_KEY)
				return yield* Effect.fail(new Error("ALKALYE_MASTER_KEY is required"))
			let cipher = yield* Cipher
			yield* cipher.importKey(environment.ALKALYE_MASTER_KEY)
			return { masterKey: environment.ALKALYE_MASTER_KEY }
		}),
	)
}
