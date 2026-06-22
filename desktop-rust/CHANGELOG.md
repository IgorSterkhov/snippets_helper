# Changelog

## Unreleased

## f-20260622-1 (2026-06-22)

- **Finance calendar date column:** monthly Finance calendar rows now show a
  narrow `Date` column after the expense name, so the planned day of month is
  visible while marking payment facts.

## v1.19.0 (2026-06-21)

- **Finance payment calendar:** monthly Finance lists now have a `Calendar`
  view next to `Structure`. The calendar reuses the expense hierarchy, lets
  terminal rows track paid state and actual amount per month, aggregates paid
  descendant totals on group rows, supports adding month columns and hiding old
  months, and syncs payment facts through the API using deterministic
  item/month identities.

## v1.18.4 (2026-06-21)

- **ClickHouse docs source coverage:** `Update docs` now discovers the
  official ClickHouse `sql-reference/functions` catalog through GitHub contents
  metadata instead of refreshing only the small built-in source list. Searches
  such as `dictGet` and `mortonEncode` are indexed after updating docs, and the
  offline fallback now includes dictionary and encoding function pages.

## v1.18.3 (2026-06-21)

- **ClickHouse lightweight section loading:** opening a ClickHouse page now
  loads only section metadata and short excerpts. The full Markdown body is
  fetched only for the selected section, preventing large documentation pages
  from blocking sidebar clicks, the status bar, or module switching.

## v1.18.2 (2026-06-21)

- **ClickHouse loading hang fix:** ClickHouse documentation index loading now
  uses async IPC commands and shows a slow-load fallback instead of leaving the
  module on an unresponsive `Loading...` screen when the local SQLite cache is
  slow or temporarily locked.

## v1.18.1 (2026-06-21)

- **ClickHouse startup freeze fix:** opening the app with ClickHouse as the
  last active module no longer auto-loads the first large documentation page.
  The module now loads only the navigation tree on startup and fetches a page
  after the user selects it, keeping the window responsive after update.

## v1.18.0 (2026-06-20)

- **ClickHouse section-first navigation:** ClickHouse pages now open as a
  lightweight section index, and the active page expands in the left navigation
  with its parsed functions/sections. Selecting a section renders only that
  block, so large function pages no longer need to render in full during normal
  browsing.
- **ClickHouse background update progress:** `Update docs` now reports native
  fetch/apply progress in a dedicated status bar with percentage, remaining
  source pages, elapsed time, final summary, last update time, and page/section
  counts. The update continues while switching modules, and returning to
  ClickHouse restores the current progress snapshot.

## f-20260620-3 (2026-06-20)

- **ClickHouse Docs update freeze fix:** ClickHouse markdown rendering now
  strips Docusaurus code-fence metadata before handing content to the Markdown
  renderer, preventing the UI from freezing on official docs blocks such as
  `sql title=Query`. After `Update docs`, the module now shows a lightweight
  update summary instead of immediately rendering a large article.

## v1.17.0 (2026-06-20)

- **ClickHouse Docs module:** added a DEV sidebar module with the native
  ClickHouse icon, local SQLite-backed official documentation cache,
  section/function-level search, manual `Update docs`, and an update changelog
  for added, changed, removed, or failed documentation sources.

## v1.16.0 (2026-06-20)

- **VPS SSH config import:** VPS settings now accept Windows and
  Windows-readable WSL SSH config file paths. The new toolbar import action
  adds concrete `Host` aliases as normal VPS servers, skips existing server
  names on repeat imports, and reports imported/skipped/ignored/failed counts.

## v1.15.0 (2026-06-20)

- **Frontend OTA cache prevention:** frontend assets served through `khapp://`
  now use no-cache headers so macOS WebView reloads pick up the newly applied
  hot-update bundle. Settings > Updates also has a manual `Clear frontend cache
  & reload` recovery action for stale WebView cache cases.

## f-20260620-2 (2026-06-20)

- **Repo Search history metadata:** the expanded file History diff header now
  shows the selected commit date/time and author next to the hash and message.

## v1.14.0 (2026-06-20)

- **Repo Search expanded history:** expanded content results now keep syntax
  highlighting and search-line markers together, and the expanded file header
  has a History mode that lists commits for the current file and previews
  highlighted per-file diffs.

## f-20260620-1 (2026-06-20)

- **Repo Search expanded file find:** expanded content results now preserve
  matched-line highlighting, include local in-file search with next/previous
  navigation, and expose Open in editor plus Copy path directly in the expanded
  header.

## f-20260619-2 (2026-06-19)

- **Repo Search header settings/help:** Repo Search now has standard module
  header Help and Settings buttons, and repository settings open in a
  scrollable modal instead of an inline Search-panel drawer.

## f-20260619-1 (2026-06-19)

- **Snippet editor drafts:** the Snippets editor now autosaves a local draft
  while typing, asks before discarding unsaved changes on Escape or Cancel, and
  offers to restore the draft the next time New/Edit is opened.

## f-20260614-2 (2026-06-14)

- **Finance collapse color fix:** desktop Finance level backgrounds now use the
  full expense tree depth instead of only visible rows, so collapsing all
  children no longer makes top-level rows lose their color bands.

## f-20260614-1 (2026-06-14)

- **Finance row editing fixes:** saving an amount in a long Finance list now
  preserves the row list scroll position and active amount field, and
  keyboard-created placeholder row names are selected after Tab indent so
  typing replaces `Untitled item`.

## f-20260612-1 (2026-06-12)

- **Image viewer zoom/pan:** Figure Card image viewer in Snippets and Notes
  now supports `Ctrl + mouse wheel` zooming around the cursor and drag-to-pan
  inside the modal, while Fit and Actual size reset the view predictably.

## v1.13.0 (2026-06-12)

- **Snippet image viewer:** Figure Card images in Snippets and Notes now open
  a dedicated viewer with Fit and Actual size modes, using the same native
  media fallback that keeps server images visible in the desktop WebView.
- **Markdown quote toggle:** the existing `>` toolbar action now toggles
  blockquotes for selected lines in snippet value/description editors and note
  content, instead of only adding another quote prefix.
- **Code snippet micro picker:** new global `Ctrl+Alt+K` hotkey opens a compact
  always-on-top picker for snippets whose names start with `code_`, with token
  search, preview, Enter insert on Windows, and copy-only fallback when external
  focus restore is unavailable.
- **Smoke-test stability:** desktop CDP smoke tests now choose free ports when
  defaults are busy and wait for Chrome/http-server shutdown before removing
  temporary browser profiles.

## f-20260611-8 (2026-06-11)

- **Finance header polish:** Finance list name, currency, and list type now
  autosave like Tasks instead of requiring a separate Save button. The header
  was tightened into a cleaner control bar with a subtle save status, and
  finance rows were made more compact for denser expense lists.

## f-20260611-7 (2026-06-11)

- **Finance color tint hotfix:** Finance level colors now render as generated
  dark-theme HSL tints that preserve the selected hue. Bright choices such as
  pink stay visually pink instead of turning into a purple/dark overlay from
  alpha blending with the app background.

## f-20260611-6 (2026-06-11)

- **Finance Soft First mapping:** adjusted Finance display settings so Soft
  First assigns level colors from the bottom up: two visible levels use
  `Soft / neutral`, three use `Medium / Soft / neutral`, and four or more use
  `Strong / Medium / Soft / neutral`.

## f-20260611-5 (2026-06-11)

- **Finance level colors hotfix:** changing Finance display colors now
  reapplies the active settings during each Finance redraw, including when
  switching between existing expense lists. Editable row fields no longer draw
  opaque blocks over the row background, so hierarchy level fills cover the
  full row.

## f-20260611-4 (2026-06-11)

- **Finance level color hotfix:** fixed Finance hierarchy level backgrounds
  not rendering in the desktop WebView. Level band colors now use explicit
  translucent fills from the selected settings, and the Finance smoke test now
  verifies the computed row background instead of only checking CSS classes.

## f-20260611-3 (2026-06-11)

- **Finance report styling:** Finance rows now use one row type visually. Rows
  with children become subtotal rows automatically, while soft background bands
  are assigned by visible hierarchy level so a group and a terminal row at the
  same depth share the same fill treatment. The Finance header now has display
  settings for level colors and strong-first or soft-first fill order, and the
  separate `+ Group` action was removed.

## v1.12.0 (2026-06-11)

- **Finance live sync/share:** Finance lists and nested expense rows now sync
  through the API with UUID-based plan and parent relationships. Finance lists
  can be shared through live public links that render the current server copy
  as a read-only hierarchical expense table.
- **Finance keyboard editing:** row names now support task-like keyboard
  editing: Enter creates the next same-level row, Tab/Shift+Tab changes
  nesting, and ArrowUp/ArrowDown move between visible rows at text boundaries.

## f-20260611-2 (2026-06-11)

- **Notes folder row actions:** folder rows no longer reserve a wide inline
  action-button area. Add sub-folder, Rename, and Delete moved to a right-click
  context menu, leaving more room for folder names.
- **DEV sidebar group:** SQL, Superset, Commits, and Search are grouped under a
  compact DEV button in the main sidebar. The group expands on click or when a
  grouped module is active, including Ctrl+Tab/programmatic activation, and
  collapses again after switching to another module.

## f-20260611-1 (2026-06-11)

- **Notes folder pane resize hotfix:** fixed folder-pane resize jitter where
  live drag widths could be treated as invalid and snap back to the previous
  width instead of staying at the dragged position.

## f-20260610-1 (2026-06-10)

- **Notes folder pane resize:** the Notes folder tree panel can now be resized
  by dragging the divider between folders and notes. The width is persisted on
  the current desktop installation, double-clicking the divider resets it to
  the default, and folder rows no longer show nested-folder count badges.

## v1.11.0 (2026-06-10)

- **Finance list types and dates:** Finance lists now support `Monthly`,
  `Project`, `One-time`, and `General` types instead of assuming every list is
  monthly. The summary label is now neutral (`Total`), rows have a Date column,
  monthly lists edit day-of-month values, and other list types edit full dates.

## v1.10.0 (2026-06-10)

