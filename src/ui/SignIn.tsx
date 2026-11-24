import { useEffect, useState } from 'preact/hooks';
import { finishEmailLink, looksLikeSignInLink, rememberedEmail, sendEmailLink, signInWithGoogle } from '../data/auth';
import { usingEmulators } from '../firebase';
import { isIOS, isStandalone } from '../data/push';
import { GoogleIcon, Logo } from './icons';
import { ModeToggle } from './ModeToggle';

const friendly = (e: any) => {
  const c = e?.code || '';
  if (c === 'auth/invalid-email') return 'That e-mail address looks wrong.';
  if (c === 'auth/invalid-action-code' || c === 'auth/expired-action-code') return 'That sign-in link has expired or was already used. Send a new one.';
  if (c === 'auth/popup-closed-by-user') return '';
  if (c === 'auth/unauthorized-domain') return 'This domain is not authorised for sign-in yet (Firebase console → Authentication → Settings → Authorised domains).';
  return e?.message || 'Something went wrong.';
};

export function SignIn() {
  const [email, setEmail] = useState(rememberedEmail());
  const [sent, setSent] = useState(false);
  const [useEmail, setUseEmail] = useState(false);
  const [paste, setPaste] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [needEmailFor, setNeedEmailFor] = useState<string | null>(null);

  // Opened from the e-mail link?
  useEffect(() => {
    if (!looksLikeSignInLink(location.href)) return;
    const saved = rememberedEmail();
    if (saved) run(() => finishEmailLink(saved, location.href));
    else setNeedEmailFor(location.href);
  }, []);

  async function run(fn: () => Promise<void>) {
    setErr('');
    setBusy(true);
    try { await fn(); } catch (e) { setErr(friendly(e)); } finally { setBusy(false); }
  }

  const send = (e: Event) => {
    e.preventDefault();
    if (!email.trim()) return;
    run(async () => { await sendEmailLink(email.trim()); setSent(true); });
  };

  const usePasted = (e: Event) => {
    e.preventDefault();
    const link = paste.trim();
    if (!looksLikeSignInLink(link)) { setErr('That doesn’t look like a sign-in link. Copy the whole link from the e-mail.'); return; }
    run(() => finishEmailLink(email, link));
  };

  return (
    <div class="app">
      <ModeToggle class="icon-btn screen-toggle" />
      <div class="screen">
        <div class="brand">
          <Logo size={56} />
          <div class="brand-name">Drops Chat</div>
        </div>
        <p class="lede">A new way to share moods, thoughts and experiences through conversation. Just say “Hi”.</p>
        {usingEmulators && <div class="emu">Local test mode: using the Firebase Emulator Suite, so accounts and messages here are not real.</div>}
        {err && <div class="err" role="alert">{err}</div>}

        {needEmailFor ? (
          <form class="card" onSubmit={(e) => { e.preventDefault(); run(() => finishEmailLink(email, needEmailFor)); }}>
            <h2>Confirm your e-mail</h2>
            <label class="field-label" for="confirm-email">The address you asked the link for</label>
            <input id="confirm-email" class="field" type="email" autocomplete="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} required />
            <button class="btn-primary" disabled={busy}>Sign in</button>
          </form>
        ) : (
          <div class="card">
            <button type="button" class="btn-primary btn-google" disabled={busy} onClick={() => run(signInWithGoogle)}>
              <span style={{ background: '#fff', borderRadius: '9px', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><GoogleIcon /></span>
              Continue with Google
            </button>
            <div class="fine" style={{ textAlign: 'center' }}>One tap. You stay signed in on this device.</div>
            {!useEmail && !sent ? (
              <button type="button" class="link-btn" style={{ alignSelf: 'center' }} onClick={() => setUseEmail(true)}>No Google account? Use e-mail instead</button>
            ) : !sent ? (
              <form class="stack-10" onSubmit={send}>
                <div class="or">or</div>
                <label class="field-label" for="email">E-mail me a sign-in link</label>
                <input id="email" class="field" type="email" inputMode="email" autocomplete="email" placeholder="you@example.com" value={email} onInput={(e) => setEmail(e.currentTarget.value)} required autoFocus />
                <button class="btn-ghost" disabled={busy}>Send link</button>
              </form>
            ) : (
              <form class="stack-10" onSubmit={usePasted}>
                <div class="ok">Link sent to {email}. Open it on this device to finish signing in.</div>
                {isIOS() && isStandalone() && (
                  <label class="field-label" for="paste">On iPhone, e-mail links open in Safari instead of this app. Long-press the link in the e-mail, copy it, and paste it here:</label>
                )}
                {isIOS() && isStandalone() && (
                  <>
                    <input id="paste" class="field" value={paste} onInput={(e) => setPaste(e.currentTarget.value)} placeholder="https://…" autocomplete="off" />
                    <button class="btn-ghost" disabled={busy || !paste.trim()}>Sign in with pasted link</button>
                  </>
                )}
                <button type="button" class="link-btn" onClick={() => setSent(false)}>Use a different e-mail</button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
