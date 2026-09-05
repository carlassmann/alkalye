import { useEffect, useState } from "react"

export { useAfterFirstPaint }

function useAfterFirstPaint<T>(value: T) {
	let [deferredValue, setDeferredValue] = useState<T>()

	useEffect(() => {
		let timeout: ReturnType<typeof setTimeout> | undefined
		let frame = requestAnimationFrame(() => {
			timeout = setTimeout(() => setDeferredValue(value), 0)
		})
		return () => {
			cancelAnimationFrame(frame)
			if (timeout) clearTimeout(timeout)
		}
	}, [value])

	return deferredValue === value ? deferredValue : undefined
}
