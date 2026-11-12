# Syntwin integration

Alkalye loads Omny on its English and German website and outside the app router. Website and app use the same origin so a conversation continues when the visitor opens `/app`. Help reopens the existing conversation.

The default public room is https://my.syntwin.ai/app/d/j974c6r0d9xj7d19cmfzzt9qw98hg52b. `PUBLIC_SYNTWIN_ROOM_ID` can select another room. Set `PUBLIC_SYNTWIN_ENABLED=false` or an explicitly empty room ID to hide the integration, including Help. These settings are public build-time configuration. No Syntwin secret belongs here.

## Room and shared knowledge

The Alkalye room was created through managed Syntwin MCP on 3 November 2026 in Carl's existing workspace. It matches Tilly's display name, avatar, video replica, English/German languages, chat/audio/video modes, sign-in gates and email notifications. Alkalye has its own instructions, greeting guidance and GitHub issue CTA. Both rooms may answer questions about Carl's other projects.

The existing owner-level source `k572zx73xz8k28tjjjygrrkhpx8e6va9` contains the product guide and Carl's origin story. No duplicate source was created. Both rooms have identical explicit source access and tag rules, verified by read-back. Future sources tagged Alkalye or either existing Tilly tag receive mention access in both rooms. Untagged sources remain unavailable by default. Restricted hiring and interview sources remain unavailable. Browser inspection found no connected providers in either room; a future provider connection needs its own access review.

The cbook browser run configured these websites for Alkalye:

- `www.alkalye.com`
- `alkalye.com`
- `web-t3-add-syntwin-website-guide-alkalye.cshed.carlassmann.com`

Page access is Click and type with Ask visitors first. The Compact launcher says Carl and Ask me about Alkalye, uses Teal, and sits on the right. The room's operator privacy notice is https://www.alkalye.com/privacy. Tilly keeps its own notice, and the organization notice was not changed. `/app/settings` and all paths below it are on Alkalye's Pages Omny never sees list.

## Privacy

The script loads from https://my.syntwin.ai/omny.js. Alkalye supplies only a general website/app context, without account IDs, document text or credentials. Reading or acting on the page requires the visitor's separate permission. Authentication forms and displayed recovery phrases carry `data-syntwin-hidden`. Syntwin has no direct Jazz or MCP access through this integration and needs internet even when Alkalye works offline.

Use fictional documents for testing. Never clear site storage to reset the chat, because that can erase anonymous documents.

## Runtime verification

The cbook run verified desktop chat on `/en/`, history continuing into `/app/doc` and `/app/settings`, and Help reopening that history. Denial prevented actions. Allow permitted a page scroll; revocation prevented a subsequent scroll. It checked hidden markers on the sign-in form and recovery textarea. At 390 by 844, the website panel opened as a sheet and app Help reopened it. The settings privacy checker reported Sees nothing for `/app/settings/account` after saving and reloading the room settings.

The follow-up on cshed verified German chat labels and a German answer about Carl's origin story, including permission to ask about Tilly. The provider privacy link returned 404 because Omny uses a relative URL. Alkalye now redirects `/legal/privacy` and `/de/legal/privacy` to Syntwin's corresponding policy pages.

## Landing page demo

The landing page's scroll demo renders the app's editor and toolbar, comments, tldraw canvas, time machine, slideshow and teleprompter with a scripted document. Only the stage is visible. Each scene's heading and explanation are visually hidden (`sr-only`) static HTML, so screen readers, search engines and page reading get the story without the demo. Omny's reader filters with `checkVisibility()`, which keeps `sr-only` text; this was not rechecked against a live room. Checked against Omny's text reader on 4 November 2026: it skips `contenteditable` and `role="textbox"`, so the demo editor's text is invisible to Syntwin. Comment, time machine, slide, teleprompter and whiteboard label text is readable. The reader also returns the text of inline `<style>` elements, so the slideshow scene includes theme CSS noise. Don't claim Syntwin can inspect drawings beyond their text labels.

The phone in the demo is an iframe of `/demo/phone` (noindex, no Syntwin script) at real iPhone size, so the app's mobile editor and teleprompter render there; the landing page drives it with `postMessage`. Page reading does not reach into that frame.

The twin moves through the demo with Omny's `scrollTo` page tool on a scene's heading; `find` returns the scene's list item. `highlight` also scrolls, but the sticky stage covers the items, so it reports "not marked" and draws no ring. Each item is sized so the scene's middle lands at the focus line both when its target is centered (desktop) and when it is aligned above the phone's chat sheet. The demo itself only reads scroll position.

## Known Omny limitations

- Test conversations on 5 November 2026: on the German page the widget UI is German, but the conversation language shows EN and the twin answers German messages in English. The room has no default-language setting through MCP.

- The configured launcher prompt is one string across languages. The chat UI and replies follow English/German; room instructions contain both greeting variants.
- With `data-launcher="none"`, an active conversation can still show a Continue the chat card after minimizing. Hiding it did not work in the cbook run.
- A first action immediately after Allow needed a second request during the cbook test. Later actions worked, and revocation blocked them.
- On phone, minimizing appeared to leave the sheet tall. This needs an Omny fix and another runtime check.
- Settings-page privacy was confirmed through the room checker; the cbook run did not inspect an actual page-tool snapshot of Settings. Credential markers were checked in the app DOM.

written with gpt-6.1-sol in Codex
