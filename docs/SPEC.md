# Drops Chat — Full Product & Build Specification

Version 1.0 · 24 Nov 2026 · Owner: Muiz
Design reference: `design/Chat-prototype.html` (layout, colours, type, interactions are the spec).

> **For Claude Code:** Build in the phases at the end of this document. One pull request per phase. Do not start a phase until the previous one is merged, unless told otherwise. Where this spec is silent, choose the simplest option that fits the design reference and note the decision in the PR.

---

## 0. Product summary

A private chat app for two people (expandable to small groups later). It replaces plain WhatsApp-style messaging with:

- **Tabs**: several parallel conversations with the same person.
- **Drops**: interactive cards dropped into a chat (games, reflections, tools).
- **Session Drops**: full-screen shared experiences, starting with a Personality Test.
- **Work mode**: a calmer tab style for serious collaboration, with shared documents and commenting.
- Effects, streaks, scrapbook, voice notes, search, export.

Platform: installable web app (PWA) for iPhone (Add to Home Screen) and Android, later wrapped as native apps with Capacitor without a rewrite.

---

## 1. Tech stack & principles

- **Frontend:** Vite + TypeScript + Preact (or vanilla TS). Mobile-first. No heavy UI framework.
- **Backend:** Firebase — Auth, Firestore, Storage, Cloud Functions (2nd gen), Cloud Messaging (web push), Hosting.
- **Dev:** Firebase Emulator Suite for all development and tests. Security-rules unit tests are required for every feature that touches data access.
- **Config:** `src/firebase.config.ts` stays a placeholder for the owner to fill in.
- **Time zone:** all "day" logic uses `Indian/Maldives` (stored per room as `room.timezone`, default `Indian/Maldives`).
- **Accessibility:** real buttons, labels on inputs, 44px touch targets, 4.5:1 text contrast, `prefers-reduced-motion` respected everywhere.
- **Privacy note (show in Settings → About):** "Messages are protected by access rules but are not end-to-end encrypted."
- **Costs:** Blaze plan required for Storage and Functions. README must include setting a budget alert ($1–$5).

### Design tokens (from prototype)
| Token | Value |
|---|---|
| Me / primary | `#2F5BEA` |
| Other person | `#F2A15F` (text on it: `#16181D`) |
| Ink | `#16181D` |
| Ground | `#F5F6FA` |
| Surface | `#FFFFFF` |
| Border | `#E3E5EC` |
| Muted text | `#5B606B` |
| Warm note bg / text | `#FFF4EA` / `#6B4A2E` |
| Headings | Space Grotesk 500/700 |
| Body | Inter 400/500/600 |

---

## 2. Data model (Firestore)

