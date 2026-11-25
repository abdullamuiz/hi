# Scaling plan: making Hi lighter on the database

**Status:** parked. The owner asked to keep things as they are until more users are invited. When that happens,
ask Claude to "lighten the database" and point it at this file.

## Why

On the Blaze plan nothing stops working, but past the free daily allowance Firestore starts billing. The free
allowance is 50k reads, 20k writes and 20k deletes a day, plus 1 GiB stored. Rough estimate from Nov 2026, per
active user per day:

| | Reads | Writes |
|---|---|---|
| Heavy user (about 10 app opens, about 100 messages) | about 1,500 | about 600–800 |

That puts the free tier at about **25–35 heavy daily users**, **75–150 normal daily users**, or **a few hundred
light users**. Past that, 100 heavy daily users cost roughly **$3–8 a month**. Before changing anything, check the
real numbers in the Firebase console (**Usage and billing**, or **Firestore → Usage**).

The four changes below should roughly **double** how many users fit in the free tier.

## The four changes

### 1. Update "online" less often
- **Now:** `src/ui/Chat.tsx` (presence heartbeat effect, around line 280) calls `heartbeat()` from
  `src/data/rooms.ts` every **60 s** while the app is visible. That's one write per minute per open chat.
- **Change:**
  - Beat every **3–5 minutes**, plus once on `visibilitychange` → visible and once when a chat opens.
  - Widen the "online" window in the UI to match (online = lastSeen within ~6 min, else "last seen …").
  - Write presence to one doc per user (e.g. `users/{uid}.lastSeen`), not one per room. Then a user in 5 chats
    costs 1 write instead of 5, and chats read it from the partner's profile.

### 2. Throttle the typing signal
- **Now:** `setTyping()` in `src/data/rooms.ts` writes `typingUntil = now + 6 s` to `members/{uid}`. The composer
  calls it while typing.
- **Change:**
  - At most **one write every 4–5 s** while typing: only rewrite when the stored `typingUntil` is under 2 s away.
  - One clear on send or blur.
  - Never write when the partner isn't in the chat. If the partner's `lastSeen` is older than ~2 min, skip typing
    writes completely.

### 3. Load fewer messages when a chat opens
- **Now:** `watchMessages` in `src/data/messages.ts` listens to `limitToLast(300)` per tab, and up to `1500` for a
  search jump window.
- **Change:**
  - Open with the last **40–50** messages.
  - Load older pages on scroll-up with `endBefore(oldest)` + `limitToLast(50)`, as one-off `getDocs`, not
    listeners.
  - Keep the live listener only on the newest page.
  - The search-jump window should page instead of listening to 1500. This also fixes the known
    "message more than ~1,500 back isn't available" jump issue.

### 4. Stop listening to chats you aren't looking at
- **Now:** the Chats screen and various hooks keep real-time listeners per room: rooms, members, tabs/unread,
  memories/days, pins, drops, scheduled.
- **Change:**
  - **Chats list:** listen only to `rooms` where you're a member. That one query already carries
    `room.lastMessage`/`lastMessageAt`. Work out unread from `room.lastMessageAt` vs your private `reads` doc
    instead of a per-tab unread listener for every room.
  - **Open chat:** listen to members, tabs, the newest message page, pins and active drops. **Unsubscribe all of
    these as soon as you leave the chat**, and when the app goes to the background (`visibilitychange` → hidden),
    resubscribing on return.
  - **Streak days, countdown list, scheduled strip:** fetch once on open with `getDocs`, plus a refresh on send,
    rather than permanent listeners.
  - **Server:** `minuteJob` (functions/src/index.ts) runs every minute and queries `scheduled` and `held`.
    Consider every 2–5 minutes, or skip runs when a cheap "anything due?" counter doc says nothing is pending.

## Also worth doing at that point
- Turn on Firestore's offline persistence (multi-tab IndexedDB cache) so reopening the app reuses cached
  documents.
- Add a small usage readout in Settings (dev-only) or rely on the console Usage tab to check the savings.
- Re-run the full e2e (`npm run test:e2e`). Presence, typing, unread and the jump-to-message steps cover these
  paths.

## Done when
- Typecheck, build, unit, rules, functions and e2e all pass.
- A before/after count of reads and writes for a scripted session is noted in the PR. Count them, for example, by
  wrapping `onSnapshot`/`setDoc` in dev or by watching the emulator's request log.
