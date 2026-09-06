import { Share, SquareArrowUp } from "lucide-react"
import { isApplePlatform } from "@/app/lib/platform"

export { NativeShareIcon }

function NativeShareIcon({ className }: { className?: string }) {
	if (isApplePlatform()) return <SquareArrowUp className={className} />
	return <Share className={className} />
}
