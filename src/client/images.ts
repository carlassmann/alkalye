import * as Effect from "effect/Effect"
import { promise } from "../platform/effects"
import type { ApplicationError } from "../platform/errors"
export function downscaleImage(
	file: File,
): Effect.Effect<Blob, ApplicationError> {
	return Effect.scoped(
		Effect.gen(function* () {
			if (!/^image\/(png|jpeg)$/.test(file.type)) return file
			let image = yield* promise("images.downscaleImage", () =>
				createImageBitmap(file).catch(() => undefined),
			)
			if (!image) return file
			yield* Effect.addFinalizer(() => Effect.sync(() => image.close()))
			{
				let scale = Math.min(1, 2048 / Math.max(image.width, image.height))
				if (scale === 1) return file
				let canvas = document.createElement("canvas")
				canvas.width = Math.round(image.width * scale)
				canvas.height = Math.round(image.height * scale)
				let context = canvas.getContext("2d")
				if (!context) return file
				context.drawImage(image, 0, 0, canvas.width, canvas.height)
				let blob = yield* promise(
					"images.downscaleImage",
					() =>
						new Promise<Blob | null>(resolve =>
							canvas.toBlob(resolve, "image/webp", 0.9),
						),
				)
				return blob?.type === "image/webp" && blob.size < file.size
					? blob
					: file
			}
		}),
	)
}
