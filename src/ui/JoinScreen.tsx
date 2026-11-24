import { useState } from 'preact/hooks';
import type { User } from 'firebase/auth';
import { joinByCode } from '../data/rooms';
import type { JoinRequest } from '../lib/invite';
import { firstName } from '../lib/names';
import type { Room } from '../types';
import { Logo } from './icons';

interface Props {
  user: User;
  join: JoinRequest;
  rooms: Room[];
  onOpen(roomId: string): void;
  onDone(): void;
}

/** Someone opened a share link: join that chat (or explain why not). */
export function JoinScreen({ user, join, rooms, onOpen, onDone }: Props) {
  const [state, setState] = useState<'ask' | 'busy' | 'failed'>('ask');
  const who = firstName(join.from, 'Someone');
  const already = rooms.find((r) => r.id === join.roomId);
  const ownLink = join.owner === user.uid || already?.owner === user.uid && already.members.length === 1;
  const existing = rooms.find((r) => r.members.length === 2 && join.owner && r.members.includes(join.owner) && join.owner !== user.uid);

  const go = async () => {
    setState('busy');
    try {
      await joinByCode(join.roomId, join.code, user);
      onOpen(join.roomId);
    } catch {
      setState('failed');
    }
  };

  let body;
  if (already && !ownLink) {
    body = (<>
      <h2>You’re already in this chat</h2>
      <button type="button" class="btn-primary" onClick={() => onOpen(already.id)}>Open chat</button>
    </>);
  } else if (ownLink) {
    body = (<>
      <h2>This is your own invite link</h2>
      <p class="lede">Send it to the person you want to chat with. The first person to open it joins.</p>
      <button type="button" class="btn-primary" onClick={onDone}>Go to my chats</button>
    </>);
  } else if (existing) {
    body = (<>
      <h2>You already chat with {who}</h2>
      <p class="lede">Hi keeps one chat per person, so we’ll open the one you have.</p>
      <button type="button" class="btn-primary" onClick={() => onOpen(existing.id)}>Open chat with {who}</button>
      <button type="button" class="btn-ghost" onClick={onDone}>Go to my chats</button>
    </>);
  } else if (state === 'failed') {
    body = (<>
      <h2>This invite link doesn’t work any more</h2>
      <p class="lede">Someone already used it, or {who} made a new one. Ask {who} to send you a fresh link.</p>
      <button type="button" class="btn-primary" onClick={onDone}>Go to my chats</button>
    </>);
  } else {
    body = (<>
      <h2>{who} invited you to chat</h2>
      <p class="lede">A private chat on Hi, just the two of you.</p>
      <button type="button" class="btn-primary" disabled={state === 'busy'} onClick={go}>{state === 'busy' ? 'Joining…' : `Join ${who}`}</button>
      <button type="button" class="btn-ghost" disabled={state === 'busy'} onClick={onDone}>Not now</button>
    </>);
  }

  return (
    <div class="app">
      <div class="screen">
        <div class="brand"><Logo size={56} /><div class="brand-name">Hi</div></div>
        <div class="card">{body}</div>
      </div>
    </div>
  );
}