- **Finance module:** added a dedicated desktop Finance tab for monthly
  planning. It starts with a `Regular monthly` plan, supports multiple plan
  cards, nested expense rows, direct amount and aggregate total columns,
  notes, soft-delete, and drag-and-drop for both plans and nested rows. Finance
  data is desktop-local in this first release and is not yet synced to API or
  mobile.

## v1.9.3 (2026-06-10)

- **Notes folder tree DnD:** the Notes left-panel folder tree now has stable
  file-explorer-style rows that do not shift on hover. Folders can be dragged
  by the left grip to reorder siblings or dropped onto another folder to make
  them children; collapsed targets expand after an inside drop, and the backend
  commits each move atomically with cycle protection.

## v1.9.2 (2026-06-10)

- **SQL Formatter readability:** `Format SQL` now expands `SELECT` lists one
  expression per line and splits `WHERE` / `PREWHERE` / `HAVING` conditions
  across top-level `AND` / `OR` operators. Formatter splitting and keyword
  casing now skip string literals and comments, so text like `'from x and y'`
  remains unchanged.

## v1.9.1 (2026-06-09)

- **Telegra.ph diagnostics:** publishing failures now open a persistent dialog
  with copyable diagnostics instead of a short toast. The desktop waits long
  enough to receive the API error, while the server fails fast with a clear
  message if outbound access to Telegra.ph is blocked. `TELEGRAPH_API_BASE_URL`
  can be set on the API server when publishing must go through a proxy endpoint.

## v1.9.0 (2026-06-09)

- **Telegra.ph publishing:** Share dialogs for Notes and Snippets can publish
  Telegram-friendly snapshot pages to Telegra.ph, then copy/open or update the
  page. The API creates a per-user Telegra.ph account automatically, keeps the
  access token server-side, and converts Markdown/HTML Cards to safe Telegra.ph
  content.
- **HTML Card iframe fix:** the production HTML media endpoint no longer sends
  `X-Frame-Options: DENY`, so sandboxed HTML Cards can render inside desktop
  previews and public share pages.

## v1.8.0 (2026-06-09)

- **Sandbox HTML Cards:** Notes and Snippets can upload single-file UTF-8 HTML
  artifacts from the Markdown toolbar and insert them as portable HTML Card
  tokens. Desktop previews and public share pages render them in sandboxed
  iframes, while the API stores the files under existing media quotas and
  serves them with restrictive CSP headers.

## f-20260608-2 (2026-06-08)

- **Ctrl+Tab in Tasks Focus view:** selecting several tasks from the Focus
  view left pane now updates the shared recent-view history, so Ctrl+Tab
  returns to the previous task instead of jumping back to an older module.

## f-20260608-1 (2026-06-08)

- **Ctrl+Tab recent view switching:** Ctrl+Tab now returns to the previous
  recent view, including exact snippets, tasks, and notes. Repeated Ctrl+Tab
  in the same sequence shows a compact dark switcher overlay and cycles through
  the frozen recent-view snapshot; Ctrl+Shift+Tab cycles backward.

## f-20260607-1 (2026-06-07)

- **Snippets navigation and panels:** Related snippet navigation now has
  Back, History, and Forward controls with a 10-item branch popover. Snippet
  search can switch between name-only and full content scope, uses literal
  token matching for space-separated words, and tag/pinned panels can be shown
  independently with draggable tag and pinned chips.

## v1.7.1 (2026-06-07)

- **Whisper Yandex batch setup:** when Yandex SpeechKit is selected with
  Live dictate off and Folder ID is empty, the Whisper header now shows an
  inline warning and Record/hotkey errors explain that Folder ID is required
  for batch recognition or Live dictate can be enabled for streaming.

## v1.7.0 (2026-06-04)

- **Repo Search git code search:** Git history search now looks through changed
  patch lines, not only commit messages, so code-only changes are discoverable
  even when the commit message does not contain the query.
- **Repo Search group scope:** selecting a repository group now visibly updates
  the active tab and the scope badge, and search calls are limited to active
  repositories inside that group instead of leaking to all selected repos.
- **Repo Search ordering:** group tabs and repository chips can be reordered by
  drag-and-drop with persistent order. Repository chips still support dragging
  onto a group tab to move the repository between groups.

## v1.6.0 (2026-06-03)

- **Whisper recognition engine selector:** the Whisper header now separates
  Recognition engine from Live dictate mode. Local Whisper models, Deepgram,
  and Yandex SpeechKit are selected in one engine dropdown; Live dictate is
  enabled only for cloud engines.
- **Cloud batch transcription:** Deepgram and Yandex SpeechKit can now be used
  with Live dictate off. The desktop records local WAV audio, sends it directly
  to the selected provider after Stop, then runs the existing cleanup,
  insertion, and history persistence pipeline with provider/model metadata.
- **Yandex batch setup:** Settings > Whisper now exposes the required Yandex
  Folder ID for async file recognition, validates it before recording, and
  reads normalized multi-part SpeechKit results when available.

## f-20260603-1 (2026-06-03)

- **Tasks checkbox arrow navigation:** Inline checkbox editing now keeps native
  multi-line text movement, but ArrowUp at the start of a checkbox moves focus
  to the previous visible checkbox and ArrowDown at the end moves focus to the
  next visible checkbox. Hidden completed items and collapsed descendants are
  skipped because navigation follows the rendered visible rows.

## v1.5.2 (2026-06-02)

- **Yandex SpeechKit settings:** Settings > Whisper now exposes SpeechKit text
  normalization, literary punctuation, profanity filter, and phone formatting
  options instead of keeping those provider flags hardcoded in the native
  client. Help explains what each option does and when Yandex applies it.

## v1.5.1 (2026-06-02)

- **Yandex SpeechKit punctuation:** Live dictate now requests SpeechKit
  literary text normalization when text normalization is enabled, improving
  Russian punctuation and question/exclamation formatting. Whisper Settings and
  Help now describe this as text normalization plus punctuation.

## f-20260601-2 (2026-06-01)

- **Yandex SpeechKit key guidance:** Whisper Settings, local help, and live
  error dialogs now explicitly explain that Yandex requires the service-account
  API key secret value (`AQVN...`), not the API key ID (`aje...`). Unknown-key
  errors now include a recovery hint.

## f-20260601-1 (2026-06-01)

- **Cloud speech setup docs:** Help now explains where to create Deepgram and
  Yandex SpeechKit API keys, which Yandex service-account role is needed, and
  where to paste those keys in Settings -> Whisper.
- **Whisper local help:** the Whisper tab header now has a `?` help button
  with local guidance for Local Whisper, Live dictate, Deepgram, Yandex
  SpeechKit, key storage, and common setup failures.

## v1.5.0 (2026-06-01)

- **Yandex SpeechKit live dictation:** Whisper can now stream live dictation
  through Yandex SpeechKit in addition to Deepgram. SpeechKit stores its API key
  locally, supports a provider selector in the Whisper header, appears in the
  AI tab voice selector, and uses provider-aware overlay/status/history labels.
- **Live provider routing:** stop/cancel/status now target the active live
  provider, so switching the selected provider while dictation is running does
  not leave the old stream active.

## f-20260530-4 (2026-05-30)

- **Telegram automatic polling:** the server now polls configured per-user
  Telegram bots in the background, so bound chats can receive replies without
  pressing Poll in Settings. Settings > AI now labels the manual action as
  Poll now and explains that it is only an immediate refresh.

## f-20260530-3 (2026-05-30)

- **Settings modal stability:** the redesigned Settings window now keeps a
  fixed height while switching sections, the left navigation rail scrolls
  internally when needed, and navigation labels are explicitly left-aligned.

## v1.4.0 (2026-05-30)

- **AI agent settings:** the AI tab now has a gear modal for per-user custom
  instructions, generated capability/safety visibility, and dry-run prompt
  preview that shows planned commands without executing them.
- **Telegram task summaries:** Telegram "show task" requests now return a
  readable task summary with task properties and nested checkbox state instead
  of using the desktop-only open/navigation behavior.
- **Versioning policy:** desktop release docs now define patch/minor/major
  bump rules, so module-level features such as AI Agent ship as minor releases
  instead of hotfix-looking patch trains.

## f-20260530-2 (2026-05-30)

- **Settings window redesign:** Settings now opens as a wider two-pane modal
  with a left navigation rail, so sections such as Updates and Users / Limits
  stay visible instead of sliding out of the horizontal tab strip. On narrow
  windows the navigation folds back into a compact horizontal strip.

## v1.3.50 (2026-05-30)

- **Telegram chat pairing in Settings:** Settings -> AI now shows a per-user
  Telegram pairing command, polls the saved bot token for that pairing message,
  lists active bound chats, and can unbind a chat without running a server
  console command.
- **Telegram safety preserved:** unknown chats remain deny-by-default. The
  server binds a chat only when a message contains the current user's pairing
  code, then the bot uses that user's DeepSeek key and Telegram token.

## f-20260530-1 (2026-05-30)

- **AI command continuation fix:** command mode now continues after opening a
  task when the original request also asks to mutate it, so commands like
  "open task Pharmacy and mark Buy charcoal done" complete the checkbox update
  instead of stopping after navigation.

## v1.3.49 (2026-05-30)

- **DeepSeek balance:** Settings -> AI can check the current user's DeepSeek
  account balance through the server-managed key and open the DeepSeek usage
  cabinet in the browser.
- **Per-user Telegram bot tokens:** Telegram bot tokens are now configured in
  Settings -> AI per sync API user. The old server-global Telegram token path is
  removed; chats remain deny-by-default and still require explicit server-side
  binding to the app user.
- **AI help:** the AI tab now has a compact help modal explaining Chat vs
  Command mode, Telegram bot behavior, voice input, and example requests.
- **AI voice provider:** the AI tab can choose Whisper or Deepgram for voice
  prompts. Deepgram uses the same locally configured Deepgram key/model from
  Whisper settings and inserts the stopped live transcript into the AI prompt.
- **AI command continuation:** command mode now has a short follow-up pass after
  search-only plans for mutation requests, so requests like marking a checkbox
  done can continue from "found the task" to the actual checkbox update.
