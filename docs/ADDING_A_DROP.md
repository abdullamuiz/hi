# Adding a Drop

A Drop is **one file**: `src/drops/<name>.drop.tsx`. Every file matching `*.drop.tsx` is picked up automatically
(`src/drops/registry.ts` uses `import.meta.glob`), so there is nothing to register. Save the file and the new Drop appears in the **+** tray.

## The shape

```tsx
import { useState } from 'preact/hooks';
import { defineDrop } from './types';

type Content = { question: string };      // plain JSON, stored on the Drop in Firestore
const K = 'pick';                          // a key for one private answer

export default defineDrop<Content>({
  // ---- JSON definition --------------------------------------------------------
  type: 'this-or-that',                    // stable id: lowercase, digits, dashes. Never change it once shipped.
  title: 'This or That',
  trayDescription: 'Pick one, flip together',
  content: { question: 'Beach or mountains?' },          // defaults
  setup: [{ key: 'question', label: 'Question', kind: 'text', maxLength: 140 }], // optional form before dropping
  subtitle: () => 'Quick pick',
  pinDetail: (_c, api) => api.revealed(K) ? `${api.mine(K)} vs ${api.theirs(K)}` : 'Not flipped yet',
  order: 5,                                // position in the tray

  // ---- Renderer ---------------------------------------------------------------
  Renderer({ content, api }) {
    const [pick, setPick] = useState('');
    if (!api.iLocked(K)) {
      return (
        <div class="stack">
          <div class="q">{content.question}</div>
          <input class="field" value={pick} onInput={(e) => setPick(e.currentTarget.value)} />
          <button class="btn-primary" disabled={!pick} onClick={() => api.lock(K, pick)}>Lock in</button>
        </div>
      );
    }
    return api.revealed(K)
      ? <div class="q">You: {api.mine(K)} · {api.partner.name}: {api.theirs(K)}</div>
      : <div class="note">Waiting for {api.partner.name}…</div>;
  },
});
```

The host (`src/ui/DropCard.tsx`) draws the card frame: the icon, title, "subtitle · dropped by …" and the
**Pin to scrapbook** footer. Your renderer only draws the middle.

## What `api` gives you

| Need | Use | Stored at | Who can read |
|---|---|---|---|
| A **hidden answer** revealed only when both lock in | `saveDraft(key, v)`, `lock(key, v)`, `mine(key)`, `theirs(key)`, `iLocked`, `theyLocked`, `revealed` | `drops/{id}/sealed/{uid}_{key}` | Owner always; partner **only after both locked `key`**, enforced by `firestore.rules` |
| **Public lines** anyone adds (stories, lists) | `entries`, `addEntry(text)` | `drops/{id}/entries/*` | Both (append-only, ≤ 280 chars) |
| **Public per-person progress** (current step, done flag) | `myProgress`, `theirProgress`, `setMyProgress(patch)` | `drops/{id}/users/{uid}` | Both |
| Who's who | `me`, `partner`, `createdBy` (`{ uid, name, isMe }`) | — | — |

Rules of thumb:

- **Anything secret must go through `saveDraft`/`lock`.** Never put a hidden answer in `entries` or `progress`;
  those are public to both people.
- Use a different `key` for each round (`s0`, `s1`, … for a multi-step Drop). Revealing one key doesn't reveal another.
- `lock` is final. Once locked, the security rules refuse any change to that answer.
- Answers can be any JSON value. Strings are capped at 500 characters by the rules.
- Keep `content` small and JSON-only. It's copied into Firestore when the Drop is created, so later edits to
  your defaults don't change Drops that already exist. `withDefaults` fills in fields you add later.

## Styling

Reuse the classes in `src/styles.css` so new Drops match the rest of the app: `.stack`, `.q`, `.note`, `.field`,
`.btn-primary`, `.btn-ghost`, `.reveal-grid` / `.reveal-card.me|.them`, `.track` / `.mark.me|.them`, `.story`.
Colours: you = `var(--me)` (#2F5BEA), partner = `var(--them)` (#F2A15F), ink = `var(--ink)`.

## Push notifications

The push text says "Dropped a Drop — your move" by default. To name your Drop, add it to `DROP_TITLES` in
`functions/src/notify.ts` and redeploy functions. This is optional.

## Checklist

1. Create `src/drops/<name>.drop.tsx` with `export default defineDrop({...})`.
2. `npm run test:unit`: the registry test checks every Drop's definition (valid `type`, JSON content, setup keys).
3. `npm run dev:all`, sign in with two browsers, drop it, and play it from both sides.
4. Deploy (`npm run deploy`). Both people need the new version: an older app shows "This Drop needs a newer version of the app".
