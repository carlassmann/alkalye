import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { PermissionDenied } from "../shared/document-errors"
import { metadataSource } from "../shared/document-metadata"
import type { MetadataPatch } from "../shared/document-metadata"
import { withFrontmatter } from "../shared/markdown"
import { DocumentSession } from "./document-session"

interface PropertyOptions {
	document: string
	canWrite(): boolean
}

export class DocumentProperties extends Context.Service<
	DocumentProperties,
	Effect.Success<ReturnType<typeof makeProperties>>
>()("alkalye/DocumentProperties") {
	static layer(options: PropertyOptions) {
		return Layer.effect(DocumentProperties, makeProperties(options))
	}
}

function makeProperties(options: PropertyOptions) {
	return Effect.gen(function* () {
		let session = yield* DocumentSession
		let writable = Effect.suspend(() =>
			options.canWrite()
				? Effect.void
				: Effect.fail(
						new PermissionDenied({ message: "This document is read-only" }),
					),
		)
		return Object.freeze({
			update(patch: MetadataPatch, label = "Document properties") {
				return writable.pipe(
					Effect.andThen(
						session.change(label, staged => {
							assertWritable()
							return [
								staged.edit(
									options.document,
									metadataSource(staged.text(options.document), patch),
								),
							]
						}),
					),
				)
			},
			presentation(enabled: boolean) {
				return writable.pipe(
					Effect.andThen(
						session.change(
							enabled ? "Turn into presentation" : "Turn into document",
							staged => {
								assertWritable()
								return [
									staged.edit(
										options.document,
										withFrontmatter(staged.text(options.document), {
											mode: enabled ? "present" : undefined,
										}),
									),
								]
							},
						),
					),
				)
			},
		})
		// Access may change while the command waits for the session gate.
		function assertWritable() {
			if (!options.canWrite())
				throw new PermissionDenied({ message: "This document is read-only" })
		}
	})
}
