import { useEffect, useState } from 'preact/hooks';
import { defineDrop } from './types';
import { getTest } from '../sessions/registry';
import { isHere, score } from '../sessions/logic';
import type { SessionProgress } from '../data/sessions';

// The data layer is loaded on demand (keeps Drop definitions free of Firebase at import time).
const data = () => import('../data/sessions');

/** The card in the chat for a full-screen Session (Type Test …). Started from the tray's Sessions section. */
type Content = { testId: string; sessionId: string };

/** Ask the chat to open a Session full screen. detail: { sessionId } */
export const OPEN_SESSION = 'hi:open-session';

export default defineDrop<Content>({
  type: 'session',
  title: 'Session',
  trayDescription: 'A full-screen test for two',
  hidden: true, // offered in the tray's own Sessions section instead
  order: 200,
  content: { testId: '', sessionId: '' },
  cardTitle: (c) => getTest(c.testId)?.title || 'Session',
  subtitle: (c) => getTest(c.testId)?.subtitle || 'Full-screen session',
  pinDetail(_c, api) {
    const a = api.myProgress.code as string | undefined;
    const b = api.theirProgress.code as string | undefined;
    return a && b ? `You ${a} · ${api.partner.name} ${b}` : 'Not finished yet';
  },

  Renderer({ content, api }) {
    const test = getTest(content.testId);
    const [prog, setProg] = useState<Record<string, SessionProgress>>({});
    const [, tick] = useState(0);
    useEffect(() => {
      if (!content.sessionId) return;
      let stop: (() => void) | null = null;
      let alive = true;
      data().then((d) => { if (alive) stop = d.watchProgress(api.roomId, content.sessionId, setProg); });
      return () => { alive = false; stop?.(); };
    }, [api.roomId, content.sessionId]);
    // Re-check presence now and then ("Bob is in it now").
    useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 15_000); return () => clearInterval(t); }, []);

    const mine = prog[api.me.uid];
    const theirs = api.partner.uid ? prog[api.partner.uid] : undefined;
    const bothDone = !!mine?.done && !!theirs?.done;

    // Once both have finished, record my result code (for this card and the scrapbook).
    useEffect(() => {
      if (!test || !bothDone || !mine || mine.pending) return;
      if (mine.code) {
        if (api.myProgress.code !== mine.code) api.setMyProgress({ code: mine.code }).catch(() => {});
        return;
      }
      data().then(async (d) => {
        const p = await d.loadMyAnswers(api.roomId, content.sessionId, api.me.uid);
        if (p) await d.touchPresence(api.roomId, content.sessionId, api.me.uid, { ...mine, code: score(test, p.answers).code });
      }).catch(() => {});
    }, [bothDone, mine?.code, mine?.pending]);

    if (!test) return <div class="note">This Session needs a newer version of the app.</div>;

    const total = test.questions.length;
    const open = () => dispatchEvent(new CustomEvent(OPEN_SESSION, { detail: { sessionId: content.sessionId } }));
    const count = (p?: SessionProgress) => (p?.done ? 'done' : `${p?.answered ?? 0}/${total}`);
    const label = bothDone ? 'See results'
      : mine?.done ? `Waiting for ${api.partner.name}`
      : mine?.answered ? 'Continue'
      : api.createdBy.isMe ? 'Start' : 'Join';

    return (
      <div class="stack session-card">
        <div class="q"><span aria-hidden="true">{test.icon} </span>
          {api.createdBy.isMe ? 'You' : api.createdBy.name} started a {test.title}
        </div>
        {bothDone && mine?.code && theirs?.code ? (
          <div class="session-codes" aria-label={`You ${mine.code}, ${api.partner.name} ${theirs.code}`}>
            <span><small>You</small><b>{mine.code}</b></span>
            <span><small>{api.partner.name}</small><b>{theirs.code}</b></span>
          </div>
        ) : (
          <div class="session-prog">
            <span>You {count(mine)}</span>
            <span>{api.partner.name} {count(theirs)}{isHere(theirs) && !theirs?.done && <em class="here-dot"> · in it now</em>}</span>
          </div>
        )}
        <button type="button" class={mine?.done && !bothDone ? 'btn-ghost' : 'btn-primary'} onClick={open}>{label}</button>
      </div>
    );
  },
});
