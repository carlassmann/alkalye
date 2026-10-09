# Second-key synchronous change diagnostic

Frozen production b5577ba899b46ef5900b21328535409a6c5fe99c. One marked arm, one 1MiB ASCII eight-key native paced run; attribution, not comparative timing or 120fps. Exact source/native caret, independent immutable prime/final/Undo action receipts and reload passed. Owned resources closed. Unmarked executable graph and maps51/51 match current production dist; fetched marked chunk matches retained source-map/sourceContent pins.

Reconstruct marked source from Git b557 plus existing-metadata-and-compact-markers.patch.txt and second-key-markers.patch.txt. No algorithm changes. Marked editorSHA10d23185149169cb958c2023cfb1c5c6ed4024ee8b6b6e3d1e521d24741a57aa.

Second key enclosing RunTask17.787ms; text.input3.106ms; options.change INCLUDING argument takeReplacements9.446ms; editor.update/text.sync0.557ms. Other keys change0.358–1.751ms. No GC nested in second-key marked callback; certified metadata succeeds1.558ms nested within text.input. oninput13.157ms inclusive maps to editor.ts264, exact fetched chunk/source map and markedsource bytes. Remaining unmarked task work not assigned to these phases. Phase intervals include nested work, not self-profile attribution. No retained allocation owner claim.

This locates the stall inside synchronous replacement preparation/application or takeReplacements, not projection/update. It does not distinguish these subcallees. Next smallest diagnostic splits takeReplacements, prepareReplacements and submitEdit/application; no algorithm should be selected from unproved callee causes.

Prime acceptance reconstructed from immutable history after timing; no heavy independent source read during timing. Full rawtrace external with hash/size in phase-attribution. Privateprofiles/data/credentials excluded. Initial parser incorrectly expected status complete rather than producer measured-complete; failure and corrected producer retained, no native rerun. Graph output accidentally used repositorycwd initially; moved byte-exact outside and fixed outputpath, production source untouched.

written with gpt-6 in codex
