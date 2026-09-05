import { describe, it, expect } from 'vitest';
import {
  applyAppendMarker,
  applyCreateMarker,
  collapseToTitle,
  extractTaskMarkers,
  lineBoundsForSelection,
  lineHasMarker,
  taskMarker,
} from '../journalMarkers';

const TASK_ID = 'a1b2c3d4-1111-2222-3333-444455556666';

describe('taskMarker', () => {
  it('uses the first 8 characters of the task id', () => {
    expect(taskMarker(TASK_ID)).toBe('[tsk:a1b2c3d4]');
  });
});

describe('extractTaskMarkers', () => {
  it('finds every distinct marker in first-seen order', () => {
    const body = 'a [tsk:aaaaaaaa]\nb [tsk:bbbbbbbb]\nc [tsk:aaaaaaaa]';
    expect(extractTaskMarkers(body)).toEqual(['aaaaaaaa', 'bbbbbbbb']);
  });

  it('ignores a hand-ticked checkbox with no marker', () => {
    expect(extractTaskMarkers('- [x] I did this myself')).toEqual([]);
  });

  it('ignores malformed markers', () => {
    expect(extractTaskMarkers('[tsk:short] [tsk:nothexnothex] [tsk-a1b2c3d4]')).toEqual([]);
  });

  it('does not carry regex state between calls', () => {
    const body = 'x [tsk:aaaaaaaa]';
    expect(extractTaskMarkers(body)).toEqual(['aaaaaaaa']);
    expect(extractTaskMarkers(body)).toEqual(['aaaaaaaa']);
  });
});

describe('lineHasMarker', () => {
  it('is true only for a real marker', () => {
    expect(lineHasMarker('- [x] [tsk:a1b2c3d4] done')).toBe(true);
    expect(lineHasMarker('- [x] done by hand')).toBe(false);
  });
});

describe('lineBoundsForSelection', () => {
  const body = 'first line\nsecond line\nthird line';

  it('expands a mid-word selection to whole lines', () => {
    // "econd" inside line 2
    const bounds = lineBoundsForSelection(body, 12, 17);
    expect(body.slice(bounds.start, bounds.end)).toBe('second line');
  });

  it('does not swallow the next line when the selection ends on a newline', () => {
    // "first line\n" — the trailing newline is part of the drag
    const bounds = lineBoundsForSelection(body, 0, 11);
    expect(body.slice(bounds.start, bounds.end)).toBe('first line');
  });

  it('covers every line a multi-line selection touches', () => {
    const bounds = lineBoundsForSelection(body, 6, 17);
    expect(body.slice(bounds.start, bounds.end)).toBe('first line\nsecond line');
  });

  it('handles a selection in the final line with no trailing newline', () => {
    const bounds = lineBoundsForSelection(body, 25, 28);
    expect(body.slice(bounds.start, bounds.end)).toBe('third line');
  });
});

describe('applyCreateMarker', () => {
  it('prefixes the line with the marker and no checkbox', () => {
    expect(applyCreateMarker('Chase the SLA numbers', TASK_ID)).toBe(
      '- [tsk:a1b2c3d4] Chase the SLA numbers',
    );
  });

  it('replaces an existing bullet and preserves indentation', () => {
    expect(applyCreateMarker('    - Chase the SLA numbers', TASK_ID)).toBe(
      '    - [tsk:a1b2c3d4] Chase the SLA numbers',
    );
    expect(applyCreateMarker('  1. Chase the SLA numbers', TASK_ID)).toBe(
      '  - [tsk:a1b2c3d4] Chase the SLA numbers',
    );
  });
});

describe('applyAppendMarker', () => {
  it('suffixes the marker without a checkbox', () => {
    expect(applyAppendMarker('- Vendor pushed the date  ', TASK_ID)).toBe(
      '- Vendor pushed the date [tsk:a1b2c3d4]',
    );
  });
});

describe('collapseToTitle', () => {
  it('joins lines and strips bullets', () => {
    expect(collapseToTitle('- Chase the SLA\n- numbers from vendor')).toBe(
      'Chase the SLA numbers from vendor',
    );
  });

  it('drops blank lines', () => {
    expect(collapseToTitle('one\n\n\ntwo')).toBe('one two');
  });

  // A title carrying a marker would be indexed as a link wherever it appeared.
  it('strips markers and checkboxes', () => {
    expect(collapseToTitle('- [x] [tsk:aaaaaaaa] Already linked\n- Follow up')).toBe(
      'Already linked Follow up',
    );
  });
});
