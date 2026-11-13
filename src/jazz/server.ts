import { acceptDeviceAccounts, createJazz, sqlite } from "jazz-tools/backend"
import { app } from "./schema"
import { permissions } from "./permissions"

export let jazz = createJazz({
	app,
	permissions,
	authenticate: acceptDeviceAccounts,
	store: sqlite({ path: ".jazz" }),
})
