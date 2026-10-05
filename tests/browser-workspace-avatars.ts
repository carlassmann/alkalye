import {
	assert,
	browser,
	evaluate,
	wait,
	workspaceValue,
} from "./browser-driver"

// The original's space avatars: initials until an owner uploads an image,
// a square cropper that drags and zooms, the avatar in the workspace menu,
// and removal back to initials.

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "workspace-avatars-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	browser(session, "set", "viewport", "1280", "900")
	browser(session, "open", url)
	wait(session, 'document.querySelector("[data-document-app]") !== null')
	browser(session, "click", '[data-action="new-workspace"]')
	browser(session, "fill", '#dialog input[name="name"]', "Design Team")
	browser(session, "click", "#submit-dialog")
	wait(
		session,
		'!document.querySelector("#dialog").open && document.querySelector("#workspace").textContent.includes("Design Team")',
	)
	let workspace = String(evaluate(session, workspaceValue))
	assert(
		evaluate(
			session,
			'document.querySelector("#workspace .space-avatar")?.textContent.trim() === "DT" && document.querySelector(`alkalye-workspace-menu [data-value="personal-${(document.querySelector("#account-id")?.value ?? "")}"]`) === null',
		),
		"A space without an avatar shows its initials in the workspace menu",
	)
	browser(session, "click", '[data-action="manage-workspace"]')
	wait(
		session,
		'document.querySelector("[data-workspace=avatar-upload]") !== null',
	)
	assert(
		evaluate(
			session,
			`(() => {
				let field = document.querySelector(".space-avatar-field");
				return field.querySelector(".space-label").textContent === "Space avatar" &&
					field.querySelector('.space-avatar[data-size="md"]').textContent.trim() === "DT" &&
					field.querySelector("[data-workspace=avatar-upload]").textContent.trim() === "Upload" &&
					field.querySelector("[data-workspace=avatar-remove]") === null &&
					field.querySelector("[data-avatar-file]").accept === "image/*"
			})()`,
		),
		"Space settings offer the original's avatar upload beside the initials",
	)

	choose()
	assert(
		evaluate(
			session,
			`(() => {
				let stage = document.querySelector("[data-avatar-cropper]");
				let square = stage.querySelector(".avatar-crop-window").getBoundingClientRect();
				let image = stage.querySelector("img").getBoundingClientRect();
				return document.querySelector("#dialog-title").textContent === "Crop avatar" &&
					document.querySelector("#dialog").textContent.includes("Drag to reposition, scroll or pinch to zoom.") &&
					Math.abs(square.width - square.height) < 1 &&
					Math.abs(square.height - (stage.clientHeight - 32)) < 1 &&
					Math.abs(image.height - square.height) < 1 &&
					Math.abs(image.width - square.height * 2) < 2
			})()`,
		),
		"The cropper fits the image to a square window",
	)
	let before = Number(
		evaluate(
			session,
			'document.querySelector("[data-avatar-cropper] img").getBoundingClientRect().width',
		),
	)
	evaluate(
		session,
		'document.querySelector("[data-avatar-cropper]").dispatchEvent(new WheelEvent("wheel", {deltaY: -200, bubbles: true, cancelable: true}))',
	)
	let zoomed = Number(
		evaluate(
			session,
			'document.querySelector("[data-avatar-cropper] img").getBoundingClientRect().width',
		),
	)
	assert(zoomed > before * 1.3, "Scrolling zooms the image")
	evaluate(
		session,
		'document.querySelector("[data-avatar-cropper]").dispatchEvent(new WheelEvent("wheel", {deltaY: 2000, bubbles: true, cancelable: true}))',
	)
	drag(-2000)
	assert(
		evaluate(
			session,
			`(() => {
				let stage = document.querySelector("[data-avatar-cropper]");
				let square = stage.querySelector(".avatar-crop-window").getBoundingClientRect();
				let image = stage.querySelector("img").getBoundingClientRect();
				return Math.abs(image.right - square.right) < 1 && Math.abs(image.width - square.height * 2) < 2
			})()`,
		),
		"Zoom stops at the fitted size and dragging stops at the image's edge",
	)
	browser(session, "click", "#submit-dialog")
	wait(session, '!document.querySelector("#dialog").open')
	wait(
		session,
		`fetch("/api/library").then(response => response.json()).then(library => library.workspaces.find(space => space.workspace === ${JSON.stringify(workspace)})?.avatar?.startsWith("data:image/jpeg;base64,"))`,
	)
	wait(
		session,
		'document.querySelector(".space-avatar-field img.space-avatar") !== null',
	)
	assert(
		evaluate(
			session,
			`new Promise(resolve => {
				let image = document.querySelector(".space-avatar-field img.space-avatar");
				let probe = new Image();
				probe.onload = () => {
					let canvas = document.createElement("canvas");
					canvas.width = probe.naturalWidth;
					canvas.height = probe.naturalHeight;
					let context = canvas.getContext("2d");
					context.drawImage(probe, 0, 0);
					let pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data];
					let [red, , blue] = pixel(32, 128);
					let [red2, , blue2] = pixel(224, 128);
					resolve(probe.naturalWidth === 256 && probe.naturalHeight === 256 && blue > 180 && red < 80 && blue2 > 180 && red2 < 80);
				};
				probe.src = image.src;
			})`,
		),
		"Saving uploads a 256-pixel JPEG of the square dragged to the image's right half",
	)
	assert(
		evaluate(
			session,
			`document.querySelector("[data-workspace=avatar-upload]").textContent.trim() === "Change" && document.querySelector("[data-workspace=avatar-remove]") !== null`,
		),
		"With an avatar, the upload button reads Change and Remove appears",
	)
	wait(
		session,
		'document.querySelector("#workspace img.space-avatar")?.src.startsWith("data:image/jpeg")',
	)
	assert(
		evaluate(
			session,
			`document.querySelector('alkalye-workspace-menu [data-value="${workspace}"] img.space-avatar') !== null`,
		),
		"The workspace menu shows the avatar for the space and its entry",
	)

	browser(session, "click", "[data-workspace=avatar-remove]")
	wait(session, 'document.querySelector("#dialog").open')
	assert(
		evaluate(
			session,
			'document.querySelector("#dialog-title").textContent === "Remove avatar?" && document.querySelector("#dialog").textContent.includes("The space avatar will be removed and replaced with initials.") && document.querySelector("#submit-dialog").textContent.trim() === "Remove"',
		),
		"Removing asks with the original's confirmation",
	)
	browser(session, "click", "#submit-dialog")
	wait(
		session,
		'document.querySelector(".space-avatar-field .space-avatar")?.textContent.trim() === "DT"',
	)
	wait(
		session,
		`fetch("/api/library").then(response => response.json()).then(library => library.workspaces.find(space => space.workspace === ${JSON.stringify(workspace)})?.avatar === undefined)`,
	)
	wait(
		session,
		'document.querySelector("#workspace .space-avatar")?.textContent.trim() === "DT"',
	)
	assert(true, "Removing the avatar returns the space to its initials")
} finally {
	try {
		browser(session, "close")
	} catch {}
	server.kill("SIGTERM")
	await server.exited
}

