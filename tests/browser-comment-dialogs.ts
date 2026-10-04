import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import { TaskGroup } from "../src/platform/tasks"
import { openDialog } from "../src/client/components/dialog"
import { html } from "../src/client/language"

type Check = (value: unknown, message: string) => void

export function verifyCommentDialogLifetime(check: Check) {
	return Effect.gen(function* () {
		let dialog = yield* Effect.acquireRelease(
			Effect.sync(() => {
				let dialog = document.createElement("dialog")
				document.body.append(dialog)
				return dialog
			}),
			dialog =>
				Effect.sync(() => {
					dialog.close()
					dialog.remove()
				}),
		)
		let parent = yield* Scope.Scope
		let scope = yield* Scope.fork(parent, "parallel")
		let tasks = yield* TaskGroup.make.pipe(
			Effect.provideService(Scope.Scope, scope),
		)
		let held = yield* Deferred.make<void>()
		let errors: unknown[] = []
		let saved = 0
		openDialog(
			dialog,
			error => errors.push(error),
			() => saved++,
			"Closing submission",
			html`<label>Comment<textarea name="body"></textarea></label>`,
			() => tasks.run(Deferred.await(held)),
		)
		let form = dialog.querySelector("form")
		let submit = dialog.querySelector<HTMLButtonElement>("#submit-dialog")
		if (!form || !submit) throw new Error("Missing test comment form")
		form.requestSubmit(submit)
		dialog.close()
		yield* Scope.close(scope, Exit.void)
		yield* Effect.sleep("0 millis")
		check(
			errors.length === 0 && saved === 0,
			"closing a pending comment dialog suppresses cancelled submission errors and saved callbacks",
		)
		let completed = yield* Deferred.make<void>()
		let nextTasks = yield* TaskGroup.make
		openDialog(
			dialog,
			error => errors.push(error),
			() => saved++,
			"First submission",
			html`<p>First</p>`,
			() => nextTasks.run(Deferred.await(completed)),
		)
		let first = dialog.querySelector("form")
		let firstSubmit = dialog.querySelector<HTMLButtonElement>("#submit-dialog")
		if (!first || !firstSubmit) throw new Error("Missing first form")
		first.requestSubmit(firstSubmit)
		openDialog(
			dialog,
			error => errors.push(error),
			() => saved++,
			"Replacement",
			html`<p>Second</p>`,
			() => nextTasks.run(Effect.void),
		)
		yield* Deferred.succeed(completed, undefined)
		yield* Effect.sleep("0 millis")
		check(
			dialog.open &&
				dialog.querySelector("h2")?.textContent === "Replacement" &&
				saved === 0 &&
				errors.length === 0,
			"a delayed old submission cannot close or report success for a newer dialog",
		)
	})
}
