import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import {
	makeInstallation,
	isInstalled,
	isIOS,
} from "../src/client/installation"
import { openDialog } from "../src/client/components/dialog"
import { showInstallationInstructions } from "../src/client/components/settings-page"

class BrowserPrompt extends Event {
	calls = 0
	readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
	constructor(outcome: "accepted" | "dismissed") {
		super("beforeinstallprompt", { cancelable: true })
		this.userChoice = Promise.resolve({ outcome })
	}
	prompt() {
		this.calls++
		return Promise.resolve()
	}
}

declare global {
	interface Window {
		runInstallationChecks(): Promise<string[]>
	}
}
window.runInstallationChecks = runInstallationChecks

async function runInstallationChecks() {
	let checks: string[] = []
	function check(value: boolean, message: string) {
		if (!value) throw new Error(message)
		checks.push(message)
	}
	let offeredBeforeBoot = new BrowserPrompt("dismissed")
	window.dispatchEvent(offeredBeforeBoot)
	let standalone = Object.getOwnPropertyDescriptor(navigator, "standalone")
	let userAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent")
	let touches = Object.getOwnPropertyDescriptor(navigator, "maxTouchPoints")
	let dismissed = localStorage.getItem("pwa-install-hint-dismissed")
	let scope = Scope.makeUnsafe()
	let dialog = document.createElement("dialog")
	document.body.append(dialog)
	try {
		Object.defineProperty(navigator, "standalone", {
			configurable: true,
			value: true,
		})
		check(
			isInstalled(),
			"iOS standalone counts as installed without display-mode",
		)
		Object.defineProperty(navigator, "standalone", {
			configurable: true,
			value: false,
		})
		Object.defineProperty(navigator, "userAgent", {
			configurable: true,
			value: "Macintosh",
		})
		Object.defineProperty(navigator, "maxTouchPoints", {
			configurable: true,
			value: 5,
		})
		check(isIOS(), "Desktop-UA iPad receives iOS instructions")
		localStorage.removeItem("pwa-install-hint-dismissed")
		let installation = await Effect.runPromise(
			makeInstallation.pipe(Effect.provideService(Scope.Scope, scope)),
		)
		check(
			offeredBeforeBoot.defaultPrevented && installation.available(),
			"Installation offered before asynchronous app boot is retained",
		)
		await new Promise<void>(resolve => {
			let unsubscribe = installation.subscribe(() => {
				if (installation.hint()) {
					unsubscribe()
					resolve()
				}
			})
		})
		let notifications = 0
		let unsubscribe = installation.subscribe(() => notifications++)
		check(
			notifications === 1 && installation.hint(),
			"Late subscribers immediately receive current installation state",
		)
		await installation.prompt()
		showInstallationInstructions(dialog, installation, error => {
			throw error
		})
		check(
			dialog.open && !dialog.querySelector("[data-install-app]"),
			"Manual installation instructions open before a prompt exists",
		)
		let dismissedPrompt = new BrowserPrompt("dismissed")
		window.dispatchEvent(dismissedPrompt)
		check(
			dismissedPrompt.defaultPrevented && installation.available(),
			"Deferred browser prompt is captured and advertised",
		)
		check(
			Boolean(dialog.querySelector("[data-install-app]")),
			"Already-open instructions react to late prompt arrival",
		)
		check(
			(await installation.prompt()) === "dismissed",
			"Browser dismissal is distinguished from acceptance",
		)
		check(
			dialog.open && !installation.available(),
			"Dismissal keeps manual instructions and consumes the prompt",
		)
		check(
			(await installation.prompt()) === "unavailable" &&
				dismissedPrompt.calls === 1,
			"Consumed prompt cannot be invoked twice",
		)
		installation.dismissHint()
		check(
			!installation.hint() &&
				localStorage.getItem("pwa-install-hint-dismissed") === "true",
			"Maybe later persists hint dismissal",
		)
		let acceptedPrompt = new BrowserPrompt("accepted")
		window.dispatchEvent(acceptedPrompt)
		check(
			(await installation.prompt()) === "accepted",
			"Replacement prompt returns accepted outcome",
		)
		openDialog(
			dialog,
			error => {
				throw error
			},
			() => {},
			"Another action",
			"Keep this dialog",
		)
		window.dispatchEvent(new BrowserPrompt("dismissed"))
		check(
			dialog.textContent?.includes("Keep this dialog") === true,
			"Installation state cannot overwrite another dialog owner",
		)
		showInstallationInstructions(dialog, installation, error => {
			throw error
		})
		window.dispatchEvent(new Event("appinstalled"))
		check(
			installation.installed() && !installation.available() && !dialog.open,
			"appinstalled clears prompt, hides hints and closes instructions",
		)
		unsubscribe()
		let count = notifications
		await Effect.runPromise(Scope.close(scope, Exit.void))
		let closedPrompt = new BrowserPrompt("dismissed")
		window.dispatchEvent(closedPrompt)
		check(
			!closedPrompt.defaultPrevented && notifications === count,
			"Scope closure removes browser listeners and observers",
		)
		check(
			(await installation.prompt()) === "unavailable",
			"Closed owner cannot prompt",
		)
		return checks
	} finally {
		await Effect.runPromise(Scope.close(scope, Exit.void))
		dialog.remove()
		for (let [key, descriptor] of [
			["standalone", standalone],
			["userAgent", userAgent],
			["maxTouchPoints", touches],
		] satisfies ReadonlyArray<
			readonly [string, PropertyDescriptor | undefined]
		>) {
			if (descriptor) Object.defineProperty(navigator, key, descriptor)
			else Reflect.deleteProperty(navigator, key)
		}
		if (dismissed === null)
			localStorage.removeItem("pwa-install-hint-dismissed")
		else localStorage.setItem("pwa-install-hint-dismissed", dismissed)
	}
}
