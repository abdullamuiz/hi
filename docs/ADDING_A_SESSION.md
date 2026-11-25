# Adding a Session test

A Session test is **one JSON file**: `src/sessions/tests/<id>.json`. Every file in that folder is picked up
automatically (`src/sessions/registry.ts` uses `import.meta.glob`), checked by `validateTest`, and offered in the
**+** tray under **Sessions**. The full-screen engine (`src/ui/Session.tsx`) runs any valid file: the questions, the
private answers, progress and presence, scoring, and the reveal. No code needed.

If a file is invalid, the build fails with a readable list of problems.

## The shape

```json
{
  "id": "work-style",                 // stable: lowercase, digits, dashes. Never change it once shipped.
  "version": 1,                       // bump when you change questions
  "title": "Work Style",
  "subtitle": "Planner or improviser? Solo or together?",
  "icon": "🛠️",
  "footer": "For fun and conversation, not a clinical or official assessment.",
  "format": "ab",                     // "ab" (two options) or "likert" (Strongly disagree … Strongly agree)
  "order": 2,                         // tray position
  "dimensions": [
    {
      "id": "PI", "name": "Pace",
      "left":  { "code": "P", "label": "Planner" },
      "right": { "code": "I", "label": "Improviser" },
      "tie": "left",                  // optional: which side wins a tie (default left)
      "same":   "You both like the same amount of structure.",
      "differ": "One of you plans, the other adapts. Agree what's fixed."
    }
  ],
  "questions": [
    // A/B: each option pushes one side. Alternate which option is "left" so always-A isn't a result.
    { "id": "pi1", "dim": "PI", "text": "A new project starts. You…",
      "a": { "text": "Write the plan first", "side": "left" },
      "b": { "text": "Start and adjust as you go", "side": "right" } }
    // Likert: { "id": "pi1", "dim": "PI", "text": "I like a clear plan.", "key": "left" }
  ],
  "profiles": {                       // optional, keyed by the combined code (one letter per dimension, in order)
    "P": { "name": "The Planner", "blurb": "You like to know where you're going." }
  },
  "reveal": ["types", "scales", "match", "prompts", "finish"],
  "prompts": {                        // per dimension (used when you differ there) + "same" (at least 3)
    "PI": ["What should we always plan, and what should we leave open?"],
    "same": ["Which result surprised you?", "What did this test miss about you?", "Have we changed?"]
  }
}
```

(JSON has no comments: remove the `//` lines in a real file.)

## How it scores

- **A/B:** each answer adds 1 to the side its option points to. **Likert:** an answer of 1–5 splits 1 point between the
  question's `key` side, `(v-1)/4`, and the other side, `(5-v)/4`.
- Each dimension's result is the side with more points (ties go to `tie`). The combined code is the winning `code` of
  every dimension, in order (e.g. `ENFP`), and picks the profile.
- Scoring runs on both phones once both have finished. Before that, the rules keep each person's answers private.

## The reveal steps

| Step | Shows |
|---|---|
| `types` | Both codes flip over side by side, with the profile name and blurb |
| `scales` | One bar per dimension: circle = you, square = them (never colour alone) |
| `match` | "Where you match" (`same` texts) and "Where you differ" (`differ` texts) |
| `prompts` | Three prompts: one from each dimension you differ on, then from `same`. *Ask this* fills the message box |
| `finish` | Summary, Pin result, Talk about it, Share as image, Retake, earlier results, confetti |

Leave out steps you don't need, e.g. `["scales", "prompts", "finish"]` for a test without profiles.

## Rules of thumb

- Write original questions. Don't copy published questionnaires or use trademarked names.
- Keep it short: 12–32 questions. Each dimension needs at least one question.
- `"dev": true` hides a test unless the device has `localStorage['hi.sessions.dev'] = '1'` (the e2e uses a four-question
  Mini Type Test this way).

## Checklist

1. Add `src/sessions/tests/<id>.json`.
2. `npm run test:unit`: `tests/unit/sessions.test.ts` validates every test file.
3. `npm run dev:all`, sign in with two browsers, start it from **+** → **Sessions**, and finish it on both.
4. Deploy. Both people need the new version: an older app shows "This Session needs a newer version of the app".
