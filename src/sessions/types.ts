/**
 * A Session test, defined entirely in JSON (`src/sessions/tests/<id>.json`).
 * The engine (src/ui/Session.tsx) runs any file in this shape: new test = new JSON file.
 * See docs/ADDING_A_SESSION.md.
 */

export interface Side {
  /** Letter (or short code) for this end of the scale, e.g. "E". */
  code: string;
  /** Plain-words label, e.g. "Energised by people". */
  label: string;
}

export interface Dimension {
  /** Stable id, e.g. "EI". */
  id: string;
  /** Short name shown above the scale bar, e.g. "Energy". */
  name: string;
  left: Side;
  right: Side;
  /** Which side wins a tie (default "left"). */
  tie?: 'left' | 'right';
  /** "Where you match" card text when both land on the same side. */
  same: string;
  /** "Where you differ" card text when you land on different sides. */
  differ: string;
}

/** A/B question: each option pushes one side of one dimension. */
export interface AbQuestion {
  id: string;
  dim: string;
  text: string;
  a: { text: string; side: 'left' | 'right' };
  b: { text: string; side: 'left' | 'right' };
}

/** Likert question: 1 (disagree) … 5 (agree); agreeing pushes `key`. */
export interface LikertQuestion {
  id: string;
  dim: string;
  text: string;
  key: 'left' | 'right';
}

export interface Profile {
  name: string;
  blurb: string;
}

export type RevealStep = 'types' | 'scales' | 'match' | 'prompts' | 'finish';

export interface SessionTest {
  id: string;
  version: number;
  title: string;
  subtitle: string;
  /** One emoji for the card and tray. */
  icon: string;
  /** Small print under the intro and results. */
  footer: string;
  format: 'ab' | 'likert';
  /** Only offered when the device has the developer switch on (used by tests). */
  dev?: boolean;
  /** Tray order; lower first. */
  order?: number;
  dimensions: Dimension[];
  questions: Array<AbQuestion | LikertQuestion>;
  /** Result profiles keyed by the combined code, e.g. "INTJ". Optional. */
  profiles?: Record<string, Profile>;
  /** Which reveal screens to show, in order. */
  reveal: RevealStep[];
  /**
   * Conversation prompts: per dimension id (used when you differ there) plus
   * "same" (used to fill up when you mostly match).
   */
  prompts: Record<string, string[]>;
}

/** My raw answers: question id → "a" | "b" (A/B) or 1–5 (Likert). */
export type Answers = Record<string, 'a' | 'b' | number>;