```
users/{uid}
  displayName, photoURL, createdAt
  settings: { quietHours: {enabled, start:"21:00", end:"07:00"}, reduceMotion, readReceipts }
  fcmTokens[]                      // push tokens

rooms/{roomId}
  members: [uidA, uidB]
  createdAt, timezone
  mood: { [uid]: "sunny"|"cloudy"|"foggy"|"stormy" }
  streak: { count, lastBothActiveDay, missedDays, best, updatedAt }   // server-only
  activity: { [YYYY-MM-DD]: { [uid]: true } }                          // server-only

rooms/{roomId}/tabs/{tabId}
  name, colour, wallpaper, mode: "casual"|"work", disappearing: bool,
  archived, order, createdBy, createdAt, lastMessageAt

rooms/{roomId}/tabs/{tabId}/messages/{msgId}
  senderId, createdAt, editedAt?, type: "text"|"link"|"photo"|"voice"|"drop"|"system"|"doc"
  text?, replyTo?: { msgId, snippet, senderId }
  effect?: { screen?: "confetti"|"balloons"|"fireworks", bubble?: "shout"|"whisper"|"slow"|"spotlight"|"sealed" }
  link?: { url, title, description, image, siteName }
  photo?: { storagePath, width, height, thumbPath }
  voice?: { storagePath, durationMs, waveform: number[] }   // ~64 normalised samples
  dropId?
  reactions: { [emojiOrCode]: [uid] }
  phraseReactions: [{ uid, start, end, reaction }]
  hiddenFor: [uid]                  // delete-for-me
  deleted: bool                     // delete-for-everyone
  scheduledFor?: timestamp          // only on scheduled docs (see 3.7)
  expiresAt?: timestamp             // disappearing tabs (TTL policy)

rooms/{roomId}/tabs/{tabId}/drops/{dropId}
  kind, createdBy, createdAt, status: "open"|"locked"|"done"
  config: {...}                     // public definition (questions, scenes, list items)
  public: {...}                     // shared state visible to both
rooms/{roomId}/tabs/{tabId}/drops/{dropId}/private/{uid}
  answers: {...}                    // hidden answers, only owner can read until reveal
rooms/{roomId}/tabs/{tabId}/drops/{dropId}/reveal/{uid}
  answers: {...}                    // copied by a Cloud Function when BOTH have locked in

rooms/{roomId}/scheduled/{schedId}  // pending scheduled messages
  senderId, tabId, payload, sendAt, status: "pending"|"sent"|"cancelled"

rooms/{roomId}/pins/{pinId}
  tabId, sourceType: "message"|"drop"|"photo"|"doc", sourceId, title, detail, pinnedBy, createdAt

rooms/{roomId}/docs/{docId}         // Work mode documents
  title, tabId, createdBy, createdAt, updatedAt, status: "draft"|"review"|"final"
  sections: [{ id, heading, order }]
rooms/{roomId}/docs/{docId}/blocks/{blockId}
  sectionId, order, type: "p"|"h2"|"list"|"quote"|"todo", text, updatedBy, updatedAt, lockedBy?
rooms/{roomId}/docs/{docId}/comments/{commentId}
  blockId, anchor: { start, end, quote }, authorId, text, createdAt, resolved, parentId?
rooms/{roomId}/docs/{docId}/versions/{versionId}
  snapshot, createdBy, createdAt, label

rooms/{roomId}/sessions/{sessionId} // Session Drops (full-screen tests)
  kind: "type-test"|..., tabId, createdBy, createdAt, status, progress: { [uid]: answeredCount }
rooms/{roomId}/sessions/{sessionId}/private/{uid}   // raw answers
rooms/{roomId}/sessions/{sessionId}/results/{uid}   // written by function after both finish
```

### Security rules (must be tested)
- Only `room.members` can read/write anything under a room.
- Users write only their own `private/{uid}` docs; nobody else can read them.
- `reveal/*` and `results/*`, `room.streak`, `room.activity` are **Cloud Function-only** (clients cannot write).
- Message edits: only the sender, only `text`/`editedAt`, only within 15 minutes of `createdAt`.
- `hiddenFor`: a user may add/remove only their own uid.
- Delete for everyone: only the sender; must set `deleted:true` and clear content fields.
- Scheduled messages: only the sender may create/cancel; the function sends them.

---

## 3. Core chat features

### 3.1 Messaging basics
Real-time text messages, typing indicator, online presence, read receipts (toggle in settings), date dividers, auto-scroll to newest, unread badge per tab.

### 3.2 Bubble actions (long-press)
Long-press (or right-click on desktop) opens a bottom sheet:
**Reply · React · Copy · Pin · Edit (own, ≤15 min) · Select · Delete**
- **Copy**: copies text (or link URL) to clipboard, toast "Copied".
- **Select**: enters multi-select mode with tick circles on each bubble; a bar shows *Copy · Pin · Delete* for the selection.
- **React**: a row of 6 quick reactions + "Phrase react" (see 3.4).

### 3.3 Delete
- **Delete for me** (any message): adds uid to `hiddenFor`. Instant, undo toast for 5 seconds.
- **Delete for everyone** (own messages only): a second confirmation screen — *"Delete for everyone? This removes it from both chats and can't be undone."* with a red confirm button. Soft delete: clear `text/link/photo/voice`, set `deleted:true`, bubble shows *"Message deleted"* in muted italics. Cloud Function deletes any Storage files.
- Multi-select supports both options; "for everyone" only enabled if all selected are own messages.

