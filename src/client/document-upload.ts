import * as Effect from "effect/Effect"
import { showProgress } from "./components/progress"

export function prepareAttachment(file: File) {
	return Effect.gen(function* () {
		let blob: Blob = file
		if (file.type.startsWith("video/")) {
			blob = yield* Effect.scoped(
				Effect.gen(function* () {
					let controller = yield* Effect.acquireRelease(
						Effect.sync(() => new AbortController()),
						controller => Effect.sync(() => controller.abort()),
					)
					let progress = yield* Effect.acquireRelease(
						Effect.sync(() =>
							showProgress("Compressing video", 1, () => controller.abort()),
						),
						progress => Effect.sync(() => progress.finish()),
					)
					let { compressVideo } = yield* Effect.tryPromise(
						() => import("./videos"),
					)
					return yield* compressVideo(
						file,
						fraction => progress.update(file.name, fraction),
						controller.signal,
					)
				}),
			).pipe(Effect.catch(() => Effect.succeed(file)))
		} else if (file.type.startsWith("image/")) {
			let { downscaleImage } = yield* Effect.tryPromise(
				() => import("./images"),
			)
			blob = yield* downscaleImage(file).pipe(
				Effect.catch(() => Effect.succeed(file)),
			)
		}
		let name = file.name
		if (blob !== file) {
			let extension = new Map([
				["image/webp", ".webp"],
				["video/webm", ".webm"],
				["video/mp4", ".mp4"],
			]).get(blob.type.split(";")[0] ?? "")
			if (extension) name = name.replace(/\.[^.]+$/, "") + extension
		}
		return { blob, name }
	})
}
