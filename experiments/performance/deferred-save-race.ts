import assert from "node:assert/strict"

let [origin, accountPath] = process.argv.slice(2)
if (!origin || !accountPath)
	throw new Error(
		"Usage: bun experiments/performance/deferred-save-race.ts <dev origin> <disposable account JSON>",
	)
let account: { credentials: unknown; docs: { kb: number; id: string }[] } =
	await Bun.file(accountPath).json()
let session = `deferred-save-race-${process.pid}`

try {
	await browser("open", `${origin}/en/`)
	await evaluate(
		`localStorage.setItem('jazz-logged-in-secret',${JSON.stringify(JSON.stringify(account.credentials))});true`,
	)
	let existing = account.docs[0]
	if (!existing)
		throw new Error("Disposable account needs an existing document")
	await openDocument(existing.id)
	let id = await evaluate(`(async()=>{
		let {UserAccount}=await import('/src/schema/index.ts');
		let {createPersonalDocument}=await import('/src/app/features/documents/lib/documents.ts');
		return (await createPersonalDocument(UserAccount.getMe(),'Start')).$jazz.id
	})()`)
	if (typeof id !== "string") throw new Error("Document was not created")
	await openDocument(id)
	await evaluate(`(async()=>{
		let {Document}=await import('/src/schema/index.ts');
		window.raceDoc=await Document.load(${JSON.stringify(id)},{resolve:{content:true}});
		let view=document.querySelector('.cm-content').cmTile.view;
		view.dispatch({selection:{anchor:0}});view.focus();return true
	})()`)
	await browser("press", "x")
	await evaluate(`{
		window.raceLog=[];
		let content=window.raceDoc.content;
		content.insertBefore(0,'Remote ');
		let done=false;
		window.stopRace=content.$jazz.subscribe(snapshot=>{
			if(done||!snapshot.toString().includes('xStart'))return;
			done=true;
			queueMicrotask(()=>{
				let view=document.querySelector('.cm-content').cmTile.view;
				window.raceLog.push({jazz:snapshot.toString(),editor:view.state.doc.toString()});
				view.dispatch({changes:{from:0,insert:'y'},selection:{anchor:1}})
			})
		})
	};true`)
	await browser("wait", "--fn", "window.raceLog.length===1")
	await Bun.sleep(1500)
	assert.deepEqual(
		await evaluate(`({log:window.raceLog,
			editor:document.querySelector('.cm-content').cmTile.view.state.doc.toString(),
			jazz:window.raceDoc.content.toString()})`),
		{
			log: [{ editor: "xStart", jazz: "Remote xStart" }],
			editor: "Remote yxStart",
			jazz: "Remote yxStart",
		},
	)
	console.log("Remote text survives input before the deferred editor refresh")
} finally {
	await browser("close")
}

async function openDocument(id: string) {
	await browser("open", `${origin}/app/doc/${id}/`)
	await browser("wait", "--fn", "window.__alkalyeReady===true")
}

function evaluate(code: string) {
	return browser("eval", `(0,eval)(${JSON.stringify(code)})`)
}

async function browser(...args: string[]): Promise<unknown> {
	let child = Bun.spawn(
		[
			"agent-browser",
			"--session",
			session,
			"--headed",
			"false",
			"--json",
			...args,
		],
		{
			env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "30000" },
			stdout: "pipe",
			stderr: "pipe",
		},
	)
	let timer = setTimeout(() => child.kill(), 45_000)
	try {
		let [output, error, exit] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		])
		if (exit !== 0) throw new Error(`agent-browser ${args[0]}: ${error}`)
		let response: { success: boolean; data: { result?: unknown } } =
			JSON.parse(output)
		if (!response.success) throw new Error(`agent-browser ${args[0]} failed`)
		return response.data.result ?? response.data
	} finally {
		clearTimeout(timer)
	}
}
