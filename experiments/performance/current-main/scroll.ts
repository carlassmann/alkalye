import {
	assert,
	browser,
	browserBatch,
	evaluate,
	wait,
} from "../../../tests/browser-driver"
let [session, profile, url, out, device, expected, sampling, kind] =
	Bun.argv.slice(2)
if (
	!session ||
	!profile ||
	!url ||
	!out ||
	!expected ||
	!Number.isSafeInteger(Number(expected))
)
	throw Error(
		"session profile url output [desktop|coarse] expectedCharacters required",
	)
let original = kind === "original"
if (kind && kind !== "original" && kind !== "rewrite")
	throw Error("Expected original or rewrite")
let source = 'document.querySelector("alkalye-editor").source'
let content = original
	? "document.querySelector('.cm-content')?.cmTile?.view?.state.doc.toString()"
	: source + ".value"
let host = original
	? "document.querySelector('.cm-scroller')"
	: source + ".viewport.scrollElement"
let nativeCharacters = original
	? "document.querySelector('.cm-content').textContent.length"
	: "document.querySelector('#editor').value.length"
let nodes = original
	? "document.querySelector('.cm-content').querySelectorAll('*').length"
	: "document.querySelector('#highlight').querySelectorAll('*').length"
let selection = original
	? "(()=>{let view=document.querySelector('.cm-content').cmTile.view;view.dispatch({selection:{anchor:0}})})()"
	: source + ".setSelectionRange(0,0)"
let editable = original
	? "document.querySelector('.cm-content')?.getAttribute('contenteditable')==='true'"
	: "!document.querySelector('#editor').readOnly&&document.querySelector('#save-status').textContent==='Saved'"
let samples = Number(Bun.env.BENCHMARK_SCROLL_SAMPLES ?? "3")
if (!Number.isInteger(samples) || samples < 1 || samples > 5)
	throw Error("Scroll samples must be 1–5")
let rows = []
try {
	browser(
		session,
		"--profile",
		profile,
		...(device === "coarse"
			? [
					"--args",
					"--touch-events=enabled,--blink-settings=primaryPointerType=2",
				]
			: []),
		"open",
		"about:blank",
	)
	if (device === "coarse") browser(session, "set", "device", "iPhone 15")
	else browser(session, "set", "viewport", "1280", "800")
	browser(session, "open", url)
	wait(
		session,
		`(${content})?.length${Number(expected) > 0 ? "===" + Number(expected) : ">30000"}&&(${editable})`,
	)
	evaluate(
		session,
		`(()=>{${original ? `for(let label of ['Documents','Close documents','Document tools','Close document tools']){let button=document.querySelector('button[aria-label=\"'+label+'\"]');if(button?.getAttribute('aria-expanded')==='true')button.click()}` : `let app=document.querySelector('#app');if(app.classList.contains('library-open'))document.querySelector('[data-action=library]').click();if(app.classList.contains('tools-open'))document.querySelector('[data-action=toggle-tools]').click();`}window.scrollOriginal=(${content});return true})()`,
	)
	for (let trial = 0; trial < (sampling === "cpu" ? 1 : samples); trial++) {
		let ready = evaluate(
			session,
			`(()=>{let viewport=${host};${selection};viewport.scrollTop=${trial === 0 ? "0" : trial === 1 ? "Math.floor((viewport.scrollHeight-viewport.clientHeight)/2)" : "Math.max(0,viewport.scrollHeight-viewport.clientHeight-8000)"};return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({top:viewport.scrollTop,height:viewport.scrollHeight,sourceCharacters:(${content}).length,nativeCharacters:${nativeCharacters},nodes:${nodes},coarse:matchMedia('(pointer:coarse)').matches}))))})()`,
		)
		browser(
			session,
			"profiler",
			"start",
			"--categories",
			"devtools.timeline,disabled-by-default-devtools.timeline,toplevel,blink.user_timing,v8" +
				(sampling === "cpu"
					? ",disabled-by-default-v8.cpu_profiler,disabled-by-default-v8.cpu_profiler.hires"
					: ""),
		)
		evaluate(
			session,
			`(()=>{let host=${host},controller=new AbortController(),state=window.scrollProbe={start:performance.now(),frames:[],scrolls:0,wheels:0,trusted:0,wheelEvents:[],lastTop:host.scrollTop,controller,raf:0};let previous=0;document.addEventListener('wheel',event=>{state.wheels++;if(event.isTrusted)state.trusted++;let sample={at:performance.now()-state.start,target:event.target?.id,deltaY:event.deltaY,deltaMode:event.deltaMode,top:host.scrollTop,prevented:event.defaultPrevented};state.wheelEvents.push(sample);queueMicrotask(()=>sample.prevented=event.defaultPrevented)},{capture:true,passive:true,signal:controller.signal});host.addEventListener('scroll',()=>state.scrolls++,{passive:true,signal:controller.signal});function frame(time){if(previous)state.frames.push(time-previous);previous=time;state.raf=requestAnimationFrame(frame)}state.raf=requestAnimationFrame(frame);performance.mark('critical:scroll:start');return true})()`,
		)
		browser(
			session,
			"mouse",
			"move",
			device === "coarse" ? "190" : "640",
			"350",
		)
		browserBatch(
			session,
			Array.from({ length: 8 }, () => ["mouse", "wheel", "600"]),
		)
		let observation = evaluate(
			session,
			`(()=>{let host=${host},state=window.scrollProbe,started=performance.now(),previous=host.scrollTop,stable=0;return new Promise(resolve=>{function settled(){let now=host.scrollTop;if(now===previous)stable++;else stable=0;previous=now;if(stable>=4||performance.now()-started>2000){state.controller.abort();cancelAnimationFrame(state.raf);performance.mark('critical:scroll:end');resolve({duration:performance.now()-state.start,frames:state.frames,wheelEvents:state.wheelEvents,scrolls:state.scrolls,wheels:state.wheels,trusted:state.trusted,settled:stable>=4,top:host.scrollTop,sourceExact:(${content})===window.scrollOriginal,nativeCharacters:${nativeCharacters},nodes:${nodes}});return}requestAnimationFrame(settled)}requestAnimationFrame(settled)})})()`,
		)
		assert(
			evaluate(
				session,
				`(${content})===window.scrollOriginal&&window.scrollProbe.trusted===8&&window.scrollProbe.wheels===8`,
			),
			"Trusted wheel events preserve the exact document",
		)
		let trace = out.replace(/\.json$/, "") + "-" + trial + ".trace.json"
		browser(session, "profiler", "stop", trace)
		rows.push({ trial, ready, observation, trace })
		await Bun.write(out, JSON.stringify(rows, null, 2))
	}
} finally {
	browser(session, "close")
}