- **Detached Whisper window:** detached module windows now receive Tauri IPC
  permissions, fixing Whisper opening as "Failed to load module" from the
  sidebar context menu.

## v1.3.48 (2026-05-29)

- **Per-user DeepSeek keys:** AI no longer depends on a single server-wide
  DeepSeek token. Each sync API user can save or clear their own DeepSeek key in
  Settings -> AI; the key is stored on the server, never shown back in the app,
  and is used for both desktop AI requests and that user's Telegram AI binding.

## v1.3.47 (2026-05-29)

- **AI Agent tab:** added a desktop AI module backed by the server-managed
  DeepSeek gateway. Chat mode answers in the tab; Command mode returns a
  validated safe command plan that can open Tasks, Notes, and Snippets, create
  tasks, and add or complete task checkboxes locally so normal sync carries the
  change.
- **Voice prompts:** desktop AI can reuse the configured Whisper/Deepgram
  transcription flow, and mobile AI now has Android speech recognition with
  microphone permission for spoken prompts.
- **Mobile AI tab:** added text AI chat/command support with local safe command
  execution and sync notification.
- **Telegram AI safety:** added deny-by-default Telegram bot plumbing with
  durable chat-to-user bindings, idempotent processed message tracking,
  admin-only poll/status controls, and a server console command for binding a
  Telegram chat to an app user by API-key prefix.

## f-20260529-1 (2026-05-29)

- **Task checkbox Enter placement:** pressing Enter while editing a task
  checkbox now creates the new checkbox at the same hierarchy level directly
  after the current checkbox instead of appending it to the end of the sibling
  list. Hidden completed siblings keep their relative order.

## v1.3.46 (2026-05-29)

- **Detached module windows:** right-click a main sidebar module to open it in
  its own focused window without the main left sidebar. Reopening the same
  module focuses the existing detached window, and frontend OTA reloads now
  include detached `module_*` windows.

## v1.3.45 (2026-05-28)

- **Whisper overlay OTA reload:** applying a frontend OTA now reloads the hidden
  Whisper overlay window as well as the main window, so stale overlay HTML/JS
  cannot keep showing `Ready` after an update.
- **Overlay refresh on show:** every overlay display refreshes its WebView
  document before showing Stop/X, so the controls use the current frontend
  bundle even if the hidden window was created before the update.

## f-20260528-1 (2026-05-28)

- **Whisper overlay boot fix:** the floating overlay now loads a standalone
  relative script instead of relying on the secondary window's module chain, so
  the Stop/X buttons can invoke the active local or live recording instead of
  leaving the static `Ready` fallback on screen.

## v1.3.44 (2026-05-28)

- **Whisper overlay hit-test fix:** the floating overlay now stays explicitly
  focusable/clickable without stealing focus from the dictation target, accepts
  the first inactive-window click where supported, and disables click-through
  before it is shown.
- **Auto-hide taskbar clearance:** bottom-corner overlay placement now uses an
  extra safe margin so the Stop/Cancel row is not covered by auto-hide taskbars.

## v1.3.43 (2026-05-28)

- **Whisper overlay bridge fix:** the floating overlay now waits for Tauri IPC
  injection, receives Whisper events explicitly in its own window, and shows an
  initialization marker instead of silently staying on static HTML.
- **Overlay taskbar positioning:** the overlay is now placed inside the
  monitor work area, so its Stop/Cancel controls are not hidden behind the
  Windows taskbar.

## v1.3.42 (2026-05-28)

- **Deepgram punctuation:** live dictation requests now enable Deepgram
  punctuation and smart formatting, so finalized text can include normal
  sentence punctuation and capitalization when the model supports it.
- **Clickable Whisper overlay:** the floating overlay now has a larger status
  layout with Recording/Stopping detail, a recent-words ticker, and
  provider-agnostic Stop/Cancel controls that target the active local or live
  session.

## v1.3.41 (2026-05-28)

- **Whisper global hotkey fixes:** `Ctrl+Alt+Space` now follows the
  `Live dictate` setting, so it starts/stops Deepgram live dictation when
  live mode is enabled instead of always falling back to local Whisper.
- **Hotkey repeat guard:** duplicate global shortcut `Pressed` events within a
  short interval are ignored, preventing a start immediately followed by an
  unintended stop with an almost-empty recording.
- **Overlay state recovery:** the floating Whisper overlay now bootstraps its
  current local/live state and Deepgram live sessions show/hide the overlay,
  so Stop/Cancel target the active recording mode even when launched by the
  global hotkey.

## v1.3.40 (2026-05-28)

- **Completed Whisper hotfix release:** includes the Windows live dictation
  paste fix and persistent Whisper diagnostics from v1.3.38 in a full
  Windows + macOS native release.
- **Release reliability:** the desktop release workflow now creates the
  GitHub release once before the platform matrix uploads assets, preventing
  Windows/macOS jobs from racing on `Release already_exists`; frontend assets
  are only published after native `v*` jobs succeed.

## v1.3.39 (2026-05-28)

- **Superseded release attempt:** frontend assets were published while the
  native release matrix was skipped during workflow repair. v1.3.40 carries
  the completed full release.

## v1.3.38 (2026-05-28)

- **Superseded partial release:** macOS native assets were published, but the
  Windows asset failed on a GitHub release creation race. v1.3.40 carries the
  completed full release.

## v1.3.37 (2026-05-27)

- **Deepgram live dictation:** Whisper now has a `Live dictate` mode that
  streams microphone audio to Deepgram Nova, shows interim transcript text in
  the tab and overlay, and pastes only finalized chunks into the active app.
- **Local Deepgram settings:** the Whisper settings modal stores a local-only
  Deepgram API key, model, and endpointing value; the key is not synced.
- **Whisper history metadata:** transcript history now records provider/model
  metadata so local Whisper and Deepgram live sessions are distinguishable.

## f-20260527-3 (2026-05-27)

- **Public snippet Markdown:** snippet share pages now render Markdown-like
  value and description content as safe Markdown, including headings, inline
  formatting, reference links, code spans, and Figure Card images, while plain
  code-only snippets remain in the copyable preformatted block.

## f-20260527-2 (2026-05-27)

- **Public note Markdown:** note share pages now render note content as safe
  Markdown, including headings, inline formatting, fenced code blocks, and
  Figure Card images, while escaping raw HTML.
- **Image preview navigation:** the image upload modal now shows the current
  variant name and position, with previous/next buttons and keyboard arrow
  navigation between generated variants.

## f-20260527-1 (2026-05-27)

- **Note share autosave:** creating a public link for a note now saves the
  current editor content and runs sync before requesting the link, so newly
  inserted images and other unsaved edits are present on the server instead of
  returning `404 item not found`.

## v1.3.36 (2026-05-26)

- **Native media preview fallback:** desktop image previews and rendered
  Figure Cards now load server media through a native snippets-media proxy and
  display local `data:` URLs inside the WebView, while saved Markdown keeps the
  portable public HTTPS image links.
- **Preview timeout fix:** the image modal no longer waits for a stuck
  WebView remote-image load before showing optimized variants.

## f-20260526-1 (2026-05-26)

- **Image error diagnostics:** image upload, processing, insert, and preview
  failures now open a persistent modal instead of disappearing as a toast.
  The modal includes frontend/native version context, job IDs, preview URLs,
  failed variant reasons, and a Copy error button for reporting the exact
  failure.

## v1.3.35 (2026-05-26)

- **Image preview fix:** desktop image-upload previews now load public HTTPS
  media URLs inside the Tauri WebView instead of failing at the Preview step.
- **Clipboard screenshots:** the image modal can upload screenshots directly
  from the clipboard with the Paste from clipboard button or Ctrl+V, then uses
  the same server optimization and variant picker as file uploads.
- **Release smoke coverage:** post-release media smoke now downloads a
  generated preview URL so media routing and stored preview files are checked
  after release.

## v1.3.34 (2026-05-25)

- **Images in Notes and Snippets:** desktop Markdown toolbars can upload an
  image to the server, choose an optimized variant, and insert a portable
  Markdown image link into note content, snippet value, or snippet description.
- **Figure Card rendering:** desktop previews, public share pages, and mobile
  note/snippet views render Markdown images as framed Figure Cards with safe
  HTTP(S) image URLs and captions from alt text or file names.
- **Server media storage:** the API stores optimized WebP variants under
  persistent public media tokens and enforces the admin-managed per-user media
  quota and max-upload limits added in v1.3.33.

## v1.3.33 (2026-05-25)

- **Admin storage limits:** server users now have admin state, last-seen
  tracking, default media quota, and max upload limits, managed through a
  command-only server admin assignment flow.
- **Desktop Users / Limits:** Settings now shows an admin-only Users / Limits
  tab with user activity, storage usage, quota editing, and read-only admin
  badges.
- **API test runner:** added an API unit-test venv runner that installs API
  dependencies separately from post-release smoke tests.

## v1.3.32 (2026-05-24)

- **Public share links:** Notes and Snippets can now be shared through live
  secret-token public links. Desktop and mobile can create, copy, preview/open,
  and revoke links without adding shared rows to generic sync.
- **Share-safe public payloads:** public note pages expose only title and
  content, while public snippet pages expose name, value, description, and safe
  HTTP(S) links.
- **Snippet pin polish:** desktop pinned snippet chips now use the same pin
  icon language as Tasks.

## v1.3.31 (2026-05-24)

- **Synced pinned snippets:** desktop Snippets now supports synced snippet
  pinning with a `Tags / Pinned` top-panel selector, a detail-header pin
  button, wrapped pinned snippet chips, and drag-and-drop chip reorder.
- **Pinned notes order:** pinned note chips can now be reordered by
  drag-and-drop, with the order synced through the API.
- **Mobile sync compatibility:** mobile local storage now preserves synced
  snippet pin/order fields and pinned note order during pull/push, without
  adding mobile UI for pinned snippets.

## v1.3.30 (2026-05-24)

- **Sync datetime normalization:** desktop now accepts and normalizes API ISO /
  RFC3339 `created_at` and `updated_at` values into the local SQLite datetime
  format. This keeps Last Write Wins comparisons consistent and fixes Snippets
  modified-date sorting for rows pulled from the API before they are edited
  locally again.

