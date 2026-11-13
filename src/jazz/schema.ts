import { schema as s } from "jazz-tools"

export let app = s.defineApp(
	{
		documents: s.table(
			{
				ownerId: s.uuid(),
				title: s.string(),
				content: s.string().merge("markdown"),
			},
			{},
		),
	},
	{ migrations: "none" },
)
