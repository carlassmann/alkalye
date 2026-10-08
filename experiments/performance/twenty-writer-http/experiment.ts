import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { Signatures } from "../../../src/platform/signatures"
import { webCryptoLayer } from "../../../src/platform/web-crypto"
import { encode } from "../../../src/shared/base64"
import { DocumentApi } from "../../../src/shared/document-api"
import {
	buildAction,
	restoreSnapshot,
	validateActionIdentity,
} from "../../../src/shared/document-actions"
import {
	invitationSecret,
	invitationDigest,
} from "../../../src/shared/invitations"
import { newDocument } from "../../../src/shared/documents"
import { Replica } from "../../../src/shared/crdt"
import { performanceFixture } from "../fixture"

let [baseArgument, output] = Bun.argv.slice(2)
if (!baseArgument || !output) throw Error("URL and output required")
let base = new URL(baseArgument)
if (!["127.0.0.1", "localhost"].includes(base.hostname))
	throw Error("Disposable local server required")
let writers = 20,
	rounds = 3,
	intervalMs = 1000
let document = "benchmark-twenty-document-final",
	workspace = "benchmark-twenty-space-final"
interface Observation {
	writer: number
	round: number
	dispatchLatenessMs: number
	requestMs: number
	position: number | null
	accepted: boolean
	errors: string[]
}
let observations: Observation[] = []
let phase = "authentication"
function failureLabel(error: unknown) {
	if (
		typeof error === "object" &&
		error !== null &&
		"_tag" in error &&
		typeof error._tag === "string"
	)
		return error._tag
	return error instanceof Error ? error.name : typeof error
}
let program = Effect.scoped(
	Effect.gen(function* () {
		let accounts = []
		for (let index = 0; index < writers; index++) {
			let signatures = yield* Signatures
			let identity = yield* signatures.account(
				Redacted.make(encode(new Uint8Array(32).fill(170 + index))),
			)
			let anonymous = yield* HttpApiClient.make(DocumentApi, { baseUrl: base })
			let challenge = yield* anonymous.authentication.challenge({
				payload: { publicKey: identity.publicKey, purpose: "bearer" },
			})
			let signature = yield* identity.signAuthentication(challenge, {
				origin: base.origin,
				purpose: "bearer",
			})
			let login = yield* anonymous.authentication.bearerLogin({
				payload: { id: challenge.id, publicKey: identity.publicKey, signature },
			})
			let api = yield* HttpApiClient.make(DocumentApi, {
				baseUrl: base,
				transformClient: client =>
					HttpClient.mapRequest(
						client,
						HttpClientRequest.bearerToken(Redacted.make(login.token)),
					),
			})
			accounts.push({ api, subject: login.subject })
		}
		phase = "workspace-and-invites"
		let owner = accounts[0]
		if (!owner) throw Error("Missing owner")
		yield* owner.api.workspaces.create({
			payload: {
				workspace,
				name: "Twenty writers",
				request: "create-twenty-final",
			},
		})
		let source = performanceFixture(128)
		let creation = yield* buildAction(
			new Replica(owner.subject + "-benchmark-creator"),
			document,
			"Create benchmark",
			staged => newDocument(staged, document, "Untitled", source),
		)
		let initialPosition = yield* owner.api.documents.create({
			payload: { workspace, action: creation },
		})
		let secret = yield* invitationSecret
		yield* owner.api.invitations.create({
			payload: {
				invitation: "benchmark-twenty-invitation-final",
				target: { workspace },
				role: "writer",
				digest: yield* invitationDigest(secret),
			},
		})
		for (let [index, account] of accounts.entries())
			if (index > 0)
				yield* account.api.invitations.accept({
					params: { invitation: "benchmark-twenty-invitation-final" },
					payload: { secret, request: "join-twenty-final-" + index },
				})
		let snapshot = yield* owner.api.documents.snapshot({
			params: { document },
			query: {},
		})
		let origin = yield* restoreSnapshot(snapshot, "benchmark-origin")
		if (origin.text(document) !== source)
			throw Error("Initial snapshot mismatch")
		phase = "preparing-actions"
		let requests = []
		for (let [writer, account] of accounts.entries()) {
			let replica = yield* origin.forkEffect(
				account.subject + "-benchmark-writer-" + writer,
			)
			for (let round = 0; round < rounds; round++) {
				let marker = `\nBENCHMARK_WRITER_${writer}_ROUND_${round}\n`
				let action = yield* buildAction(
					replica,
					document,
					"Writer append",
					staged => [staged.edit(document, staged.text(document) + marker)],
				)
				replica.apply(yield* validateActionIdentity(action))
				requests.push({ writer, round, marker, action, account })
			}
		}
		phase = "commit-load"
		let clientCpuStart = process.cpuUsage()
		let started = performance.now()
		console.info(
			JSON.stringify({
				phase: "timing-start",
				unixMs: performance.timeOrigin + started,
				writers,
				rounds,
				fixtureCharacters: source.length,
				plannedRate: 20,
				serverProcessSeparate: true,
			}),
		)
		let grouped = yield* Effect.forEach(
			accounts,
			(_, writer) =>
				Effect.forEach(
					requests.filter(request => request.writer === writer),
					request =>
						Effect.gen(function* () {
							let scheduled = started + request.round * intervalMs
							yield* Effect.sleep(Math.max(0, scheduled - performance.now()))
							let dispatched = performance.now()
							let receipt = yield* Effect.exit(
								request.account.api.documents
									.commit({ params: { document }, payload: request.action })
									.pipe(Effect.timeout("20 seconds")),
							)
							let finished = performance.now()
							let result = {
								writer: request.writer,
								round: request.round,
								dispatchLatenessMs: dispatched - scheduled,
								requestMs: finished - dispatched,
								position: receipt._tag === "Success" ? receipt.value : null,
								accepted: receipt._tag === "Success",
								errors:
									receipt._tag === "Failure"
										? receipt.cause.reasons.map(reason =>
												reason._tag === "Fail"
													? failureLabel(reason.error)
													: reason._tag,
											)
										: [],
							}
							observations.push(result)
							return result
						}),
					{ concurrency: 1 },
				),
			{ concurrency: "unbounded" },
		)
		let results = grouped.flat()
		let finished = performance.now()
		let clientCpu = process.cpuUsage(clientCpuStart),
			clientRss = process.memoryUsage().rss
		phase = "verifying-convergence"
		console.info(
			JSON.stringify({
				phase: "timing-end",
				unixMs: performance.timeOrigin + finished,
			}),
		)
		let finalSnapshot = yield* owner.api.documents.snapshot({
			params: { document },
			query: {},
		})
		let verification = yield* restoreSnapshot(
			finalSnapshot,
			"benchmark-verifier",
		)
		let finalSource = verification.text(document)
		let exactMarkers = requests.every(
			request => finalSource.split(request.marker).length === 2,
		)
		let receipts = results
			.flatMap(result => (result.position === null ? [] : [result.position]))
			.sort((a, b) => a - b)
		let contiguous = receipts.every(
			(position, index) => position === initialPosition + index + 1,
		)
		let history = yield* owner.api.documents.history({
			params: { document },
			query: { after: initialPosition, log: finalSnapshot.log, limit: 100 },
		})
		let acceptedCursor = history.at(-1)?.position ?? initialPosition
		let report = {
			method:
				"Twenty authenticated HTTP writers in one driver process; separate native server process. Actions prepared before timing. No browser rendering or persisted client-session claim.",
			writers,
			rounds,
			intervalMs,
			fixtureCharacters: source.length,
			initialPosition,
			acceptedCursor,
			elapsedMs: finished - started,
			throughput: (receipts.length * 1000) / (finished - started),
			allAccepted: receipts.length === writers * rounds,
			exactMarkers,
			contiguous,
			finalSnapshotPosition: finalSnapshot.position,
			results,
			clientCpu,
			clientRss,
		}
		yield* Effect.promise(() =>
			Bun.write(output, JSON.stringify(report, null, 2)),
		)
		if (
			!report.allAccepted ||
			!exactMarkers ||
			!contiguous ||
			acceptedCursor !== initialPosition + writers * rounds
		)
			throw Error("Acceptance/convergence failed; raw report retained")
	}),
)
let exit = await Effect.runPromise(
	Effect.exit(
		program.pipe(
			Effect.provide(Signatures.layer),
			Effect.provide(FetchHttpClient.layer),
			Effect.provide(webCryptoLayer),
			Effect.timeout("120 seconds"),
		),
	),
)
if (exit._tag === "Failure") {
	let existing = (await Bun.file(output).exists())
		? await Bun.file(output).json()
		: {}
	await Bun.write(
		output,
		JSON.stringify(
			{
				...existing,
				observations,
				failure: {
					phase,
					errors: exit.cause.reasons.map(reason =>
						reason._tag === "Fail" ? failureLabel(reason.error) : reason._tag,
					),
				},
			},
			null,
			2,
		),
	)
	throw Error("Benchmark failed; sanitized result retained")
}
