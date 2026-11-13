import { app } from "@/jazz/schema"
import { jazz } from "@/jazz/server"
import { readClassicAccess } from "./verification"
export { verifiedIdentity, authorizeSnapshot }

async function verifiedIdentity(accountId: string, challengeId: string) {
	let identity = await jazz.db.one(
		app.classicChallenges.where({ id: challengeId }),
	)
	if (
		!identity ||
		identity.ownerId !== accountId ||
		!identity.classicId ||
		identity.expiresAt.getTime() <= Date.now()
	)
		throw new Error("Classic identity proof required")
	return { ...identity, classicId: identity.classicId }
}
async function authorizeSnapshot(
	classicAccountId: string,
	item: { classicId: string; kind: string },
) {
	if (item.kind === "account") {
		if (item.classicId !== classicAccountId) throw new Error("Account mismatch")
		return
	}
	let access = await readClassicAccess(item.classicId, classicAccountId)
	if (!["writer", "admin"].includes(access.role))
		throw new Error("Waiting for a Classic owner or editor to open Alkalye")
	if (item.kind === "theme" && access.role !== "admin")
		throw new Error("Only Classic theme admins can import themes")
}
