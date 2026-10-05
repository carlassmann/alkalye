import type { LivePresence } from "../shared/document-live"
import type { AccessRole } from "../shared/workspace"
import { maximumPresentationSkew } from "../shared/presentation-follow"

export function presentationPresence(
	presence: LivePresence,
	role: AccessRole,
	now: number,
): LivePresence {
	let authorized = { ...presence }
	delete authorized.own
	if (role === "reader") {
		authorized.presenting = false
		delete authorized.movedAt
		delete authorized.target
		authorized.x = -1
		authorized.y = -1
	} else if (
		authorized.movedAt !== undefined &&
		authorized.movedAt > now + maximumPresentationSkew
	) {
		authorized.movedAt = now
	}
	return authorized
}