## f-20260524-5 (2026-05-24)

- **Snippets left-panel sorting:** the Snippets header now has a compact sort
  menu for switching the left list between name (A-Z) and modified date
  (newest first), with the chosen mode saved locally across reloads.

## f-20260524-4 (2026-05-24)

- **Tasks checkbox collapse persistence:** collapsed checklist branches now
  survive frontend OTA reloads and normal app restarts instead of expanding
  all descendants after the WebView reloads.

## f-20260524-3 (2026-05-24)

- **Tasks checkbox DnD hidden-completed fix:** dragging checklist items now
  commits to the same visible slot shown by the placeholder when completed
  items are hidden, so hidden completed rows no longer become implicit drop
  targets or parents.

## f-20260524-2 (2026-05-24)

- **Tasks pinned chip reorder:** pinned task chips in the desktop Tasks tab
  can now be reordered directly in the top chip strip with pointer drag,
  wrapped-row placeholder feedback, and click behavior preserved.

## f-20260524-1 (2026-05-24)

- **Tasks checkbox sync:** after a desktop sync pulls task changes, the open
  Tasks tab now clears its checkbox cache and refreshes the visible task
  state, so remote checkbox checkmarks appear without reopening the tab.
- **Mobile checkbox sync:** tapping an existing task checkbox now persists the
  checked state immediately and schedules sync, instead of waiting for the
  whole task editor to be saved.

## v1.3.29 (2026-05-23)

- **Tasks sync backfill:** existing local desktop task categories, statuses,
  tasks, checkboxes, and links are now marked for one-time upload when the
  desktop app is updated, so mobile devices can pull them after sync.
- **Sync diagnostics:** desktop Debug Sync now includes local task table
  counts.

## v1.3.28 (2026-05-23)

- **Tasks sync:** added server-side sync tables for task categories, statuses,
  tasks, checkboxes, and links, with UUID relationships preserved across
  devices.
- **Mobile Tasks:** added a mobile Tasks tab with local storage, CRUD flows,
  and sync participation for categories, statuses, tasks, checkboxes, and links.
- **Post-release smoke:** added non-UI smoke automation for API task sync and
  desktop/mobile release manifest checks.

## 1.3.27 OTA patches (2026-05-23)

- **f-20260523-5 — Snippets Key Cloud density:** added a selectable
  Dense/Fast cloud layout algorithm, made Dense the default tight tangent
  packing mode, and expanded the deterministic key color palette.
- **f-20260523-4 — Snippets Key Cloud cache:** added persistent
  stale-while-revalidate cache and a no-cache progress state, while restoring
  the denser ring-probing layout in async chunks.
- **f-20260523-3 — Snippets Key Cloud performance:** replaced slow ring
  probing with spatial-hash spiral placement so dense key clouds open
  interactively while still avoiding overlaps.
- **f-20260523-2 — Snippets Key Cloud overlap fix:** changed the packed cloud
  placement to reject colliding bubble positions and added smoke coverage for
  dense clouds so key circles do not overlap.
- **f-20260523-1 — Snippets Key Cloud layout:** upgraded Key Cloud to a
  packed zoomable cloud with larger count contrast, center-weighted high-count
  keys, pan/zoom/Fit controls, adaptive labels, and full-key hover tooltips.

## 1.3.27 OTA patches (2026-05-22)

- **f-20260522-8 — Snippets Key Cloud search:** clicking a key bubble now
  closes the cloud, clears the selected tag, writes the key into search, and
  runs the snippet search immediately.
- **f-20260522-7 — Snippets Key Cloud:** added a Key Cloud modal that derives
  stable colored keys from underscore-separated snippet names, plus a Related
  detail tab sorted by shared keys.
- **f-20260522-6 — Help release history:** moved the Help changelog to a
  frontend-owned `release-history.md` asset that updates through frontend OTA
  releases, and added a CI guard so future release tags must be documented
  before the frontend bundle is packaged.
- **f-20260522-5 — Tasks Focus view checkpoint:** updated Help release notes
  with the May 22 frontend OTA changes and added smoke coverage for the Help
  changelog tab.
- **f-20260522-4 — Tasks Focus view compact height:** compact detail cards now
  grow to their checklist content instead of using an inner card scroll area
  that left blank space below.
- **f-20260522-3 — Tasks Focus view polish:** selected tasks open compact by
  default, Expand/Collapse works inside the right pane, completed checklist
  items are hidden by default, and pinned tasks open at the top of the detail
  pane.
- **f-20260522-2 — Tasks Focus view:** added a third layout with a searchable
  task index on the left, selected task detail on the right, and an
  outside-filter banner for pinned tasks opened from the top chip strip.
- **f-20260522-1 — Snippets code block rendering:** rendered Markdown code
  blocks now tolerate leading spaces before triple-backtick fences and show
  compact language headers (`bash`, `sql`, `plain`, etc.) with the copy action
  in the header.

## 1.3.27 OTA patches (2026-05-18)

- **f-20260518-3 — Snippets polish:** hide the tab row when only `Code` is
  available and use a readable strong-blue hover tint for snippet detail tabs.
- **f-20260518-2 — Snippets markdown tabs:** replaced `Main / Web / Note`
  with compact content tabs, added copy buttons to rendered Markdown code
  blocks, improved code-block insertion in the Markdown toolbar, collapsed the
  editor description by default, and moved links to explicit
  browser/app-window actions.
- **f-20260518-1 — Tasks pinned strip:** fixed task pin toggles so the top
  pinned chip strip refreshes immediately when a task is pinned or unpinned.

## v1.3.27 (2026-05-17)

- **Snippets sync:** fixed deleted snippet tags coming back from the
  server after sync. Server tombstones are now preserved locally, so
  removing the duplicate `wiki` tag stays removed.

## v1.3.26 (2026-05-16)

- **VPS Management:** added a resizable detailed analysis modal with
  disk-usage drill-down, top memory processes, and raw SSH command
  output for troubleshooting.

## 1.3.25 OTA patches

- **f-20260428-1** — Exec DnD UX polish:
  - **Sliding placeholder** instead of a 2px insertion line: a real
    dashed-card slot of the source's height takes its place during
    drag, so the user can see exactly where the card will land. As the
    placeholder moves through the list, peer cards animate to their
    new positions via FLIP (capture old top → DOM reorder → translateY
    → animate to identity over 180ms), giving the "cards politely
    scoot out of the way" feel rather than instant snap.
  - **Relaxed drop zone**: with V1E's 6px row gaps it was too easy to
    miss the drop target by releasing in the gap. Now any pixel inside
    the command-list bounding box counts as reorder mode — drop
    anywhere over a card's upper half places the slot above it; lower
    half places below; gaps and empty space at the end work too.
  - **New ⚙ Exec settings** in the right panel header: two sliders
    for "Command name size" and "Group name size" (10–20px, persisted
    via `set_setting`). V1E's 12px felt cramped on bigger displays;
    the new default is 13px and the user can tune per machine.

## v1.3.25 (2026-04-28)

**Exec → Command Groups: redesign + DnD + Run-all.**

- **Rename UI**: "Categories" → "Groups". DB tables and columns
  unchanged.
- **Auto-letter Slack-style icon** on each group (deterministic colour
  from name hash; consistent across sessions). Group rows now also
  show a count of commands.
- **DnD**: drag the ⋮⋮ grip on a command card to another group (drop
  on the left panel) or reorder within the same group (drop on
  another card). Click the grip without dragging opens a "Move to…"
  popover for accessibility / touchpad use.
- **Run-all**: new ▶ Run all button on the group header. Runs every
  command in the group sequentially with a progress bar and
  per-command collapsible sections in the bottom console; fail-fast
  on the first error, single Stop button aborts the whole sequence.
- **Edit modal**: new "Group" dropdown lets you change a command's
  group from the form (alternative to DnD).
- **Visual**: tab now uses a distinct terminal/brutalist look
  (JetBrains Mono throughout, phosphor-green accent on near-black,
  breadcrumb header `exec › <selected group>`, dim "01"-style row
  numbers, sharp 1px borders, spacious per-row borders with 6px
  gaps). Other tabs are unchanged.
- **Backend**: new `move_exec_command`, `reorder_exec_commands`, and
  `list_exec_command_counts` Tauri commands.
- **Bug fix**: `stop_command` now actually kills the running child
  process — previously it only flipped a flag while
  `wait_with_output().await` blocked until the child exited naturally,
  so Stop on a long-running command (e.g. `rsync`, `sleep 60`) was a
  no-op. Run-all's Stop button depends on a real kill, so this bug
  blocked the new feature; pre-1.3.25 single-command Stop was also
  broken in the same way. Uses `SIGTERM` on Unix, `taskkill /T /F`
  on Windows.
- **Bug fix**: Run-all loop now snapshots the command queue at start
  so switching groups (or any other code path that mutates the
  module-level `commands` array) mid-run can't corrupt iteration —
  previously this could TypeError out of the loop and leave the tab
  permanently locked until restart.

## v1.3.24 (2026-04-26)

**Whisper post-process UX + Exec card redesign.**

- **Whisper:** new Gemma-model combobox in the tab header (right of the
  Whisper-model one). Empty state — single `(no models — open Settings)`
  entry that opens the settings modal scrolled to the Gemma block.
- **Whisper:** right-pane split into two tabs — `Whisper output` (raw
  transcript, as before) and `Post-processed` (Gemma-cleaned text).
  History rows now persist `postprocessed_text` in the DB and render a
  small green dot when post-processing has been done.
- **Whisper:** unified status strip between meta and action buttons —
  shows `💭 Transcribing… X.Xs` (elapsed timer) for whisper inference
  and `✨ N% · K/M tok · X.Xs` with a fill bar for Gemma post-processing.
  Gemma backend now streams completions via SSE and emits incremental
  progress events.
- **Exec:** card redesign. Big octagonal Run-button with a green ▶ on
  the left, the command name is now click-to-edit (the standalone
  ✎-button is gone), Delete (✕) stays on the right. Layout flows
  Run | name + WSL badge / description / command-code | delete.
- **DB:** migration adds `whisper_history.postprocessed_text` column
  (nullable, idempotent ALTER).

