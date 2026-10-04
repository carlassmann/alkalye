import { element } from "../dom"
export function toast(text: string) {
	let host = element("#toast")
	host.textContent = text
	host.classList.add("visible")
	setTimeout(() => host.classList.remove("visible"), 4000)
}
