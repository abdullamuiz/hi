import { describe, expect, it } from 'vitest';
import { filesToDelete } from '../src/cleanup';
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

describe('openUrl', () => {
  it('points at the chat and tab', () => {
    expect(openUrl('r1', 'trip plans')).toBe('./?room=r1&tab=trip%20plans');
  });
});
