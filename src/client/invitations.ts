import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import type * as Context from "effect/Context"
import {
	invitationDigest,
	invitationLink,
	invitationSecret,
} from "../shared/invitations"
import type { InvitationLink, InvitationRole } from "../shared/invitations"
import type { BrowserAccount } from "./browser-account"
import type { InvitationController } from "./components/invitations"

type Account = Context.Service.Shape<typeof BrowserAccount>
export type InvitationTarget = { document: string } | { workspace: string }

// The secret exists only in the link shown once to the owner; the server keeps
// its digest. A lost link is revoked and replaced rather than recovered.
export function invitationController(
	account: Account,
	target: InvitationTarget,
	random: Crypto.Crypto,
	report: (error: unknown) => void,
): InvitationController {
	return {
		list: account.request(account.api.invitations.list({ query: target })),
		create: (role: InvitationRole) =>
			Effect.gen(function* () {
				let invitation = yield* random.randomUUIDv4
				let secret = yield* invitationSecret
				yield* account.request(
					account.api.invitations.create({
						payload: {
							invitation,
							target,
							role,
							digest: yield* invitationDigest(secret),
						},
					}),
				)
				let link: InvitationLink =
					"document" in target
						? {
								kind: "document",
								target: target.document,
								invitation,
								secret,
							}
						: {
								kind: "workspace",
								target: target.workspace,
								invitation,
								secret,
							}
				return invitationLink(account.origin, link)
			}).pipe(Effect.provideService(Crypto.Crypto, random)),
		revoke: invitation =>
			account.request(
				account.api.invitations.revoke({ params: { invitation } }),
			),
		remove: (invitation, member) =>
			Effect.gen(function* () {
				let request = yield* random.randomUUIDv4
				return yield* account.request(
					account.api.invitations.leave({
						params: { invitation, member },
						payload: { request },
					}),
				)
			}),
		report,
	}
}
