export { compressVideo, canEncodeVideo, VideoCompressionError }

type CompressionProgress = {
	phase: "compressing" | "finalizing"
	progress: number // 0-1
}

type CompressionOptions = {
	onProgress?: (progress: CompressionProgress) => void
	signal?: AbortSignal
}

// defaults from PLAN.md
let MAX_INPUT_SIZE = 500 * 1024 * 1024 // 500MB
let MAX_WIDTH = 1920
let MAX_HEIGHT = 1080
let MAX_FRAME_RATE = 30
let VIDEO_BITRATE = 2_000_000 // 2Mbps
let AUDIO_BITRATE = 128_000 // 128kbps

class VideoCompressionError extends Error {
	code: "unsupported" | "too_large" | "invalid_format" | "cancelled" | "failed"

	constructor(
		message: string,
		code:
			| "unsupported"
			| "too_large"
			| "invalid_format"
			| "cancelled"
			| "failed",
	) {
		super(message)
		this.name = "VideoCompressionError"
		this.code = code
	}
}

async function checkVideoEncodingSupport(): Promise<boolean> {
	if (
		typeof VideoEncoder === "undefined" ||
		typeof AudioEncoder === "undefined"
	)
		return false
	// Probe the AVC/AAC formats the converter writes, without loading the converter.
	let [video, audio] = await Promise.all([
		VideoEncoder.isConfigSupported({
			codec: "avc1.640028",
			width: MAX_WIDTH,
			height: MAX_HEIGHT,
			bitrate: VIDEO_BITRATE,
		}),
		AudioEncoder.isConfigSupported({
			codec: "mp4a.40.2",
			numberOfChannels: 2,
			sampleRate: 48000,
			bitrate: AUDIO_BITRATE,
		}),
	])
	return video.supported === true && audio.supported === true
}

let encodingSupportPromise: Promise<boolean> | undefined

function canEncodeVideo(): Promise<boolean> {
	encodingSupportPromise ??= checkVideoEncodingSupport().catch(() => {
		encodingSupportPromise = undefined
		return false
	})
	return encodingSupportPromise
}

async function compressVideo(
	file: File,
	options: CompressionOptions = {},
): Promise<Blob> {
	let { onProgress, signal } = options

	if (file.size > MAX_INPUT_SIZE) {
		throw new VideoCompressionError(
			`File too large (max ${MAX_INPUT_SIZE / 1024 / 1024}MB)`,
			"too_large",
		)
	}

	if (!file.type.startsWith("video/")) {
		throw new VideoCompressionError("Not a video file", "invalid_format")
	}

	let canEncode = await canEncodeVideo()
	if (!canEncode) {
		throw new VideoCompressionError(
			"Video encoding not supported in this browser",
			"unsupported",
		)
	}

	if (signal?.aborted) throw new VideoCompressionError("Cancelled", "cancelled")
	let {
		Input,
		Output,
		Conversion,
		ALL_FORMATS,
		BlobSource,
		Mp4OutputFormat,
		BufferTarget,
	} = await import("mediabunny")
	if (signal?.aborted) throw new VideoCompressionError("Cancelled", "cancelled")

	let input = new Input({
		formats: ALL_FORMATS,
		source: new BlobSource(file),
	})

	let output = new Output({
		format: new Mp4OutputFormat(),
		target: new BufferTarget(),
	})

	let videoTrack = await input.getPrimaryVideoTrack()
	let videoOptions = videoTrack
		? (() => {
				// Scale down if needed, preserving aspect ratio
				let w = videoTrack.displayWidth
				let h = videoTrack.displayHeight
				let scale = Math.min(1, MAX_WIDTH / w, MAX_HEIGHT / h)
				return {
					width: Math.round(w * scale),
					height: Math.round(h * scale),
					fit: "contain" as const,
					frameRate: MAX_FRAME_RATE,
					codec: "avc" as const,
					bitrate: VIDEO_BITRATE,
				}
			})()
		: { discard: true as const }

	let conversion = await Conversion.init({
		input,
		output,
		video: videoOptions,
		audio: {
			codec: "aac",
			bitrate: AUDIO_BITRATE,
		},
	})

	if (!conversion.isValid) {
		let reasons = conversion.discardedTracks
			.map(t => `${t.track.type}: ${t.reason}`)
			.join(", ")
		throw new VideoCompressionError(
			`Cannot convert video: ${reasons}`,
			"failed",
		)
	}

	conversion.onProgress = progress => {
		onProgress?.({ phase: "compressing", progress })
	}

	if (signal?.aborted) {
		throw new VideoCompressionError("Cancelled", "cancelled")
	}

	let abortHandler: (() => Promise<void>) | undefined
	if (signal) {
		abortHandler = async () => {
			await conversion.cancel()
		}
		signal.addEventListener("abort", abortHandler)
	}

	try {
		await conversion.execute()
	} catch (error) {
		if (signal?.aborted) {
			throw new VideoCompressionError("Cancelled", "cancelled")
		}
		throw new VideoCompressionError(
			error instanceof Error ? error.message : "Compression failed",
			"failed",
		)
	} finally {
		if (signal && abortHandler) {
			signal.removeEventListener("abort", abortHandler)
		}
	}

	onProgress?.({ phase: "finalizing", progress: 1 })

	let buffer = output.target.buffer
	if (!buffer) {
		throw new VideoCompressionError("Compression produced no output", "failed")
	}

	return new Blob([buffer], { type: "video/mp4" })
}
