import type { Database } from "@/app/features/documents"
import { z } from "zod"

export { sharingRequest }

let resultSchema = z.object({
	link: z.string().optional(),
	id: z.string().optional(),
})
async function sharingRequest(db: Database, action: string, data: object) {
	await db.waitForSync({ timeoutMs: 30000 })
	let proof = db.getLocalFirstIdentityProof({
		audience: window.location.origin + "/jazz",
		ttlSeconds: 60,
	})
	if (!proof) throw new Error("Device account required")
	let response = await fetch("/api/sharing/" + action, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: "Bearer " + proof,
		},
		body: JSON.stringify(data),
	})
	if (!response.ok) throw new Error(await response.text())
	return resultSchema.parse(await response.json())
}
