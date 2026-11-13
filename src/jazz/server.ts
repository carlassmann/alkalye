import process from "node:process"
import {
	acceptDeviceAccounts,
	createJazz,
	remote,
	sqlite,
} from "jazz-tools/backend"
import { app } from "./schema"
import { permissions } from "./permissions"

export let jazz = createJazz({
	app,
	permissions,
	authenticate: acceptDeviceAccounts,
	publicUrl: process.env.WORK_WEB_URL
		? `${process.env.WORK_WEB_URL}/jazz`
		: process.env.JAZZ_PUBLIC_URL,
	store: createStore(),
})

function createStore() {
	if (import.meta.env.PROD && process.env.ALKALYE_LOCAL_PREVIEW !== "1") {
		return remote({
			appId: requiredEnv("JAZZ_APP_ID"),
			url: requiredEnv("JAZZ_SERVER_URL"),
			secret: requiredEnv("JAZZ_ADMIN_SECRET"),
		})
	}
	return sqlite({ path: ".jazz" })
}

function requiredEnv(name: string) {
	let value = process.env[name]
	if (!value) throw new Error(`Missing ${name}`)
	return value
}

if (import.meta.hot)
	import.meta.hot.dispose(() => {
		void jazz.close()
	})
