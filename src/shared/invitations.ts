import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { decode, encode } from "./base64"
import { IdentifierSchema } from "./model"
import { InvitationDigestSchema } from "./workspace"

// An invitation link carries a secret the server never stores. Anyone holding
// the link may join with its role until the owner revokes it; revoking removes
// everyone who joined through that link, as in the original application.
export let InvitationSecretSchema = InvitationDigestSchema
export let InvitationRoleSchema = Schema.Literals(["writer", "reader"])
export type InvitationRole = typeof InvitationRoleSchema.Type

export class InvitationRevoked extends Schema.TaggedError<InvitationRevoked>()(
	"InvitationRevoked",
	{ message: Schema.String },
) {}

export let InvitationTargetSchema = Schema.Union([
	Schema.Struct({ workspace: IdentifierSchema }),
	Schema.Struct({ document: IdentifierSchema }),
])
export let InvitationMemberSchema = Schema.Struct({
	member: IdentifierSchema,
	name: Schema.String,
})
export let InvitationSummarySchema = Schema.Struct({
	invitation: IdentifierSchema,
	role: InvitationRoleSchema,
	revoked: Schema.Boolean,
	members: Schema.Array(InvitationMemberSchema),
})
export type InvitationSummary = typeof InvitationSummarySchema.Type
export let InvitationDescriptionSchema = Schema.Struct({
	kind: Schema.Literals(["document", "workspace"]),
	title: Schema.String,
	role: InvitationRoleSchema,
	owner: Schema.String,
})
export type InvitationDescription = typeof InvitationDescriptionSchema.Type
export let InvitationAcceptanceSchema = Schema.Struct({
	workspace: IdentifierSchema,
	document: Schema.NullOr(IdentifierSchema),
	role: InvitationRoleSchema,
})
export type InvitationAcceptance = typeof InvitationAcceptanceSchema.Type

export interface InvitationLink {
	readonly kind: "document" | "workspace"
	readonly target: string
	readonly invitation: string
	readonly secret: string
}

export function invitationLink(origin: string, link: InvitationLink) {
	return (
		origin.replace(/\/$/, "") +
		"/invite#/" +
		(link.kind === "document" ? "doc" : "space") +
		"/" +
		encodeURIComponent(link.target) +
		"/invite/" +
		encodeURIComponent(link.invitation) +
		"/" +
		link.secret
	)
}

export function parseInvitationLink(hash: string): InvitationLink | undefined {
	let match = hash.match(
		/^#\/(doc|space)\/([^/]+)\/invite\/([^/]+)\/([\w-]{43})$/,
	)
	if (!match) return undefined
	let [, kind, target = "", invitation = "", secret = ""] = match
	try {
		target = decodeURIComponent(target)
		invitation = decodeURIComponent(invitation)
	} catch {
		return undefined
	}
	let valid =
		Schema.is(IdentifierSchema)(target) &&
		Schema.is(IdentifierSchema)(invitation) &&
		Schema.is(InvitationSecretSchema)(secret)
	return valid
		? {
				kind: kind === "doc" ? "document" : "workspace",
				target,
				invitation,
				secret,
			}
		: undefined
}

export let invitationSecret = Crypto.Crypto.use(crypto =>
	crypto.randomBytes(32).pipe(Effect.map(encode)),
)

export function invitationDigest(secret: string) {
	return Crypto.Crypto.use(crypto =>
		crypto.digest("SHA-256", decode(secret)).pipe(Effect.map(encode)),
	)
}
