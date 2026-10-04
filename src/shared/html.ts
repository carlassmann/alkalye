import { escape } from "./markdown"

export class Markup {
	constructor(public readonly value: string) {}
	toString() {
		return this.value
	}
}
export function rawMarkup(value: string | Markup) {
	return value instanceof Markup ? value : new Markup(value)
}
export function html(parts: readonly string[], ...values: unknown[]) {
	return new Markup(
		parts
			.map((part, index) => {
				let value = values[index]
				return (
					part +
					(index < values.length
						? value instanceof Markup
							? value.value
							: escape(String(value ?? ""))
						: "")
				)
			})
			.join(""),
	)
}

export function joinMarkup(values: Markup[], separator = "") {
	return new Markup(values.map(value => value.value).join(separator))
}
