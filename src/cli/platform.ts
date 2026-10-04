import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as PlatformError from "effect/PlatformError"
import * as Sink from "effect/Sink"
import * as Stdio from "effect/Stdio"
import * as Stream from "effect/Stream"
import * as Terminal from "effect/Terminal"
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import { access, chmod, mkdir, open, rename, rm } from "node:fs/promises"
import { dirname } from "node:path"

export let cliPlatform = Layer.mergeAll(
	Layer.succeed(
		FileSystem.FileSystem,
		FileSystem.FileSystem.of({
			"~effect/FileSystem": "~effect/FileSystem",
			access: path => native("access", path, () => access(path)),
			copy: unsupported,
			copyFile: unsupported,
			chown: unsupported,
			glob: unsupported,
			link: unsupported,
			makeTempDirectory: unsupported,
			makeTempDirectoryScoped: unsupported,
			makeTempFile: unsupported,
			makeTempFileScoped: unsupported,
			open: unsupported,
			readDirectory: unsupported,
			readFile: unsupported,
			writeFile: unsupported,
			readLink: unsupported,
			realPath: unsupported,
			stat: unsupported,
			symlink: unsupported,
			truncate: unsupported,
			utimes: unsupported,
			stream: () => Stream.die("Unsupported Bun CLI filesystem operation"),
			watch: () => Stream.die("Unsupported Bun CLI filesystem operation"),
			sink: () => Sink.die("Unsupported Bun CLI filesystem operation"),
			exists: path =>
				native("exists", path, () => access(path)).pipe(
					Effect.as(true),
					Effect.catchTag("PlatformError", fault =>
						fault.reason._tag === "NotFound"
							? Effect.succeed(false)
							: Effect.fail(fault),
					),
				),
			readFileString: path => native("read", path, () => Bun.file(path).text()),
			makeDirectory: (path, options) =>
				native("mkdir", path, () => mkdir(path, options)).pipe(Effect.asVoid),
			writeFileString: (path, content, options) =>
				Effect.acquireUseRelease(
					native("open", path, () =>
						open(path, options?.flag || "w", options?.mode),
					),
					handle =>
						native("write", path, () => handle.writeFile(content)).pipe(
							Effect.andThen(native("sync", path, () => handle.sync())),
						),
					handle =>
						native("close", path, () => handle.close()).pipe(Effect.orDie),
				),
			chmod: (path, mode) => native("chmod", path, () => chmod(path, mode)),
			rename: (from, to) =>
				native("rename", from, () => rename(from, to)).pipe(
					Effect.andThen(
						Effect.acquireUseRelease(
							native("open", dirname(to), () => open(dirname(to), "r")),
							handle => native("sync", dirname(to), () => handle.sync()),
							handle =>
								native("close", dirname(to), () => handle.close()).pipe(
									Effect.orDie,
								),
						),
					),
				),
			remove: (path, options) =>
				native("remove", path, () => rm(path, options)),
		}),
	),
	Path.layer,
	Layer.succeed(
		Stdio.Stdio,
		Stdio.make({
			args: Effect.sync(() => process.argv.slice(2)),
			stdinIsTerminal: Effect.sync(() => Boolean(process.stdin.isTTY)),
			stdoutIsTerminal: Effect.sync(() => Boolean(process.stdout.isTTY)),
			stdin: Stream.fromReadableStream({
				evaluate: () => Bun.stdin.stream(),
				onError: cause => failure("stdin", "stdin", cause),
			}),
			stdout: () => Sink.forEach(value => write(process.stdout, value)),
			stderr: () => Sink.forEach(value => write(process.stderr, value)),
		}),
	),
	Layer.succeed(
		Terminal.Terminal,
		Terminal.make({
			columns: Effect.sync(() => process.stdout.columns || 80),
			rows: Effect.sync(() => process.stdout.rows || 24),
			display: value => write(process.stdout, value),
			readInput: Effect.die("Interactive CLI built-ins are disabled"),
			readLine: Effect.fail(new Terminal.QuitError()),
		}),
	),
	Layer.succeed(
		ChildProcessSpawner.ChildProcessSpawner,
		ChildProcessSpawner.make(() =>
			Effect.fail(
				failure(
					"spawn",
					"process",
					"These commands do not spawn child processes",
				),
			),
		),
	),
)
function native<A>(method: string, path: string, operation: () => Promise<A>) {
	return Effect.tryPromise({
		try: operation,
		catch: cause => failure(method, path, cause),
	})
}
function write(destination: NodeJS.WriteStream, value: string | Uint8Array) {
	return native(
		"write",
		"stdio",
		() =>
			new Promise<void>((resolve, reject) => {
				destination.write(value, error => (error ? reject(error) : resolve()))
			}),
	)
}
function failure(method: string, path: string, cause: unknown) {
	let code =
		typeof cause === "object" && cause !== null && "code" in cause
			? cause.code
			: ""
	return PlatformError.systemError({
		_tag:
			code === "ENOENT"
				? "NotFound"
				: code === "EACCES" || code === "EPERM"
					? "PermissionDenied"
					: code === "EEXIST"
						? "AlreadyExists"
						: "Unknown",
		module: "Bun",
		method,
		pathOrDescriptor: path,
		cause,
		description: cause instanceof Error ? cause.message : String(cause),
	})
}

function unsupported() {
	return Effect.die("Unsupported Bun CLI filesystem operation")
}