// A 400×200 image: red on the left half, blue on the right.
function choose() {
	evaluate(
		session,
		`new Promise(resolve => {
			let canvas = document.createElement("canvas");
			canvas.width = 400;
			canvas.height = 200;
			let context = canvas.getContext("2d");
			context.fillStyle = "rgb(255, 0, 0)";
			context.fillRect(0, 0, 200, 200);
			context.fillStyle = "rgb(0, 0, 255)";
			context.fillRect(200, 0, 200, 200);
			canvas.toBlob(blob => {
				let input = document.querySelector("[data-avatar-file]");
				let files = new DataTransfer();
				files.items.add(new File([blob], "team.png", {type: "image/png"}));
				input.files = files.files;
				input.dispatchEvent(new Event("change", {bubbles: true}));
				resolve(true);
			}, "image/png");
		})`,
	)
	wait(
		session,
		'document.querySelector("[data-avatar-cropper] img")?.complete && document.querySelector("[data-avatar-cropper] img").style.width !== ""',
	)
}

function drag(dx: number) {
	evaluate(
		session,
		`(() => {
			let stage = document.querySelector("[data-avatar-cropper]");
			let bounds = stage.getBoundingClientRect();
			let x = bounds.left + bounds.width / 2, y = bounds.top + bounds.height / 2;
			let at = (type, clientX) => stage.dispatchEvent(new PointerEvent(type, {bubbles: true, pointerId: 3, isPrimary: true, clientX, clientY: y, buttons: type === "pointerup" ? 0 : 1}));
			at("pointerdown", x);
			at("pointermove", x + ${dx});
			at("pointerup", x + ${dx});
		})()`,
	)
}