### 3.4 Reply-quote, edit, phrase reactions
- **Reply**: shows a quoted strip (sender colour bar + snippet) above the composer and inside the sent bubble; tapping the quote scrolls to and highlights the original.
- **Edit**: within 15 minutes; bubble shows "edited" label; edit history is not kept.
- **Phrase reactions**: select a span of text in a bubble → react to that phrase; the phrase gets a subtle underline and a small reaction chip.

### 3.5 Links & photos
- **Link previews**: a callable Cloud Function `unfurl(url)` fetches Open Graph tags (timeout 4s, cache by URL in Firestore for 7 days). Card: image, site name, title, description. Video sites (YouTube, Vimeo, Netflix) show a play badge and a "Start a Feeling Map" action.
- **Photos**: pick from camera/library, compress client-side to max 1600px long edge (JPEG/WebP ~0.8), also generate a 400px thumbnail. Full-screen viewer with pinch-zoom, swipe to dismiss, *Pin to scrapbook* and *Save*.

### 3.6 Voice notes
- Hold the mic button to record (slide to cancel), or tap to lock recording. Max 3 minutes.
- Encode as AAC/Opus (whatever the browser supports; fall back gracefully), upload to Storage.
- Compute a 64-point waveform on the client and store it.
- Bubble: play/pause, waveform with progress, duration, playback speed 1×/1.5×/2×.
- **Timestamped reactions**: while listening, tap the waveform to drop a reaction at that moment; reactions show as small markers above the waveform.

### 3.7 Scheduled messages
- Long-press Send → *Schedule…* → quick picks (Tonight 8pm, Tomorrow 8am, Next Monday 9am) or a date/time picker (room timezone).
- Stored in `rooms/{roomId}/scheduled`. Sender sees a "Scheduled" strip above the composer listing pending items with *Edit · Send now · Cancel*.
- A Cloud Function scheduled every minute sends due items as normal messages (with any effect attached).

### 3.8 Tabs
- Horizontal tab bar under the header: each tab shows a colour dot, name and unread count. "+" creates a tab.
- Default tab: **General**. Tab sheet: rename, colour, wallpaper, mode (Casual/Work), disappearing on/off, archive.
- Drops, docs and sessions belong to a tab. Scrapbook, search and streak are room-wide.
- Archived tabs live under *Archived* at the end of the tab bar.

### 3.9 Disappearing tabs
- Toggle per tab. When on, new messages get `expiresAt = createdAt + 24h`.
- Use a Firestore TTL policy on `expiresAt`, plus a Cloud Function cleanup for Storage files.
- Tab shows a small timer icon; a system message announces when it's turned on/off.
- Pinned items from a disappearing tab are copied into the scrapbook (so pins survive).

### 3.10 Themes per tab
- Accent colour (8 presets that pass contrast checks) and wallpaper (6 subtle patterns + solid colours + a user photo, dimmed for legibility).
- Accent recolours the tab dot, own bubbles and primary buttons in that tab only.

### 3.11 Search
- Search across all tabs: messages, link titles, Drop titles/answers once revealed, pins and document text.
- Client-side index (e.g. MiniSearch) built from the cached data the user can access; results grouped by tab with jump-to.
- Filters: tab, type (text, photo, link, voice, drop, doc), person, date range.

### 3.12 Export
- Export a tab or the scrapbook as **PDF** (rendered print view: header with tab name and date range, messages with sender colours, photos as thumbnails, Drops summarised as result cards) or **ZIP archive** (JSON of messages + media files).
- Done on the client from the user's own visible data; deleted-for-me messages excluded.

### 3.13 On This Day
- Daily (morning, room timezone), a Cloud Function looks for messages, photos or pins from the same date 1, 2, 3… years ago.
- If found, it posts a special card in the General tab: *"On this day, 1 year ago"* with the item and a *Pin* button. Never for deleted or hidden items. Can be turned off in room settings.

