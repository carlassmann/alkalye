import type { WriteHandle } from "jazz-tools"
import { toast } from "sonner"

export { watchWrite, localWriteReceipt }

let receipts = new WeakMap<
	WriteHandle<unknown, unknown>,
	{
		promise: Promise<unknown>
		observed: boolean
	}
>()

function watchWrite(write: WriteHandle<unknown, unknown>) {
	let receipt = receiptFor(write)
	if (receipt.observed) return
	receipt.observed = true
	void receipt.promise.catch(error =>
		toast.error(
			error instanceof Error ? error.message : "Could not save locally",
		),
	)
}

function localWriteReceipt(write: WriteHandle<unknown, unknown>) {
	return receiptFor(write).promise
}

function receiptFor(write: WriteHandle<unknown, unknown>) {
	let receipt = receipts.get(write)
	if (!receipt) {
		receipt = { promise: write.wait({ tier: "local" }), observed: false }
		receipts.set(write, receipt)
	}
	return receipt
}