## v1.3.23 (2026-04-24)

**VPS tab — four fixes.**

- **Stats inline on every card.** Tiles now render CPU / RAM / Disk
  progress bars directly, no need to expand. Height bumped from 48 px
  to ≈ 92 px. A per-tile stats cache (`statsCache` + `ts`) keeps the
  numbers visible between re-renders, with a "3 min ago"-style
  freshness marker.
- **Drag a card between environments.** Pointer-based DnD via the new
  ⋮⋮ grip on the left of each tile. A floating semi-transparent clone
  follows the cursor; env-blocks under the cursor get a dashed-accent
  drop indicator. On release to a different env → `move_vps_server`
  + reload.
- **Fix cmd-window flicker on Windows during SSH calls.** Added
  `CREATE_NO_WINDOW` to `commands::vps::build_ssh_cmd` (every SSH
  invocation was opening and immediately closing a black cmd window).
  Same flag already on repo_search, whisper-server, nvidia-smi polls.
- **Click no longer auto-fetches.** Clicking a tile just
  expands / collapses the detail panel; it renders whatever's in the
  stats cache (or "Stats not loaded — press ↻" placeholder).
  Explicit ↻ button on every tile (and in the expanded detail) is
  the only way to fetch. Per-env "Refresh all" button still works.

## 1.3.22 OTA patches

- **f-20260424-4** — Tasks DnD "snap-back" fix: on drop, the card sometimes
  reverted to its original position even though the insertion line showed
  the right target. Cause: the commit path read the new id order from the
  DOM immediately before `reloadTasks()` wiped and rebuilt the list —
  timing-sensitive. Fixed by deriving the new id order purely from
  `state.tasks` + the dragged-id + the target-before-id (no DOM read).
  `commitCardReorder` signature changed accordingly.

- **f-20260424-3** — Tasks module — four fixes:
  - **DnD rewritten.** Old ghost-only mode gave no spatial feedback and
    the commit handler silently no-op'd in some cases. New model: source
    stays in place dimmed, a floating semi-transparent clone follows
    the cursor, a blue **insertion line** is inserted into the list at
    the drop target position. On drop the DOM is reordered and the
    backend `reorder_tasks` is called with the full new id order.
    Same model for checkbox reorder inside a card (drag > 30 px
    rightward nests under the row above; depth ≤ 3 enforced).
  - **Checkbox text wraps in expanded mode.** Replaced `<input
    type=text>` with a `contenteditable` div + `white-space: pre-wrap`.
    Long labels now wrap instead of scrolling horizontally. Keyboard
    shortcuts (Enter = new row, Tab = nest, Shift+Tab = outdent,
    Backspace-on-empty = delete) preserved.
  - **Collapsed cards are editable too.** `editable: false` removed on
    the collapsed render path — you can now add / rename / reorder
    checkboxes without first expanding the card. Hover shows the 🗑
    and the + Add row is always present.
  - **Checkbox font size** is now a setting. Settings → Tasks →
    "Checkbox font size" (10-20 px). Takes effect immediately via a
    CSS variable, no reload needed. Same block also exposes
    "Max visible checkboxes per card" and Layout mode.

## v1.3.22 (2026-04-24)

**CI: cache sidecar binaries between releases.**

- `.github/workflows/release-desktop.yml` now has an `actions/cache` step
  scoped to the pinned `WHISPER_CPP_VERSION` + `LLAMA_CPP_VERSION`.
  First v-release with a given version still builds from scratch
  (~5 min whisper + ~25 min llama+Metal on macOS); all subsequent
  v-releases skip both build steps and restore the binaries in ~5 sec.
- Cache key drop-in happens automatically when either pinned version
  changes. No manual cache invalidation.
- No runtime change — this is a CI-only optimisation. Payload (the
  shipped .exe / .dmg / OTA zip) is byte-identical.

## v1.3.21 (2026-04-24)

**Hotfix: WSL `rsync`/`ssh` broken by over-eager quote escaping.**

- `commands::exec::bash_single_quote_escape` mangled any command with `'`
  into `'\''` because I was mentally modelling the call as if we
  interpolate into `bash -lc '<cmd>'`. In reality we pass the command
  as a **single argv element** to `bash -lc`, and bash reads argv[2]
  as shell source verbatim — no wrapping quotes, no escape needed.
- `rsync -av '…' user@host:/dst` → bash saw `rsync -av '\''…'\'' ...`
  → `unexpected EOF while looking for matching '` → exit 2.
- Fixed: push `cmd` verbatim as last argv element. Added regression
  test `wsl_argv_passes_user_command_verbatim`.

## v1.3.20 (2026-04-24)

**Exec: per-command Shell selector — run inside WSL natively.**