### 3.14 Quiet hours
- Per-user setting (default 21:00–07:00, editable). During quiet hours, push notifications to that user are held and delivered as one summary at the end ("3 messages from …").
- The other person sees a small moon icon by the name during the quiet hours, with "Notifications paused".
- Exception: a user may mark a message *Urgent* (long-press Send) which bypasses quiet hours — max 3 per day.

### 3.15 Mood weather
Each user sets Sunny / Cloudy / Foggy / Stormy (with short descriptions from the prototype). Shown under the name instead of "online".

### 3.16 Scrapbook
Room-wide board of pinned messages, photos, Drop results and doc snapshots, each labelled with its tab and date. Grid view with filters; tap opens the source. Monthly **Rewind** card (see Drops) draws from it.

### 3.17 Hot streak
- A day counts when **both** members send at least one message or Drop/Session action in any tab (room timezone).
- Streak survives up to 2 consecutive missed days; on the **3rd consecutive missed day** it resets to 0 (keep `best`).
- On the 2nd missed day, push both: *"Your streak ends tomorrow — say hi."*
- Milestones 7 / 30 / 100 / 365 days trigger a special screen effect for both and a pin in the scrapbook.
- Computed only by a daily scheduled Cloud Function (00:05 room time) from `room.activity`; activity is recorded by a Firestore trigger on new messages. Clients cannot write streak fields.
- Header shows a custom flame icon with the count; tap for a small sheet: current, best, today's status (*You ✓ · Them ✓/pending*).

---

## 4. Effects

### 4.1 Screen effects (play once on both phones on arrival; tap message to replay)
| Effect | Concept |
|---|---|
| **Confetti** | Burst from the bubble, falls across the screen for ~2.5s. |
| **Balloons** | 8–12 balloons float up from the bottom; tapping one pops it (small burst). |
| **Fireworks** | Screen dims, 3–5 bursts, ~3s. |
| **Glow** (extra) | Soft warm glow pulses from the bubble — for thank-yous. |

### 4.2 Bubble effects (chosen via long-press on Send → Effects)
| Effect | Concept |
|---|---|
| **Shout** | Large text, quick scale-up and shake on arrival. |
| **Whisper** | Small, blurred text; revealed only while pressing and holding. |
| **Slow reveal** | Types itself out letter by letter. |
| **Spotlight** | Dims the rest of the chat, highlights the bubble for 2s. |
| **Sealed** | An envelope bubble; tap to open and show the message. |
| **Echo** (extra) | Text appears with 2 fading echoes behind it. |

- Keyword suggestions ("congrats", "happy birthday", "thank you", "well done") show a small suggestion chip above the composer; never auto-applied.
- Effects are canvas/CSS based, GPU-friendly, 60fps target. With reduced motion, show a static badge ("sent with Confetti") instead.
- Work-mode tabs: effects off by default (can be enabled per tab).

---

## 5. Drops (inline interactive cards)

### 5.1 Drop framework (build this first)
Each Drop is a self-contained module in `src/drops/<kind>/` exporting:
```ts
export const definition = {
  kind: "feeling-map",
  title: "Feeling Map",
  description: "Plot how each scene felt",
  category: "reflect" | "play" | "decide" | "create" | "plan",
  hiddenAnswers: true,          // uses private/ + reveal/ flow
  configSchema: {...},          // JSON schema for config
};
export function Render(props: { drop, me, other, actions }) {...}
export function summarize(drop): { title, detail }   // used for pins, search, export
```
- A registry auto-loads every folder in `src/drops/`. Adding a Drop = adding one folder. Document in `docs/ADDING_A_DROP.md`.
- **Hidden-answer flow (shared):** each user writes to `private/{uid}`; when both have `locked:true`, a Cloud Function copies both to `reveal/{uid}` and sets `status:"locked"`. The UI then shows both answers. Neither user can read the other's answers before that, enforced by rules.
- **Claude-made Drops:** a Drop can also be created from a JSON definition pasted by the owner (Settings → Drops → *Add from code*). Only built-in kinds can be instantiated this way (the JSON fills `config`); no arbitrary code is executed. Owner can enable/disable Drops in the tray.
- Every Drop card has a footer: *Pin to scrapbook* and a ⋯ menu (*Close Drop · Delete*).

