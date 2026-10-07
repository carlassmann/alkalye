import {
	assert,
	browser,
	browserBatch,
	evaluate,
	wait,
} from "../../tests/browser-driver"
let [session, profile, url, out, device, expected, sampling] = Bun.argv.slice(2)
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
let source = 'document.querySelector("alkalye-editor").source'
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
		`${source}?.value.length${expected ? "===" + Number(expected) : ">30000"}&&!document.querySelector('#editor').readOnly&&document.querySelector('#save-status').textContent==='Saved'`,
	)
	evaluate(
		session,
		`(()=>{let app=document.querySelector('#app');if(app.classList.contains('library-open'))document.querySelector('[data-action=library]').click();if(app.classList.contains('tools-open'))document.querySelector('[data-action=toggle-tools]').click();window.scrollOriginal=${source}.value;return true})()`,
	)
	for (let trial = 0; trial < (sampling === "cpu" ? 1 : 3); trial++) {
		let ready = evaluate(
			session,
			`(()=>{let viewport=${source}.viewport.scrollElement;${source}.setSelectionRange(0,0);viewport.scrollTop=${trial === 0 ? "0" : trial === 1 ? "Math.floor((viewport.scrollHeight-viewport.clientHeight)/2)" : "Math.max(0,viewport.scrollHeight-viewport.clientHeight-8000)"};return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({top:viewport.scrollTop,height:viewport.scrollHeight,sourceCharacters:${source}.value.length,nativeCharacters:document.querySelector('#editor').value.length,nodes:document.querySelector('#highlight').querySelectorAll('*').length,coarse:matchMedia('(pointer:coarse)').matches}))))})()`,
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
			`(()=>{let host=${source}.viewport.scrollElement,controller=new AbortController(),state=window.scrollProbe={start:performance.now(),frames:[],scrolls:0,wheels:0,trusted:0,wheelEvents:[],lastTop:host.scrollTop,controller,raf:0};let previous=0;document.addEventListener('wheel',event=>{state.wheels++;if(event.isTrusted)state.trusted++;let sample={at:performance.now()-state.start,target:event.target?.id,deltaY:event.deltaY,deltaMode:event.deltaMode,top:host.scrollTop,prevented:event.defaultPrevented};state.wheelEvents.push(sample);queueMicrotask(()=>sample.prevented=event.defaultPrevented)},{capture:true,passive:true,signal:controller.signal});host.addEventListener('scroll',()=>state.scrolls++,{passive:true,signal:controller.signal});function frame(time){if(previous)state.frames.push(time-previous);previous=time;state.raf=requestAnimationFrame(frame)}state.raf=requestAnimationFrame(frame);performance.mark('critical:scroll:start');return true})()`,
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
			`(()=>{let host=${source}.viewport.scrollElement,state=window.scrollProbe,started=performance.now(),previous=host.scrollTop,stable=0;return new Promise(resolve=>{function settled(){let now=host.scrollTop;if(now===previous)stable++;else stable=0;previous=now;if(stable>=4||performance.now()-started>2000){state.controller.abort();cancelAnimationFrame(state.raf);performance.mark('critical:scroll:end');resolve({duration:performance.now()-state.start,frames:state.frames,wheelEvents:state.wheelEvents,scrolls:state.scrolls,wheels:state.wheels,trusted:state.trusted,settled:stable>=4,top:host.scrollTop,sourceExact:${source}.value===window.scrollOriginal,nativeCharacters:document.querySelector('#editor').value.length,nodes:document.querySelector('#highlight').querySelectorAll('*').length});return}requestAnimationFrame(settled)}requestAnimationFrame(settled)})})()`,
		)
		assert(
			evaluate(
				session,
				`${source}.value===window.scrollOriginal&&window.scrollProbe.trusted===8&&window.scrollProbe.wheels===8`,
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
