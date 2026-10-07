import { assert, browser, evaluate, wait } from "../../../tests/browser-driver"
let url = process.argv[2] ?? "http://127.0.0.1:4331"
let session = "viewport-renderer-" + Date.now()
try {
	browser(session, "set", "viewport", "1280", "800")
	browser(session, "open", url + "/?size=1048576&fixture=long&mode=bounded")
	wait(session, "Boolean(window.viewportExperiment)")
	evaluate(
		session,
		"window.expectedSource=window.viewportExperiment.value;window.viewportExperiment.options.onEdit=edit=>window.lastReplacement=edit;window.viewportExperiment.select(524288)",
	)
	browser(session, "keyboard", "inserttext", "middle")
	wait(
		session,
		"window.viewportExperiment.value===window.expectedSource.slice(0,524288)+'middle'+window.expectedSource.slice(524288)",
	)
	assert(
		evaluate(
			session,
			"window.lastReplacement.start===524288&&window.lastReplacement.end===524288&&window.lastReplacement.insert==='middle'&&window.viewportExperiment.element.value.length<=3456",
		),
		"1MiB trusted editing emits a bounded replacement without flattening native input",
	)
	evaluate(
		session,
		"window.expectedSource=window.viewportExperiment.value;window.viewportExperiment.applyExternal({start:0,end:0,insert:'remote'});window.expectedSource='remote'+window.expectedSource;true",
	)
	assert(
		evaluate(
			session,
			"window.viewportExperiment.value===window.expectedSource&&window.viewportExperiment.range.start===524300",
		),
		"External replacements preserve source and move canonical selection",
	)
	evaluate(
		session,
		"window.viewportExperiment.viewport.scrollTop=window.viewportExperiment.viewport.scrollHeight/2",
	)
	wait(session, "window.viewportExperiment.element.value.length<=3456")
	browser(session, "press", "Control+a")
	assert(
		evaluate(
			session,
			"window.viewportExperiment.range.start===0&&window.viewportExperiment.range.end===window.viewportExperiment.value.length&&window.viewportExperiment.element.value.length<=3456",
		),
		"Select-all belongs to the document while native input stays bounded",
	)
	browser(session, "press", "Control+c")
	assert(
		evaluate(
			session,
			"(()=>{let clipboardData=new DataTransfer();let event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData});window.viewportExperiment.element.dispatchEvent(event);return event.defaultPrevented&&clipboardData.getData('text/plain')===window.expectedSource})()",
		),
		"Copying a cross-window selection uses canonical source",
	)
	browser(session, "press", "Backspace")
	wait(
		session,
		"window.viewportExperiment.value===''&&window.viewportExperiment.range.start===0",
	)
	assert(
		evaluate(
			session,
			"window.lastReplacement.start===0&&window.lastReplacement.end===window.expectedSource.length&&window.lastReplacement.insert===''",
		),
		"Deleting selected source outside the viewport emits one document replacement",
	)
	evaluate(
		session,
		"window.viewportExperiment.updateSource('😀 first\\nsecond');window.viewportExperiment.select(2,8)",
	)
	browser(session, "keyboard", "inserttext", " replacement")
	wait(session, "window.viewportExperiment.value==='😀 replacement\\nsecond'")
	assert(true, "Native short Unicode selections survive source replacement")
	evaluate(
		session,
		"window.viewportExperiment.updateSource('a'.repeat(10000));window.viewportExperiment.select(0);window.viewportExperiment.viewport.scrollTop=24*60",
	)
	wait(session, "window.viewportExperiment.window.start>0")
	evaluate(
		session,
		"window.boundary=window.viewportExperiment.window.start;window.viewportExperiment.element.focus();window.viewportExperiment.element.setSelectionRange(0,1)",
	)
	wait(
		session,
		"window.viewportExperiment.range.start===window.boundary&&window.viewportExperiment.range.end===window.boundary+1",
	)
	browser(session, "press", "ArrowLeft")
	wait(
		session,
		"window.viewportExperiment.range.start===window.boundary&&window.viewportExperiment.range.end===window.boundary",
	)
	browser(session, "press", "ArrowLeft")
	assert(
		evaluate(
			session,
			"window.viewportExperiment.range.start===window.boundary-1",
		),
		"Native boundary navigation moves the canonical caret beyond the fragment",
	)
	evaluate(
		session,
		"window.viewportExperiment.updateSource('a'.repeat(10000));window.viewportExperiment.select(5000)",
	)
	browser(session, "keyboard", "inserttext", "a")
	assert(
		evaluate(
			session,
			"window.lastReplacement.start===5000&&window.lastReplacement.end===5000&&window.lastReplacement.insert==='a'",
		),
		"Repeated-character edits preserve the intended caret offset",
	)
	evaluate(
		session,
		"window.viewportExperiment.updateSource('😀'+'a'.repeat(10000));window.viewportExperiment.select(2);window.viewportExperiment.viewport.scrollTop=24*100",
	)
	wait(session, "window.viewportExperiment.window.start>2")
	browser(session, "press", "Backspace")
	wait(session, "window.viewportExperiment.value==='a'.repeat(10000)")
	assert(
		evaluate(
			session,
			"window.lastReplacement.start===0&&window.lastReplacement.end===2",
		),
		"Trusted offscreen deletion removes one complete Unicode grapheme",
	)
	evaluate(
		session,
		"window.viewportExperiment.element.readOnly=true;window.viewportExperiment.select(0,10000)",
	)
	browser(session, "press", "Backspace")
	assert(
		evaluate(session, "window.viewportExperiment.length===10000"),
		"Read-only native commands preserve canonical source",
	)
	assert(
		evaluate(
			session,
			"(()=>{let editor=window.viewportExperiment,clipboardData=new DataTransfer();clipboardData.setData('text/plain','forbidden');editor.element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));editor.element.dispatchEvent(new ClipboardEvent('cut',{bubbles:true,cancelable:true,clipboardData}));return editor.length===10000})()",
		),
		"Read-only custom clipboard paths cannot mutate source",
	)
	evaluate(
		session,
		"window.viewportExperiment.element.readOnly=false;window.viewportExperiment.select(10);window.viewportExperiment.viewport.scrollTop=24*100",
	)
	wait(session, "window.viewportExperiment.window.start>10")
	assert(
		evaluate(
			session,
			"(()=>{let editor=window.viewportExperiment;editor.element.dispatchEvent(new CompositionEvent('compositionstart'));let included=editor.window.start<=10&&editor.window.end>=10;editor.element.dispatchEvent(new CompositionEvent('compositionend'));return included})()",
		),
		"Composition preparation restores an offscreen canonical caret before freezing the window",
	)
} finally {
	browser(session, "close")
}
