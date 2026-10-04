import * as Data from "effect/Data"

export class StorageError extends Data.TaggedError("StorageError")<{
	readonly operation: string
	readonly cause: unknown
}> {
	get message() {
		return this.cause instanceof Error
			? this.cause.message
			: `Storage failed: ${this.operation}`
	}
}
export class CryptoError extends Data.TaggedError("CryptoError")<{
	readonly operation: string
	readonly cause: unknown
}> {
	get message() {
		return `Cryptography failed: ${this.operation}`
	}
}
export class NetworkError extends Data.TaggedError("NetworkError")<{
	readonly operation: string
	readonly cause: unknown
}> {
	get message() {
		return this.cause instanceof Error
			? this.cause.message
			: `Network failed: ${this.operation}`
	}
}
export class ApplicationError extends Data.TaggedError("ApplicationError")<{
	readonly operation: string
	readonly cause: unknown
}> {
	get message() {
		return this.cause instanceof Error
			? this.cause.message
			: `Operation failed: ${this.operation}`
	}
}

export class MediaError extends Data.TaggedError("MediaError")<{
	readonly message: string
}> {}
export class SyncError extends Data.TaggedError("SyncError")<{
	readonly message: string
	readonly revoked?: boolean
}> {}

export class RoomRegistrationError extends Data.TaggedError(
	"RoomRegistrationError",
)<{
	readonly message: string
	readonly status: 403 | 410
}> {}
