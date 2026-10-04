import * as Effect from "effect/Effect"
import { promise } from "../platform/effects"
import { MediaError } from "../platform/errors"
import { cancelOnSignal } from "./cancellation"
import { readVideoDuration } from "./video-duration"

interface RecordingResources {
	video: HTMLVideoElement
	url: string
	audio?: AudioContext
	stream?: MediaStream
	recorder?: MediaRecorder
	frame: number
}
export function compressVideo(
	file: File,
	progress: (fraction: number) => void,
	signal: AbortSignal,
) {
	return cancelOnSignal(
		Effect.scoped(
			Effect.gen(function* () {
				let mime = [
					"video/mp4;codecs=avc1.42E01E,mp4a.40.2",
					"video/webm;codecs=vp9,opus",
					"video/webm;codecs=vp8,opus",
				].find(
					type =>
						typeof MediaRecorder !== "undefined" &&
						MediaRecorder.isTypeSupported(type),
				)
				if (!mime || file.size > 500 * 1024 * 1024) return file
				let resources = yield* Effect.acquireRelease(
					Effect.sync(() => {
						let video = document.createElement("video")
						let url = URL.createObjectURL(file)
						video.preload = "auto"
						video.muted = true
						video.playsInline = true
						video.src = url
						let resources: RecordingResources = { video, url, frame: 0 }
						return resources
					}),
					releaseRecording,
				)
				let { video } = resources
				yield* loaded(video)
				yield* readVideoDuration(video)
				if (!Number.isFinite(video.duration) || video.duration <= 0) return file
				let scale = Math.min(
					1,
					1920 / video.videoWidth,
					1080 / video.videoHeight,
				)
				let canvas = document.createElement("canvas")
				canvas.width = Math.max(
					2,
					Math.round((video.videoWidth * scale) / 2) * 2,
				)
				canvas.height = Math.max(
					2,
					Math.round((video.videoHeight * scale) / 2) * 2,
				)
				let context = canvas.getContext("2d")
				if (!context) return file
				context.drawImage(video, 0, 0, canvas.width, canvas.height)
				let stream = canvas.captureStream(30)
				resources.stream = stream
				let audio = new AudioContext()
				resources.audio = audio
				let destination = audio.createMediaStreamDestination()
				audio.createMediaElementSource(video).connect(destination)
				// Audio goes only to the recorder; muting the element would erase it.
				video.muted = false
				for (let track of destination.stream.getAudioTracks())
					stream.addTrack(track)
				yield* promise("video.audio", () => audio.resume())
				let recorder = new MediaRecorder(stream, {
					mimeType: mime,
					videoBitsPerSecond: 2000000,
					audioBitsPerSecond: 128000,
				})
				resources.recorder = recorder
				let result = yield* encoded(resources, context, canvas, progress)
				progress(1)
				return result.size < file.size ? result : file
			}),
		),
		signal,
	)
}
function loaded(video: HTMLVideoElement) {
	return Effect.callback<void, MediaError>(resume => {
		if (video.readyState >= 2) {
			resume(Effect.void)
			return
		}
		let events = new AbortController()
		video.addEventListener("loadeddata", () => resume(Effect.void), {
			signal: events.signal,
			once: true,
		})
		video.addEventListener(
			"error",
			() =>
				resume(
					Effect.fail(new MediaError({ message: "Cannot read this video" })),
				),
			{ signal: events.signal, once: true },
		)
		return Effect.sync(() => events.abort())
	})
}
function encoded(
	resources: RecordingResources,
	context: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	progress: (fraction: number) => void,
) {
	return Effect.callback<Blob, MediaError>(resume => {
		let { video, recorder } = resources
		if (!recorder) {
			resume(Effect.fail(new MediaError({ message: "Recorder unavailable" })))
			return
		}
		let recording = recorder
		let chunks: Blob[] = []
		let events = new AbortController()
		function fail() {
			resume(
				Effect.fail(new MediaError({ message: "Video compression failed" })),
			)
		}
		function paint() {
			if (video.ended || video.paused) return
			context.drawImage(video, 0, 0, canvas.width, canvas.height)
			progress(video.currentTime / video.duration)
			resources.frame = requestAnimationFrame(paint)
		}
		function pause() {
			video.pause()
			if (recording.state === "recording") recording.pause()
			cancelAnimationFrame(resources.frame)
		}
		recording.ondataavailable = event => {
			if (event.data.size) chunks.push(event.data)
		}
		recording.onstop = () =>
			resume(
				Effect.succeed(
					new Blob(chunks, { type: recording.mimeType.split(";")[0] }),
				),
			)
		recording.onerror = fail
		video.addEventListener(
			"ended",
			() => {
				if (recording.state !== "inactive") recording.stop()
			},
			{ signal: events.signal },
		)
		video.addEventListener("error", fail, { signal: events.signal })
		document.addEventListener(
			"visibilitychange",
			() => {
				if (document.hidden) pause()
				else if (recording.state === "paused") {
					recording.resume()
					void video.play().then(paint, fail)
				}
			},
			{ signal: events.signal },
		)
		recording.start(1000)
		void video.play().then(() => {
			if (document.hidden) pause()
			else paint()
		}, fail)
		return Effect.sync(() => {
			events.abort()
			recording.ondataavailable = null
			recording.onstop = null
			recording.onerror = null
		})
	})
}
function releaseRecording(resources: RecordingResources) {
	return Effect.gen(function* () {
		let { video, recorder, audio, stream, frame, url } = resources
		if (recorder && recorder.state !== "inactive") recorder.stop()
		cancelAnimationFrame(frame)
		video.pause()
		video.removeAttribute("src")
		video.load()
		for (let track of stream?.getTracks() ?? []) track.stop()
		if (audio)
			yield* promise("video.close", () => audio.close()).pipe(Effect.ignore)
		URL.revokeObjectURL(url)
	})
}
