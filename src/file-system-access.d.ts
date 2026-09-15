// The File System Access API isn't in TypeScript's DOM lib yet.
declare global {
	interface Window {
		showDirectoryPicker(options?: {
			mode?: "read" | "readwrite"
		}): Promise<FileSystemDirectoryHandle>
	}

	interface FileSystemDirectoryHandle {
		entries(): AsyncIterableIterator<[string, FileSystemHandle]>
		queryPermission(options: {
			mode: "read" | "readwrite"
		}): Promise<"granted" | "denied" | "prompt">
		requestPermission(options: {
			mode: "read" | "readwrite"
		}): Promise<"granted" | "denied" | "prompt">
	}
}

export {}