### 5.2 Drop catalogue (build all)
| # | Drop | Category | How it works |
|---|---|---|---|
| 1 | **Feeling Map** | reflect | Scenes list (from config, e.g. a film). Each person taps a 2-axis mood grid (Heavy↔Uplifting, Calm↔Intense) per scene, hidden until both lock; overlay shows both dots and a gap rating; summary highlights the scene where you differed most. |
| 2 | **Blind Reveal** | reflect | One question, each answers privately (text), both flip together. |
| 3 | **Gap Slider** | reflect | A statement; each sets a 0–100 slider privately; reveal shows both markers and the gap with a prompt. |
| 4 | **Tag-team Story** | create | Alternate one line each up to N lines (default 8); optional "twist card" every 3 lines from a twist list. Finished story renders as a page. |
| 5 | **Two Truths & a Lie** | play | Author writes 3 statements and marks the lie privately; the other taps their guess; reveal + score. |
| 6 | **Predict Me** | play | You predict the other's answer to a question, they answer; scores accumulate into a room-level "How well do you know each other" meter. |
| 7 | **Rank It** | decide | Same list for both (e.g. 5 films); each drags into their own order privately; reveal shows both rankings side by side and agreement %. |
| 8 | **Decision Wheel** | decide | Both add options; spin animation (synced via a server-chosen seed); result posted as a message. |
| 9 | **Watch Party** | reflect | While watching the same film/show separately or together, each taps reaction buttons on a timeline (Start → minutes elapsed); afterwards both strips line up to show shared moments. |
| 10 | **Countdown** | plan | Shared countdown to a date/event; both can add notes; on the day it posts a celebration with confetti. |
| 11 | **Rewind** | reflect | Auto-generated monthly card: most active tab, number of Drops, biggest gap, top pins, streak. Can also be dropped manually. |
| 12 | **Poll** | decide | Question + up to 6 options; votes visible after both vote (or live, chosen at creation). |
| 13 | **This or That** | play | Rapid round of 10 pairs with a 5-second timer each; reveal shows matches. |
| 14 | **Time Capsule** | plan | A message sealed until a chosen date; shows a locked card with the open date; the function unseals it. |
| 15 | **Mood Check** | reflect | Each picks a mood + optional one-line note; hidden until both answer; good for daily check-ins. |
| 16 | **Ask Claude** *(feature-flagged)* | create | Ask a question or "summarise this tab"; calls the Anthropic API via a Cloud Function. **Off by default**; requires the owner to add an API key secret. Show cost note in settings. |

### 5.3 Interactive extras (not Drops, but in scope)
- **Thread tiles:** long-press a message → *Start a thread*; side discussion folds into a tile in the chat that expands into its own view.
- **Phrase reactions** (3.4) and **timestamped voice reactions** (3.6).

---

## 6. Session Drops (full-screen shared experiences)

### 6.1 Session framework
- Launched from the Drop tray (*Sessions* section). Creates `rooms/{roomId}/sessions/{id}` and posts a card in the chat: *"Muiz started a Type Test — Join"*.
- Opens **full screen** (hides chat chrome) with its own header: progress for both people (*You 12/24 · Them 9/24*), Pause, Exit.
- Each person answers at their own pace; answers stored in `private/{uid}`. Live presence shows when the other person is in the session.
- When both finish, a Cloud Function scores and writes `results/{uid}` and triggers the **reveal sequence** (full-screen, animated, step-by-step).
- The chat card updates to the result summary; results can be pinned.
- **Test engine:** a generic engine that runs any test defined in JSON (`src/sessions/tests/<id>.json`): question list, answer format (A/B, Likert 1–5, card sort), scoring dimensions, result profiles, reveal script, and comparison prompts. New tests = new JSON file.

