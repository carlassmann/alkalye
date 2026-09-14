export { readStorageMode, writeStorageMode, type StorageMode }

type StorageMode = "filesystem" | "synced"

let storageKey = "alkalye-storage-mode"

function readStorageMode(): StorageMode {
	try {
		return window.localStorage.getItem(storageKey) === "filesystem"
			? "filesystem"
			: "synced"
	} catch {
		return "synced"
	}
}

function writeStorageMode(mode: StorageMode): void {
	try {
		window.localStorage.setItem(storageKey, mode)
	} catch {
		return
	}
}
