import { describe, expect, it } from 'vitest';
import { exhaustedOnce, filesOfRemoved, filesToDelete } from '../src/cleanup';
import { openUrl } from '../src/notify';

const photo = { path: 'rooms/r1/photos/alice/abc.jpg', width: 1, height: 1 };

describe('filesToDelete', () => {
  it('returns the photo when a message flips to deleted', () => {
    expect(filesToDelete({ photo }, { deleted: true }, 'r1')).toEqual(['rooms/r1/photos/alice/abc.jpg']);
  });
  it('does nothing for other updates', () => {
    expect(filesToDelete({ photo }, { photo }, 'r1')).toEqual([]);
    expect(filesToDelete({ photo, deleted: true }, { deleted: true }, 'r1')).toEqual([]);
    expect(filesToDelete({}, { deleted: true }, 'r1')).toEqual([]);
  });
  it('never touches files outside the room or odd paths', () => {
    expect(filesToDelete({ photo }, { deleted: true }, 'r2')).toEqual([]);
    expect(filesToDelete({ photo: { path: 'rooms/r1/photos/alice/../../x.jpg' } }, { deleted: true }, 'r1')).toEqual([]);
    expect(filesToDelete({ photo: { path: 42 } }, { deleted: true }, 'r1')).toEqual([]);
  });
});

describe('filesToDelete: voice notes', () => {
  const voice = { path: 'rooms/r1/voice/bob/v1.webm' };
  it('returns the voice file when a voice note is deleted for everyone', () => {
    expect(filesToDelete({ voice }, { deleted: true }, 'r1')).toEqual(['rooms/r1/voice/bob/v1.webm']);
    expect(filesToDelete({ voice: { path: 'rooms/r1/voice/bob/v2.m4a' } }, { deleted: true }, 'r1')).toEqual(['rooms/r1/voice/bob/v2.m4a']);
  });
  it('ignores other rooms and odd voice paths', () => {
    expect(filesToDelete({ voice }, { deleted: true }, 'r2')).toEqual([]);
    expect(filesToDelete({ voice: { path: 'rooms/r1/voice/bob/v1.exe' } }, { deleted: true }, 'r1')).toEqual([]);
  });
});

describe('openUrl', () => {
  it('points at the chat and tab', () => {
    expect(openUrl('r1', 'trip plans')).toBe('./?room=r1&tab=trip%20plans');
  });
});

describe('filesOfRemoved (disappearing tab TTL, deleted chat)', () => {
  it('returns the photo or voice file of a message deleted outright', () => {
    expect(filesOfRemoved({ photo }, 'r1')).toEqual(['rooms/r1/photos/alice/abc.jpg']);
    expect(filesOfRemoved({ voice: { path: 'rooms/r1/voice/bob/v1.webm' } }, 'r1')).toEqual(['rooms/r1/voice/bob/v1.webm']);
  });
  it('skips messages that had no files, already-cleared ones, other rooms and odd paths', () => {
    expect(filesOfRemoved({}, 'r1')).toEqual([]);
    expect(filesOfRemoved(undefined, 'r1')).toEqual([]);
    expect(filesOfRemoved({ photo, deleted: true }, 'r1')).toEqual([]);
    expect(filesOfRemoved({ photo }, 'r2')).toEqual([]);
    expect(filesOfRemoved({ photo: { path: 'rooms/r1/photos/a/../x.jpg' } }, 'r1')).toEqual([]);
  });
});

describe('thumbnails and view-once photos', () => {
  const once = { path: 'rooms/r1/once/alice/t1/m1.jpg', width: 1, height: 1 };
  it('deletes the thumbnail with the photo', () => {
    const p = { path: 'rooms/r1/photos/alice/abc.jpg', thumbPath: 'rooms/r1/photos/alice/abc_t.jpg' };
    expect(filesToDelete({ photo: p }, { deleted: true }, 'r1')).toEqual([p.path, p.thumbPath]);
    expect(filesOfRemoved({ photo: p }, 'r1')).toEqual([p.path, p.thumbPath]);
  });
  it('deletes a view-once file when deleted for everyone or removed', () => {
    expect(filesToDelete({ photo: once, viewLimit: 1 }, { deleted: true }, 'r1')).toEqual([once.path]);
    expect(filesOfRemoved({ photo: once, viewLimit: 1 }, 'r1')).toEqual([once.path]);
  });
  it('flags the file when the last view is counted, once', () => {
    expect(exhaustedOnce({ photo: once, viewLimit: 1 }, { photo: once, viewLimit: 1, viewCount: 1 }, 'r1')).toBe(once.path);
    expect(exhaustedOnce({ photo: once, viewLimit: 2, viewCount: 0 }, { photo: once, viewLimit: 2, viewCount: 1 }, 'r1')).toBeNull();
    expect(exhaustedOnce({ photo: once, viewLimit: 2, viewCount: 1 }, { photo: once, viewLimit: 2, viewCount: 2 }, 'r1')).toBe(once.path);
    // already used up (e.g. our own photo.path delete re-triggering): nothing more
    expect(exhaustedOnce({ photo: once, viewLimit: 1, viewCount: 1 }, { photo: { width: 1, height: 1 }, viewLimit: 1, viewCount: 1 }, 'r1')).toBeNull();
    // normal photos and other rooms are never touched
    expect(exhaustedOnce({ photo }, { photo, viewCount: 1 }, 'r1')).toBeNull();
    expect(exhaustedOnce({ photo: once, viewLimit: 1 }, { photo: once, viewLimit: 1, viewCount: 1 }, 'r2')).toBeNull();
  });
});