### 6.2 Type Test (MBTI-style) — first Session Drop
- Name in UI: **"Type Test"** with subtitle "Inspired by the four-letter personality types". Do **not** use the MBTI® name or official questions; write original questions. Footer note: "For fun and conversation, not a clinical or official assessment."
- 32 original A/B questions, 8 per dimension: E/I, N/S, T/F, J/P. Each answer weights one side; show progress and allow going back.
- Reveal sequence (one screen each, tap to continue):
  1. Both four-letter types flip over side by side with a short profile name.
  2. Four scale bars with both markers (circle = me, square = them; never colour alone).
  3. "Where you match" and "Where you differ" cards.
  4. Three conversation prompts tailored to the differences (from the JSON).
  5. *Pin result* · *Talk about it* (returns to chat with a prompt pre-filled).
- Retake allowed; history kept so you can see changes over time.

### 6.3 Future Session tests (build the engine so these are JSON-only)
- **Big Five snapshot** (Likert, 5 traits; better research grounding).
- **Work Style** (planner/improviser, solo/collab, detail/big-picture) — good for Work-mode tabs.
- **Conflict Style** (five common styles).
- **Appreciation Styles** (how each prefers to receive thanks; avoid trademarked names).
- **Values Card Sort** (drag 20 values into Most/Somewhat/Least; compare top 5).
- **How Well Do You Know Me** (one person answers about themselves, the other predicts; scored).

---

## 7. Work mode (serious collaboration style)

### 7.1 Work tab style
- Any tab can be set to **Work** mode. Visual changes: neutral grey-blue palette, no wallpaper, compact bubbles, no screen/bubble effects by default, Drops tray shows *decide/plan* Drops first (Poll, Rank It, Decision Wheel, Countdown).
- Work tab header has a **Docs** button and a **Tasks** strip (optional; see 7.4).

### 7.2 Doc Drop — build a document together
- *New doc* creates `rooms/{roomId}/docs/{docId}` and posts a doc card in the tab (title, status, last edited, section count).
- Opens a full-screen editor:
  - Title, sections with headings, blocks (paragraph, heading, list, quote, to-do).
  - **Real-time co-editing at block level**: each block shows who's editing (coloured caret badge); a block being edited by the other person is soft-locked for 10s after their last keystroke. (Keep it simple; no full CRDT in v1.)
  - **Comments**: select text → *Comment*. Stored with an anchor (block, offsets, quoted text). Comment rail on the right (desktop) or bottom sheet (mobile). Reply, resolve, re-open. Unresolved count on the doc card.
  - **Suggest mode** (v1.1): edits shown as suggestions the other can accept/reject.
  - **Status**: Draft → In review → Final, shown on the card.
  - **Versions**: *Save version* with a label; restore or compare (simple text diff).
  - **Export**: PDF, Markdown, .docx (use a client library such as `docx`).
- Doc activity (new comment, status change) posts a quiet system message in the tab.

### 7.3 Comment on a file
- Upload a PDF or image to a Work tab → **Review Drop**: page viewer where both can drop numbered comment pins on any spot; threaded replies; resolve. Summary of open comments on the card.

### 7.4 Tasks strip (optional, v1.1)
- Turn any message or comment into a task (*Make task*): title, owner, due date. Tasks list per Work tab; due reminders respect quiet hours.

---

## 8. Notifications
- FCM web push, permission requested from an explicit button (iOS requires a user gesture and Home Screen install).
- Types: new message (grouped per tab), Drop needs your answer, both locked in (reveal ready), session finished, streak warning, scheduled message sent, On This Day, doc comment.
- Quiet hours and per-tab mute respected. Notification text never includes hidden answers.

---

## 9. Settings
Profile · Quiet hours · Read receipts · Reduce motion override · Notifications per type · Tabs management · Drops (enable/disable, *Add from code*) · Ask Claude (API key, off by default) · Export · About & privacy note · Sign out.

