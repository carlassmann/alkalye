import { useEffect, useRef, type RefObject } from "react"
import { createLaserTrail } from "../lib/laser-trail"

export { LaserTrail }
export type { LaserTrailController }

type LaserTrailController = ReturnType<typeof createLaserTrail>

function LaserTrail({
	controllerRef,
	fixed = false,
}: {
	controllerRef: RefObject<LaserTrailController | null>
	fixed?: boolean
}) {
	let pathRef = useRef<SVGPathElement>(null)
	useEffect(() => {
		if (!pathRef.current) return
		let trail = createLaserTrail(pathRef.current)
		controllerRef.current = trail
		return () => {
			trail.clear()
			controllerRef.current = null
		}
	}, [controllerRef])
	return (
		<svg
			aria-hidden="true"
			data-laser-trail
			viewBox="0 0 1000 1000"
			preserveAspectRatio="none"
			className="pointer-events-none inset-0 h-full w-full"
			style={{ position: fixed ? "fixed" : "absolute", zIndex: 100 }}
		>
			<path
				ref={pathRef}
				fill="none"
				stroke="#ff304f"
				strokeWidth="4"
				strokeLinecap="round"
				strokeLinejoin="round"
				vectorEffect="non-scaling-stroke"
				style={{ filter: "drop-shadow(0 0 3px #ff304f)" }}
			/>
		</svg>
	)
}
