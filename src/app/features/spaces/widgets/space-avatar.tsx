import { useEffect, useRef } from "react"
import type { Space } from "../lib/spaces"
export { SpaceAvatarImage }
function SpaceAvatarImage({
	space,
	className,
}: {
	space: Space
	className?: string
}) {
	let image = useRef<HTMLImageElement>(null)
	useEffect(() => {
		if (!space.avatar || !image.current) return
		let url = URL.createObjectURL(
			new Blob([new Uint8Array(space.avatar)], { type: "image/jpeg" }),
		)
		image.current.src = url
		return () => URL.revokeObjectURL(url)
	}, [space.avatar])
	return <img ref={image} alt={space.name} className={className} />
}
