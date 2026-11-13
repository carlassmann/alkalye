import { Link } from "@tanstack/react-router"
import { Button } from "./ui/button"
export { DeferredScreen }
function DeferredScreen({ area }: { area: string }) {
	// v2-todo(features): feature-specific screens need their data ports.
	return (
		<div className="m-auto space-y-4 p-8">
			<h1>{area}</h1>
			<p>This feature is being migrated.</p>
			<Button render={<Link to="/" />} nativeButton={false}>
				Home
			</Button>
		</div>
	)
}
