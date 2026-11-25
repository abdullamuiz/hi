import { getBytes, ref } from 'firebase/storage';
import { storage } from '../firebase';
import { loadHistory } from './history';
import { exportable, exportName, toJson, toText, type ExportData } from '../lib/exportFormat';

/** Exports read further back than search. */
export const EXPORT_CAP = 5000;

/** Everything I can see in a chat (or one tab of it), ready to export. */
export async function gatherExport(
  roomId: string, me: { uid: string; name: string }, partner: { uid: string; name: string }, tabId?: string,
): Promise<{ data: ExportData; truncated: boolean }> {
  const h = await loadHistory(roomId, { cap: EXPORT_CAP, fresh: true });
  const tabs = (tabId ? h.tabs.filter((t) => t.id === tabId) : h.tabs).map((t) => ({ id: t.id, name: t.name, colour: t.colour }));
  const messages = h.messages.filter((m) => !tabId || m.tabId === tabId);
  const tabName = tabId ? tabs[0]?.name : '';
  return {
    data: {
      title: `Hi · ${me.name} & ${partner.name}${tabName ? ` · ${tabName}` : ''}`,
      me, partner, tabs, messages, exportedAt: Date.now(),
    },
    truncated: h.truncated,
  };
}

const EXT: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'm4a' };

/**
 * chat.zip: chat.txt, chat.json and the photos and voice notes (where Storage lets me read
 * them; a file that can't be fetched is noted in missing.txt instead of failing the export).
 */
export async function buildZip(data: ExportData, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const { zipSync, strToU8 } = await import('fflate');
  const media = exportable(data.messages, data.me.uid, data.exportedAt).filter((m) => (m.kind === 'photo' && m.photo?.path) || (m.kind === 'voice' && m.voice?.path));
  const files: Record<string, string> = {};
  const out: Record<string, Uint8Array> = {};
  const missing: string[] = [];
  let done = 0;
  for (const m of media) {
    const path = m.kind === 'photo' ? m.photo!.path : m.voice!.path;
    const name = m.kind === 'photo'
      ? `photos/${m.id}.jpg`
      : `voice/${m.id}.${EXT[(m.voice?.mime || '').split(';')[0]] || path.split('.').pop() || 'webm'}`;
    try {
      out[name] = new Uint8Array(await getBytes(ref(storage, path), 15 * 1024 * 1024));
      files[m.id] = name;
    } catch {
      missing.push(name);
    }
    onProgress?.(++done, media.length);
  }
  out['chat.txt'] = strToU8(toText(data, files));
  out['chat.json'] = strToU8(JSON.stringify(toJson(data, files), null, 2));
  if (missing.length) out['missing.txt'] = strToU8(`These files couldn't be downloaded:\n${missing.join('\n')}\n`);
  // Photos and audio are already compressed, so store them as they are.
  const zipped = zipSync(out, { level: 0 });
  return new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

/** Saves a file: the share sheet on phones (where downloads are awkward), a download elsewhere. */
export async function saveFile(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: blob.type });
  const touch = matchMedia('(pointer: coarse)').matches;
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (touch && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: filename }); return; } catch (e: any) { if (e?.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export { exportName };
