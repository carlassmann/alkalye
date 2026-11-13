import { z } from "zod"
import { entropyToMnemonic } from "@scure/bip39"
import { wordlist } from "@scure/bip39/wordlists/english.js"
import { RecoveryPhrase } from "jazz-tools/passphrase"

export {
	readClassicCredentials,
	deviceSecretFromSeed,
	classicCredentialsSchema,
}

let classicCredentialsSchema = z.object({
	accountID: z.string().startsWith("co_z"),
	accountSecret: z.templateLiteral([
		"sealerSecret_z",
		z.string(),
		"/signerSecret_z",
		z.string(),
	]),
	secretSeed: z.array(z.number().int().min(0).max(255)).length(32),
	provider: z.string().optional(),
})
function readClassicCredentials(
	storage: Pick<Storage, "getItem"> = localStorage,
) {
	let raw = storage.getItem("jazz-logged-in-secret")
	if (!raw) return null
	let parsed: unknown = JSON.parse(raw)
	return classicCredentialsSchema.parse(parsed)
}
function deviceSecretFromSeed(seed: Uint8Array) {
	return RecoveryPhrase.toSecret(entropyToMnemonic(seed, wordlist))
}
