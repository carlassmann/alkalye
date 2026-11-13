import { createFileRoute } from "@tanstack/react-router"
import { OnboardingScreen } from "@/app/features/onboarding/screens"
export { Route }
let Route = createFileRoute("/welcome")({ component: Screen })
function Screen() {
	return <OnboardingScreen />
}
