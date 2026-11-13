import type { WriteHandle } from "jazz-tools"
import { toast } from "sonner"

export { watchWrite }

function watchWrite(write: WriteHandle<unknown, unknown>) {
	void write
		.wait({ tier: "local" })
		.catch(error =>
			toast.error(
				error instanceof Error ? error.message : "Could not save locally",
			),
		)
}
