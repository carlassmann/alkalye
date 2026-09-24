export { isLaserPreview }

function isLaserPreview() {
	return (
		window.self !== window.top &&
		new URLSearchParams(window.location.search).get("laserPreview") === "true"
	)
}