- Each Exec command now has a **Shell** field (`host` / `wsl`) and an
  optional **WSL distro** (defaults to the system's default distro).
  Lets you run commands inside WSL using its own `~/.ssh/config`,
  keys and binaries — no more invoking `ssh` from Windows with
  copied keys.
- **Host** mode: `cmd /c` on Windows (was `sh -c`, which required
  git-bash on PATH and was broken out-of-the-box); `sh -c` on Mac/Linux.
- **WSL** mode: `wsl.exe [-d <distro>] -- bash -lc '<cmd>'` — login
  shell so `~/.bashrc` / `~/.profile` / ssh-agent are loaded. Bash
  single-quote escaping protects user input from breaking the wrapper.
- `CREATE_NO_WINDOW` flag on all `run_command` spawns — no flashing
  cmd window on Windows (same pattern as `repo_search.rs`).
- New command `list_wsl_distros()` — parses `wsl.exe -l -q` (which
  outputs UTF-16 LE) into a clean distro list. Returns `[]` on
  Mac/Linux or if WSL isn't installed.
- UI: Shell dropdown + Distro dropdown in the command editor modal.
  Card shows a small `WSL · <distro>` badge next to the command name
  so you can tell at a glance where it runs. `WSL` option is marked
  "not available on this machine" when `list_wsl_distros` returns
  empty (so commands synced from a Windows machine still save but
  the hint is visible).
- Migration: `ALTER TABLE exec_commands ADD COLUMN shell DEFAULT 'host'`
  + `ADD COLUMN wsl_distro`. Existing commands unaffected.

## v1.3.19 (2026-04-24)

**New: Bundled local LLM post-processing for Whisper transcripts (Gemma).**

- Second sidecar — `llama-server` from llama.cpp — built from source in CI
  (static link, CPU-only, no CUDA dep). Lives alongside `whisper-server` in
  Tauri `externalBin`. Pinned at `LLAMA_CPP_VERSION = b8920`.
- New Rust module `src/gemma/` mirroring `src/whisper/`:
  - `catalog.rs` — two models from HuggingFace ggml-org: `gemma-3-1b-it-Q4_K_M`
    (~800 MB, fast) and `gemma-3-4b-it-Q4_K_M` (~2.5 GB, recommended).
  - `models.rs` — download with progress, SHA256 verify.
  - `server.rs` — spawn llama-server, TCP-probe readiness (180 s timeout
    because mmap+load of 4 B weights is slow on cold CPU), `/completion`
    endpoint.
  - `postprocess.rs` — Gemma-3 chat-format prompt ("Исправь пунктуацию и
    опечатки в voice-транскрипте. Не меняй смысл."), output sanitizer
    (char-based, not byte-based — CLAUDE.md §10).
  - `service.rs` — lazy warm, 5-min idle unload, `set_default_model`.
- New commands: `gemma_list_catalog`, `gemma_list_models`,
  `gemma_install_model`, `gemma_delete_model`, `gemma_set_default_model`,
  `gemma_postprocess`, `gemma_unload_now`.
- Shutdown on `RunEvent::Exit` + NSIS pre-install `taskkill /IM
  llama-server.exe` so auto-updater can replace the sidecar on Windows.
- UI:
  - Settings → new "Gemma post-processing" block with installed models,
    per-model Install / Delete / Make default, inline progress.
  - Whisper tab detail view gets **✨ Post-process** button next to Copy /
    Paste / Type / Delete. Click rewrites the textarea in place, first run
    warms the server (~30-60 s on CPU), later runs reuse it.
- Phase 2 (auto-postprocess toggle in header + overlay, model dropdown in
  header, custom prompt in Settings) is a follow-up.

## 1.3.18 OTA patches

- **f-20260424-1** — Whisper tab header: the active-model label is now a
  dropdown you can use to switch models without opening Settings.
  Change flips `is_default` and unloads the warmed server (same two-step
  as Settings save). Disabled while the service is warming / recording /
  transcribing / unloading to avoid killing an in-flight action. Stays in
  sync with the Settings modal via the shared `whisper:settings-changed`
  event.
- **f-20260424-2** — Whisper UX trio:
  - **Overlay was click-dead** on Windows: the body had
    `-webkit-app-region:drag`, which Tauri 2 / WebView2 treats as a
    drag-region that swallows mouse clicks on nested elements. Stop and
    ✕ buttons never received the click. Replaced with
    `data-tauri-drag-region` on the title row only (Tauri 2 recommended
    pattern); the rest of the overlay is now clickable.
  - **Cancel button** in the main-window header next to Record. Appears
    while the service is warming / recording / transcribing / unloading;
    clicking drops the in-flight audio (no transcript saved). Esc works
    as a shortcut for Cancel when the tab is focused.
  - **Inline delete per history row** — 🗑 button on hover in the left
    list. Empty / `[BLANK_AUDIO]` results are shown italic-grey with
    `(empty / no speech)` placeholder so they're easy to spot and
    delete.

## v1.3.18 (2026-04-24)

**Fix: "Model by default" selector in Settings actually switches the model.**

- Settings modal saved the pick into `app_settings.whisper.default_model`
  (key/value), but the backend reads the default from the `whisper_models`
  table's `is_default` column — two different places. Result: user
  changed default to `small`, but whisper-server kept transcribing with
  the previously-warmed `large-v3-q5_0`.
- Save now additionally calls `whisperApi.setDefaultModel(name)`
  (transactional flip of `is_default` for all rows) and
  `whisperApi.unloadNow()` so the next record warms up the newly
  selected model. Header label refreshes via a new
  `whisper:settings-changed` listener.

## v1.3.17 (2026-04-24)

**Fix: cmd window flicker during transcribe on Windows.**

- `metrics.rs` polls `nvidia-smi` every 200ms while transcribing; each
  invocation opened (and immediately closed) a cmd window, producing a
  visible flicker throughout the transcribe phase. Added the
  `CREATE_NO_WINDOW` (0x08000000) flag via `CommandExt::creation_flags`
  on both `metrics.rs` and the one-shot call in `gpu_detect.rs`. Same
  pattern `commands/repo_search.rs:22` already uses for git/ripgrep
  spawns.

## v1.3.16 (2026-04-24)

**Per-transcription performance metrics.**

- New `whisper/metrics.rs` — background sampler that polls sysinfo
  (whisper-server process CPU%) and `nvidia-smi` (GPU% + memory used
  MB) at ~5 Hz during the inference call, tracking peak values.
- Extended schema: `whisper_history` gets `cpu_peak_percent`,
  `gpu_peak_percent`, `vram_peak_mb` columns (idempotent ALTER on
  existing DBs). `TranscribedPayload` + `StopOutcome` carry the same
  three fields end-to-end.
- UI: history detail pane shows `CPU N% · GPU N% · VRAM N MB` next to
  the transcribe duration. Overlay "Inserted" sub-line includes the
  performance summary so you see GPU load immediately after each take.

## v1.3.15 (2026-04-24)

**Whisper global hotkey + install additional models in Settings.**

- **Global hotkey now actually works.** `tauri-plugin-global-shortcut`
  was a dependency but never registered at startup — user's
  `whisper.hotkey` setting was saved to DB and ignored. Added a
  registration pass in `lib.rs::.setup()` that reads
  `whisper.hotkey` (default `Ctrl+Alt+Space`) and binds a toggle
  handler: keypress → start if idle/ready, stop if warming/recording.
  Works when the main window is hidden. Hotkey-change still needs an
  app restart (hot re-register is a follow-up).
- **Install additional models from Settings.** Previously only the
  onboarding screen (shown once when the model list is empty) could
  install; after that there was no UI to add a second model. Settings
  modal now shows an "Установленные модели" block with a list (with
  per-row Delete) and a "+ Установить другую модель…" button that
  opens a mini catalog picker showing only models not yet installed.
  Progress bar inline per-install.

## v1.3.14 (2026-04-24)

**Fix: "Whisper error: buffer still shared" on Stop.**

- `Recorder::finish_wav` used `Arc::try_unwrap` on the PCM buffer, which
  fails if any other `Arc` clone still exists — and the cpal callback
  thread holds one for a few ms even after the stream is dropped,
  causing the error immediately when the user presses Stop.
- Replaced try_unwrap with `drop(stream) + buffer.lock().clone()`:
  extra Vec copy is cheap, no race with callback shutdown.

## v1.3.13 (2026-04-24)

**NSIS installer: taskkill on pre-install to free locked .exe files.**

- When `whisper-server.exe` (or the main app) is still running during
  auto-update, the installer fails with "cannot remove / file in use".
- Added `src-tauri/installer-hooks.nsh` defining
  `NSIS_HOOK_PREINSTALL` + `NSIS_HOOK_PREUNINSTALL` that run
  `taskkill /F /T /IM whisper-server.exe` and
  `taskkill /F /T /IM keyboard-helper.exe` before file ops, followed by
  a 500 ms delay so Windows releases file locks.
- Registered via `bundle.windows.nsis.installerHooks` in
  `tauri.conf.json`. Combined with v1.3.10's RunEvent::Exit handler
  this is belt + braces — graceful close kills the child directly, and
  installer kills both if anything survives.

## v1.3.12 (2026-04-24)

**Fix: Whisper readiness detection via TCP probe (was stdout-parsing).**

- Root cause of `timeout waiting for whisper-server`: whisper-server
  v1.7.x prints its "listening" banner via `printf` to stdout. On
  Windows, stdout piped to a parent process is **full-buffered** (not
  line-buffered), so the banner sits in the C runtime buffer forever —
  our parent never sees it even though the server is healthy and
  already accepting connections. Manual run from a terminal "works"
  only because tty makes stdout line-buffered.
- Replaced stdout/stderr string-match with an async TCP probe: try
  `TcpStream::connect(127.0.0.1:<port>)` every 200ms; succeeds the
  moment server.cpp's `svr.listen_after_bind()` returns, which is right
  after the `printf`. Independent of stdio buffering.
- `stderr`/`stdout` are still drained into `eprintln!` for logs, but no
  longer drive readiness.

## v1.3.11 (2026-04-24)

**Whisper spawn timeout + readable error toasts.**

- whisper-server spawn timeout: 30s → 120s. Large quantized models
  (ggml-large-v3-q5_0 is ~1 GB) can take 30-60s to mmap + init on
  CPU-only builds; previous 30s window killed perfectly healthy servers
  mid-load and reported "timeout waiting for whisper-server to become
  ready".
- Error toasts now stay up **8 seconds** instead of 1.5, show a red
  border, include "click to dismiss" hint, and are clickable. Info
  toasts (Copy/Paste/etc) still fade in 1.5s.

## v1.3.10 (2026-04-24)

**Fix: whisper-server sidecar survived app exit → blocked installer on
auto-update.**

- Tauri's shell sidecar is a plain child process, not in the main exe's
  process group. When the updater killed the main exe it left
  `whisper-server.exe` running, and the installer then failed to replace
  the file on Windows because it was held open.
- Switched `.run(context)` → `.build(context)?.run(|handle, event| ...)`
  and added a `RunEvent::Exit` handler that synchronously calls
  `WhisperService::unload_now()` (SIGTERM on Unix, TerminateProcess on
  Windows). Child is gone before the main exe's process actually exits,
  so the installer sees a released file on the next startup.

## v1.3.9 (2026-04-24)

**Fix: Whisper warm-up stuck at 30s, state bounces back to idle.**

- Root cause: whisper-server v1.7.x prints its "listening" banner to
  **stdout** (`printf` at `examples/server/server.cpp:1030`), while our
  `server.rs` only scanned **stderr** for that marker. Server was fine,
  we just missed the signal → 30-s timeout → we killed the (healthy)
  server → state snapped back to Idle, silently.
- Fix: check the "listening" marker in both stdout and stderr streams.
- Also: the `whisper:error` event was unsubscribed on the UI, so backend
  spawn failures were invisible to the user. Added a toast subscriber
  (with error code + message) and a `console.error` fallback.

## v1.3.8 (2026-04-24)

**Fix: "Whisper error: cannot start from state Warming".**

- Backend `start_recording` is now idempotent: duplicate calls while the
  service is in `Warming` / `Recording` / `Transcribing` / `Unloading`
  return `Ok(())` instead of erroring. Previously a stale button click or
  a duplicate hotkey event that landed between a state-changed event and
  the UI update surfaced as an alert.
- Frontend Record button is now disabled (with a stateful label —
  "⏳ Warming…", "💭 Transcribing…", "… Unloading") whenever a click would
  be invalid. `idle` and `ready` show "🎤 Record"; `recording` shows
  "⏹ Stop". Click handler short-circuits if `disabled`.

## v1.3.7 (2026-04-24)

**Hotfix: statically link whisper-server so it runs on Windows.**

- whisper.cpp CMake on Windows defaults `BUILD_SHARED_LIBS=ON`: `server.exe`
  was linked against `whisper.dll` + `ggml.dll` + `ggml-cpu.dll` sitting next
  to it in the cmake build dir. Tauri's `externalBin` copies only the
  renamed `server.exe` into resources, so at runtime Windows showed
  "не обнаружена whisper.dll" and the server never started.
- Added `-DBUILD_SHARED_LIBS=OFF` to the CI cmake invocation (and the
  local `scripts/fetch-whisper-bin.sh` build) on both macOS and Windows,
  producing a single self-contained binary.

## v1.3.6 (2026-04-24)

**Hotfix: real SHA256 hashes for all 6 Whisper models.**

- `whisper/catalog.rs` shipped with placeholder SHA256 values from the
  implementation plan (40-char SHA-1-looking stubs + one all-zero string).
  Every model install failed at the verification step with
  `Ошибка: sha256 mismatch` after a full multi-hundred-MB download.
- Replaced all 6 with real values pulled from HuggingFace LFS metadata
  (`lfs.oid` field on `/api/models/ggerganov/whisper.cpp/tree/main`).
  Also corrected 4 of 6 `size_bytes` values that were off by 1–256 bytes
  or rounded.
- Refresh command documented inline in `catalog.rs` for future upgrades.

## v1.3.5 (2026-04-24)

**Whisper onboarding: show discrete GPU name + VRAM.**

- `gpu_detect` on Windows now also queries `nvidia-smi` for the GPU name
  (`--query-gpu=name,memory.total`) and surfaces it in the onboarding
  "Система определила…" banner as a separate field. Previously only
  `cpu_model` was shown, which on AMD APUs ("Ryzen 7 5800H with Radeon
  Graphics") misleadingly implied the system had no NVIDIA card even when
  CUDA was detected.
- `HardwareInfo` gains an optional `gpu_name: Option<String>` field (e.g.
  `"NVIDIA GeForce RTX 3060"`). Backward compatible: missing on older
  backends — frontend handles absent gracefully.
- Banner format: `CPU, N GB RAM, [GPU NAME (M GB VRAM), ]CUDA|Metal|CPU доступен`.

## v1.3.4 (2026-04-24)

**Hotfix: CI whisper-server build target name.**

- In whisper.cpp v1.7.x the CMake target is `server` (not `whisper-server`).
  `.github/workflows/release-desktop.yml` and
  `desktop-rust/scripts/fetch-whisper-bin.sh` invoked `--target whisper-server`,
  causing v1.3.3 native release to fail with
  `make: *** No rule to make target 'whisper-server'` (macOS) and
  `MSBUILD error MSB1009: whisper-server.vcxproj` (Windows).
  Fixed: build target is now `server`, binary copied from `build/bin/server`
  (macOS) / `build/bin/Release/server.exe` (Windows) and renamed to
  `whisper-server-<target-triple>` to match Tauri's externalBin convention.
- No code changes, no behavior changes — this is purely a packaging fix
  so v1.3.3's Whisper feature actually ships.

## v1.3.3 (2026-04-23)

**Whisper Voice Input — new left-sidebar tab for local voice dictation.**

- **Local transcription via whisper.cpp** — sidecar `whisper-server`
  binary, CPU by default, GPU (CUDA / Metal) auto-detected and used via
  downloaded variant when available. No network calls to third parties
  for transcription.
- **Onboarding installer** — first tab visit shows a 6-card model picker
  (tiny → small → medium → large-v3 + Q5 quantized). Progress bar with
  speed and ETA, SHA256 verify on download, atomic rename into place.
- **Lazy server lifecycle** — 0 RAM at idle. First record spawns the
  server (1-3s warm-up visible in overlay); subsequent transcripts
  return in ~200ms. Auto-unloads 5 min after last activity
  (configurable 1-30 min); **Unload now** button for instant SIGTERM.
- **Global hotkey** — `Ctrl+Alt+Space` (configurable) toggles recording
  from any focused window. Also `Ctrl+Space` inside the tab.
- **Floating overlay** — always-on-top 260×90 window in the bottom-right
  corner (configurable) shows mic-level bars, timer, state (warming →
  recording → transcribing → inserted). Draggable. Cancel ✕ button.
- **Three inject methods** (per setting): copy to clipboard only,
  clipboard + auto Ctrl+V (with original-clipboard restore after
  200 ms), or typed simulation (Unicode-safe via `enigo`).
- **Optional post-processing** — rule-based (filler removal,
  capitalize, whitespace) + external LLM API for grammar/cleanup
  (OpenAI-compatible). Both off by default, both fail-soft to raw text.
- **Two-pane history** — last 200 transcripts with copy/paste/type/
  delete per row and in-place editing.
- **Microphone selection** in settings. Language auto-detect with
  RU / EN explicit override.
- All new `#[tauri::command]` handlers use `DbState::lock_recover()`
  per CLAUDE.md §11 — no poisoned-lock cascade risk.
- Windows 10+ and macOS 12+ Apple Silicon (M2+). Intel Macs — post-MVP.

Spans `desktop-rust/src-tauri/src/whisper/` (10 Rust submodules),
`desktop-rust/src/tabs/whisper/` (6 JS/HTML files), 15 new Tauri
commands, 2 new SQLite tables, and a CI step that builds
`whisper-server` from source on `v-*` tags.

## v1.3.2 (2026-04-23)

**Root cause of the poisoned-lock wedge in v1.3.0.**

- `SyncClient::extract_display_name` was slicing names/template_text by
  BYTE index (`&val[..37]`), which panics on multibyte UTF-8 chars —
  Cyrillic letters take 2 bytes, so a note titled e.g.
  "Голосовой ввод задач и списков" crashed the sync worker the moment
  it entered the pending queue. Every subsequent app launch kept
  triggering the same panic because that note was still `pending`,
  poisoning the DbState mutex over and over and breaking the auto-
  updater. Replaced with char-based truncation (`val.chars().take(37)`)
  and added a regression test.
- v1.3.1's `lock_recover` helper already unwedged the mutex on restart
  — v1.3.2 removes the actual source of the panic.

## v1.3.1 (2026-04-23)

**Hotfix: poisoned-lock recovery + panic hook.**

- Replace 107 `state.0.lock().map_err(...)?` call sites with a
  `DbState::lock_recover()` helper that unpoisons automatically.
  Rationale: SQLite transactions are atomic, so a prior panic can't
  leave the DB in an inconsistent state — only the Rust-level guard
  flag. Previously one panic inside a command wedged every subsequent
  operation with `"poisoned lock: another task failed inside"`,
  including the `check_for_update` path — which made even the auto-
  updater unable to recover.
- `SyncClient::process_push_response` no longer `.unwrap()`s on the
  per-table rows array (was a potential panic source).
- Global `panic::set_hook` appends panic location + message to
  `<AppData>/keyboard-helper/crash.log` so we can actually see where
  something went wrong next time.

## v1.3.0 (2026-04-23)

**New module — Tasks.**

- New top-level tab **Tasks** (between Notes and SQL, icon ✅). Personal
  task manager with hierarchical checkboxes, categories, statuses,
  tracker links, card colors and full sync.
- **Cards**: collapsed shows title, Category / Status badges, tracker
  button (🎫), checkbox list (scrollable after N items — see
  `tasks_card_max_checkboxes` setting, default 10), pin marker and
  expand ▼. Expanded opens full editor for title, category/status,
  tracker URL, aux links list, background color (palette + custom),
  checkbox tree (editable), Markdown notes with toolbar, delete button.
- **Checkboxes**: max 3 levels deep. Enter = new item, Tab = nest under
  previous sibling, Shift+Tab = outdent, Backspace on empty = delete.
  Last row is a translucent `+ Add item…`.
- **Pinned chip strip** at top — click chip to jump to the task
  (auto-switches layout row if needed and opens expanded view).
- **Filter dropdowns** (Category / Status) — single-select, with `All`
  plus a `None` item that appears only when at least one task has no
  value. Right-click on a dropdown opens a Manage modal to rename,
  reorder, recolor, add or delete categories / statuses. Deleting a
  category / status doesn't delete tasks — it nulls the reference, and
  affected tasks show up under `None`.
- **Drag-and-drop** (pointer-based, works in Tauri WebView2):
  - card ⋮⋮ → dropdown: auto-opens menu after 250ms hover, drop on item
    sets task.category_id / status_id (filter itself doesn't change);
  - card ⋮⋮ → another card: reorder in the list (persisted);
  - checkbox ⋮⋮ → another row in the same task: reorder / nest (drag
    rightward by >30px to nest under the target, honoring the 3-level
    depth limit).
- **Layout toggle** — SVG button in the top-right of the filter row:
  one square = single-column list, split square = two-column row-major
  (zigzag: 1 top-left, 2 top-right, 3 left-row-2, 4 right-row-2, ...).
  Saved in setting `tasks_layout_mode`.
- **Help** — ❓ button in the tab header opens a dedicated help modal;
  sidebar Help tab also gets a new "Tasks" section (en + ru).
- **Sync** — all 5 new tables (`task_categories`, `task_statuses`,
  `tasks`, `task_checkboxes`, `task_links`) are included in the standard
  sync flow.

## 1.2.8 OTA patches

- **f-20260423-18** — Shortcuts: Copy strips Markdown code fences
  (triple-backtick blocks and single-line backtick-wraps) before writing
  to the clipboard, so pasted code doesn't carry stray `\`\`\`` markers.
- **f-20260423-18** — Markdown editor: Link button (🔗) auto-fills the
  URL from the clipboard if it looks like one (http/https/ftp/mailto/www).
  If the clipboard isn't a URL, the caret lands inside the empty `()` so
  you can type immediately — no more modal prompt.
- **f-20260423-19** — Markdown editor: paste-over-selection now creates a
  Markdown link. Select text, press Ctrl+V with a URL in the clipboard →
  get `[selected](url)`. Non-URL clipboard or empty selection paste
  behaves normally.
- **f-20260423-20** — Notes preview: numbered lists (`1. …`) now render as
  decimal `1. 2. 3.` instead of bullet circles. Removed a stray
  `.note-preview li { list-style: disc }` override that beat the
  `.markdown-body ol { list-style-type: decimal }` parent rule.
- **f-20260423-21** — Notes: non-empty notes open in Markdown preview by
  default; double-click the preview to switch to Edit. Empty/new notes
  still open in Edit mode.
- **f-20260423-21** — Notes: pinned chip strip above folders/notes panel
  (same visual style as Repo Search chips). Each chip is a pinned note
  — click to open it directly in the right panel, auto-switching folder
  if needed. Updates on save/delete.

## v1.2.8 (2026-04-23)

- Hotkey: bring main window to front on a single press when it's visible
  but behind another app. Previously the first press hid it (because it
  was still "visible") and you needed a second press to bring it back.
  Now the window is only hidden when it's visible, focused and not
  minimized — otherwise it's unminimized + shown + focused.
- SQL help modals: Ctrl + mouse wheel zooms the text; size persists in
  localStorage across sessions.

## v1.2.2 (2026-04-22)

- Manage tab: per-row **Reset** button on dirty repos — runs
  `git reset --hard HEAD` to discard uncommitted changes, with
  confirmation. Untracked files are preserved.

## v1.2.1 (2026-04-22)

- Fix "Open in editor" on Windows/macOS: spawn the editor command
  through the user's shell so PATHEXT (`code.cmd` / `code.bat`) and
  login-shell PATH are honoured. Previously direct `spawn("code")`
  failed with "program not found" even if `code` worked in a terminal.

## v1.2.0 (2026-04-22)

**Repo Search — editor integration, full-file preview, Manage tab.**

- **Open in editor** — new button on every result card opens the file
  at the match line. Configurable editor command template in
  Settings → General (`code {path}:{line}` by default; supports
  `cursor`, `subl`, `pycharm`, etc.)
- **Full-file preview** — `Expand ▸` button on result cards opens a
  fullscreen view of the file with syntax highlighting (highlight.js
  bundled, ~190 languages). 2 MB cap; ESC or `Collapse ◂` closes.
- **Manage tab** — new inner tab under the group-tab strip showing a
  per-repo git status table (branch, last commit + date, dirty flag).
  Bulk **Pull all to main** action: skips dirty repos (highlighted in
  red), falls back `main → master → origin/HEAD`. **Dry-run** checkbox
  previews the exact `git` commands before executing.
- Search input + type selector + gear now live on the Search inner
  tab; chip strip (with select-all/none) remains shared across both
  inner tabs as the scope selector.

## v1.1.0 (2026-04-21)

- Repo Search: groups — organise repos into named, colored, icon-tagged
  groups. Tab strip above the chip row filters both the visible chips
  and the search scope per-tab.
- Each active tab carries inline ✓ / ⊘ shortcuts for bulk
  select / deselect within its scope.
- Right-click on a group tab to rename, recolour, change icon, or delete
  (repos keep existing, move to Ungrouped).
- Add Repo → multi-folder select in one dialog; each folder becomes a
  new repo with auto-derived name / random color, in the currently
  active tab's group.
- Right-click on a repo chip → Edit (name / color / group) or Remove.

## v1.0.0 (2026-04-20)

**First stable release with frontend-over-the-air (OTA) updates.**

### Highlights
- **Frontend OTA:** small UI/JS/CSS changes now install in ~2 seconds without a
  full reinstall. Click the sync indicator in the status bar → "Apply" → the
  WebView reloads with the new bundle. The installer stays untouched.
- **Signed updates:** every OTA bundle is minisign-signed in CI and verified
  on the client before it touches disk (same key as the existing native
  updater).
- **Auto-rollback:** if an OTA bundle fails to boot within 30 seconds, the
  previous version is restored automatically. No way to brick the app with
  a bad frontend release.
- **Two release flows:**
  - `v*` tags — full release (native .dmg / .exe **and** frontend OTA).
  - `f-*` tags — frontend-only release (fast, skips the native build).
  - Either path is picked up by existing clients; native updater keeps
    working because we carry `latest.json` forward on frontend-only releases.
- **Script templates in Exec tab:** SCP / SSH / rsync forms with VPS
  integration, generate a command in one click.
- **Status bar:** combined `v{native}-f{sha}` label; clicking it now runs a
  sync and the update check.
- **Modal fix:** form modals keep themselves open on validation errors and
  show inline error text instead of silently dismissing.
- **Debug escape hatch:** `KH_FORCE_SHOW=1` forces the main window visible on
  startup — useful for headless testing or recovering if the global hotkey
  is unavailable.

### Infrastructure
- Dockerfile + `dev-docker.sh` for headless Linux builds.
- Browser mock (`dev.html` + `dev-mock.js`) for offline UI development,
  covering ~95 Tauri commands.
- CDP-based smoke tests (`dev-test.py`) — 7 automated checks across the
  Exec modal fix and SCP template flow.

## v0.9.0 (2026-04-15)
- New tab: VPS Management — monitor remote servers via SSH
- Dashboard: CPU, RAM, Disk usage with color-coded progress bars
- Named colored server chips with auto-refresh (configurable per server)
- SSH key file support, custom ports, connection testing

## v0.8.8 (2026-04-15)
- Fixed Commits: history dropdown preserves selection, tag creation works
- Reset button clears history selection

## v0.8.7 (2026-04-15)
- Rewritten Commits tab to match Python logic
- Commit types/categories match Python version
- Task ID auto-parsed from tracker URLs (tracker.wb.ru, etc.)
- Real-time commit and chat message previews
- Conditional fields: reports (test/prod/connect) for отчет, test dag for даг

## v0.8.6 (2026-04-10)
- Fixed sync: LWW (Last Write Wins) by updated_at — prevents pull from overwriting newer local changes
- Added tag clear button (×) to reset snippet tag filter
- Markdown rendering in Description section

## v0.8.5 (2026-04-10)
- Fixed Windows build: removed .cxx build artifacts with too-long paths

## v0.8.3 (2026-04-07)
- Nested folders in Notes: tree view with expand/collapse, sub-folder creation, arbitrary depth
- Expandable note cards: hover handle to preview content without opening editor
- Expandable snippet cards: same pattern in Shortcuts tab
- Redesigned Notes styling: refined tree connectors, pin dots, editor typography
- Auto markdown preview when opening notes with markdown content
- Fixed ordered list rendering in markdown (explicit list-style-type)
- Card expand height configurable in Settings → Shortcuts

## v0.8.0 (2026-04-07)
- Status bar at bottom of window: sync status (left) + update status (right)
- Sync: pulsing dot indicator, click for sync log popup
- Updates: shows current version, available update, click to download or re-check
- Replaced sidebar sync indicator and top update banner
- Smart markdown rendering in snippets (auto-detect markdown content)
- Modal no longer closes on overlay click (only Cancel/X/Escape)

## v0.7.5 (2026-04-07)
- Fixed repo search: sort now preserves card format (content/git cards no longer collapse to single lines)
- Added edit/add repos in settings panel (gear icon)
- Fixed repo chips bar not rendering on first load

## v0.7.3 (2026-04-06)
- Added markdown toolbar for content textareas (Bold, Italic, Code, Link, List, Table, etc.)
- Toolbar appears in Notes editor and Snippet edit modal

## v0.7.2 (2026-04-06)
- Upgraded markdown preview: full parser with tables, code blocks, GFM, task lists
- Custom marked.js bundled locally (headers, bold, italic, strikethrough, nested lists, blockquotes, images)
- Added .markdown-body CSS styles for dark theme

## v0.7.0 (2026-04-06)
- New tab: Repo Search — search across local git repositories
- Search by filename (glob), file content (ripgrep/grep/Rust fallback), git history
- Named colored repos with toggle chips (Design B: bold + color bar)
- Results grouped by file with context on click
- Tab auto-unloads after configurable timeout (default 10 min)

## v0.6.3 (2026-04-05)
- Added sync status indicator in sidebar (syncing/ok/error)
- Sync log popup with detailed push/pull results (click indicator to view)
- Each sync shows what was pushed/pulled with record names

## v0.6.1 (2026-04-05)
- Obsidian integration: create, link, and view notes from snippets
- Main/Web/Note toggle in snippet detail panel
- Markdown rendering for Obsidian notes
- Settings: Obsidian vaults path (per machine)

## v0.5.3 (2026-04-05)
- New app icon: H4 Cyan {K} on purple-blue gradient
- Fixed global font size setting
- Added Always on Top toggle in Settings → General
- Snippet tags sync via API (server migration applied)
- Language setting (English/Russian) for Help

## v0.5.1 (2026-04-05)
- Added Help modal (?) with Features, Hotkeys, and Changelog tabs
- Multi-language support (English/Russian)
- Changelog embedded from CHANGELOG.md at build time

## v0.5.0 (2026-04-03)
- Redesigned links: Main/Web toggle, inline link chips, embedded iframe viewer with fallback
- Links open in Web tab inside the app, with "Open in browser" option

## v0.4.3 (2026-04-03)
- Security cleanup: removed sensitive docs from repository

## v0.4.2 (2026-04-03)
- Fixed tag creation (camelCase parameter naming)

## v0.4.1 (2026-04-03)
- Added snippet links: attach URLs to snippets, view in WebView window
- Tabbed bottom section: Description | Links
- API migration for links field
- Synced links across devices

## v0.4.0 (2026-04-03)
- Added snippet tags: colored filter presets for shortcuts
- Glob pattern matching (e.g. `af_*`)
- Tag management modal with color picker
- Tags synced across devices

## v0.3.3 (2026-04-03)
- Fixed independent scrolling: left panel, value block, and description scroll separately

## v0.3.0 (2026-04-03)
- Redesigned Shortcuts tab: two-panel layout (name list + detail view)
- Collapsible description section with filled/empty badge
- Font size from settings

## v0.2.9 (2026-04-03)
- Fixed sync: proper null handling for last_sync_at
- Fixed user_id population from auth on pull

## v0.2.6 (2026-04-03)
- Added Updates tab in Settings: version check, GitHub token for private repos
- Debug Sync diagnostics
- Update notification banner

## v0.2.5 (2026-04-03)
- Fixed autostart on Windows (registry-based)
- Added update UI and notification banner

## v0.2.4 (2026-04-03)
- Fixed close to tray (X button hides instead of quitting)
- Tray icon click shows window
- Auto-sync on window show

## v0.2.2 (2026-04-02)
- Fixed register and health check via Rust IPC

## v0.2.0 (2026-04-02)
- Added auto-updater plugin
- Optimized CI: macOS ARM + Windows only, thin LTO
- Signing key for update artifacts

## v0.1.3 (2026-04-02)
- Fixed global-shortcut plugin config crash on Windows

## v0.1.0 (2026-04-02)
- Initial release
- 6 tabs: Shortcuts, Notes, SQL Tools (5 sub-tabs), Superset, Commits, Exec
- Global hotkey (Alt+Space native, Double Shift/Ctrl polling)
- System tray with hide/show
- SQLite database with sync to remote API
- Dark theme (GitHub Dark inspired)
- Lazy tab loading
- Settings with 6 sub-tabs
- Autostart support (Windows, macOS, Linux)

## Archived tags without dedicated release notes

These historical tags exist in git, but no dedicated user-facing text was
captured in the project changelog at the time. They are listed here so the Help
history represents every released tag.

### Frontend OTA tags

- `f-20260420-1`
- `f-20260421-2`, `f-20260421-3`, `f-20260421-4`, `f-20260421-5`
- `f-20260422-6`, `f-20260422-7`
- `f-20260423-8`, `f-20260423-9`, `f-20260423-10`, `f-20260423-11`,
  `f-20260423-12`, `f-20260423-13`, `f-20260423-14`, `f-20260423-15`,
  `f-20260423-16`, `f-20260423-17`
- `f-20260428-2`
- `f-20260429-1`, `f-20260429-2`, `f-20260429-3`, `f-20260429-4`,
  `f-20260429-5`
- `f-20260430-1`, `f-20260430-2`, `f-20260430-3`, `f-20260430-4`,
  `f-20260430-5`, `f-20260430-6`, `f-20260430-7`, `f-20260430-8`,
  `f-20260430-9`, `f-20260430-10`, `f-20260430-11`, `f-20260430-12`,
  `f-20260430-13`

### Native tags

- `v0.1.1`, `v0.1.2`
- `v0.2.1`, `v0.2.3`, `v0.2.7`, `v0.2.8`
- `v0.3.1`, `v0.3.2`
- `v0.5.2`
- `v0.6.0`, `v0.6.2`
- `v0.7.1`, `v0.7.4`, `v0.7.6`
- `v0.8.1`, `v0.8.2`, `v0.8.4`
- `v0.9.1`, `v0.9.2`, `v0.9.3`, `v0.9.4`, `v0.9.5`, `v0.9.6`,
  `v0.9.7`, `v0.9.8`, `v0.9.9`, `v0.9.10`
- `v1.2.3`, `v1.2.4`, `v1.2.5`, `v1.2.6`, `v1.2.7`