---

## 10. Testing & quality
- Unit tests for scoring (tests, gap ratings, rankings), streak calculation (including 3-missed-day reset and timezone edges), scheduler, and the Drop registry.
- Security-rules tests for every rule in section 2.
- Playwright smoke test of the main flows on a mobile viewport against the emulators.
- Lighthouse PWA check passes; app works offline for reading cached messages.

---

## 11. Build phases (one PR each)

1. **Foundation**: project setup, auth (Google + email link), invite flow for the second member, rooms, tabs, real-time text messaging, typing, presence, design tokens, PWA install + iPhone install guide in README.
2. **Message actions** ✅ done: long-press sheet, copy, select mode, reply-quote, edit (15 min), delete for me, delete for everyone (2-step), reactions, phrase reactions.
   - Built together with **many contacts** (one private two-person chat per contact, a chat list, invite by share link or e-mail). Group chats (3+ people in one room) are deliberately left for later.
3. **Media** ✅ done: photos (compress + viewer with swipe, zoom, save), link previews (function), voice notes with waveform and timestamped reactions. Voice notes are capped at 2 minutes rather than 3.
4. **Tab features** ✅ done: themes, disappearing tabs (TTL), mood weather, scrapbook, search, export (PDF/ZIP).
   - Disappearing tabs offer 24 hours, 7 days or 90 days (not only 24 h). Search runs on the phone over the latest 2,000 messages per chat (no MiniSearch dependency) and also works across all chats; filters are kind-based (photos, links, voice, Drops). PDF export uses the browser's print engine.
5. **Effects & timing** ✅ done: screen and bubble effects, keyword suggestions, scheduled messages ✅, quiet hours ✅ (with Urgent), push notifications ✅. Also done early: message ticks, read-receipts toggle, retry for refused messages, mute for a while.
   - Effects: all four screen effects and all six bubble effects from §4. Whisper reveals on a tap for 5 seconds (press-and-hold already opens the message menu). Replays come from the small "🎉 Confetti · replay" label under the bubble rather than tapping the bubble itself. Bubble effects send as plain text, so a sealed link shows no preview card. Work tabs (Phase 10) will start with effects off; the check is in place, the per-tab switch comes with work mode.
6. **Drop framework + first Drops**: registry, hidden-answer flow, Feeling Map, Blind Reveal, Gap Slider, Tag-team Story, `ADDING_A_DROP.md`, *Add from code*.
7. **Remaining Drops** ✅ done: 5–15 from the catalogue (except Rewind, which comes with Phase 8), thread tiles, plus a **Today's question** Drop.
   - Decision Wheel needs no server: the result is derived from the options' ids, so both phones land on the same one; it shows in the card rather than as a separate message. Countdown celebrates on the day with confetti in the card (no separate message). Poll always hides votes until both have voted (no "live" mode). Predict Me scores each card (no room-wide meter yet). Time Capsule opens on the chosen date with no function: the rules refuse the other person's "open" before then.
   - Today's question: one of ~60 gentle questions a day per chat, dropped into General by whichever phone opens the chat first (a fixed id per day, so it's never doubled), with a banner until both have answered. Each person can turn it off per chat in the contact profile.
   - Threads are a `replies` subcollection under the message; the root carries a small `thread` summary (count, last reply) written in the same batch. Unread is per phone.
8. **Streak & memories**: hot streak, milestones, On This Day, Rewind.
9. **Session framework + Type Test**: full-screen engine, JSON test format, Type Test with reveal sequence.
10. **Work mode**: Work tab style, Doc Drop (co-editing, comments, versions, export), Review Drop for PDFs/images.
11. **Optional**: Ask Claude Drop (feature-flagged), Tasks strip, suggest mode, extra Session tests, Capacitor wrap for TestFlight/Play testing.

For each PR: summary, screenshots at 390×844, what the owner must configure, and any decisions taken where this spec was silent.
