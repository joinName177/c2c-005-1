import { describe, expect, it } from 'vitest';
import {
  arrangementSignature,
  clipsReferencing,
  createClip,
  maxCrossfade,
  scheduleClips,
  validateArrangement,
  type ArrangementClip,
} from '../arrangement';

const clip = (over: Partial<ArrangementClip> = {}): ArrangementClip => ({
  id: over.id ?? 'c1', sourceId: over.sourceId ?? 's1',
  start: over.start ?? 0, end: over.end ?? 4,
  silenceAfter: over.silenceAfter ?? 0, crossfade: over.crossfade ?? 0,
});

describe('scheduleClips', () => {
  it('places clips back to back and sums duration', () => {
    const schedule = scheduleClips([clip(), clip({ id: 'c2', sourceId: 's2', start: 1, end: 3 })]);
    expect(schedule.clips.map((c) => [c.at, c.out])).toEqual([[0, 4], [4, 6]]);
    expect(schedule.duration).toBe(6);
  });
  it('reflows following positions when an earlier clip gets longer', () => {
    const clips = [clip(), clip({ id: 'c2' })];
    const before = scheduleClips(clips);
    expect(before.clips[1].at).toBe(4);
    const after = scheduleClips([{ ...clips[0], end: 7 }, clips[1]]);
    expect(after.clips[1].at).toBe(7);
    expect(after.duration).toBe(11);
  });
  it('adds silence after a clip to the gap', () => {
    const schedule = scheduleClips([clip({ silenceAfter: 2 }), clip({ id: 'c2' })]);
    expect(schedule.clips[1].at).toBe(6);
    expect(schedule.duration).toBe(10);
  });
  it('subtracts crossfade overlap from total duration', () => {
    const schedule = scheduleClips([clip({ crossfade: 1 }), clip({ id: 'c2', end: 4 })]);
    expect(schedule.clips[1].at).toBe(3);
    expect(schedule.duration).toBe(7);
  });
  it('combines silence and overlap in order and never double counts the last clip', () => {
    const schedule = scheduleClips([
      clip({ silenceAfter: 1, crossfade: 0.5 }),
      clip({ id: 'c2', end: 4, silenceAfter: 9 }),
    ]);
    expect(schedule.clips[1].at).toBeCloseTo(4.5);
    // 末段之后的静音不应计入总时长
    expect(schedule.duration).toBeCloseTo(8.5);
  });
  it('does not let a crossfade exceed either neighbouring clip length', () => {
    const schedule = scheduleClips([clip({ end: 0.4, crossfade: 3 }), clip({ id: 'c2', end: 0.2 })]);
    expect(schedule.duration).toBeCloseTo(0.4);
  });
  it('keeps the next clip at or after the current start when overlap exceeds silence', () => {
    const schedule = scheduleClips([clip({ end: 2, silenceAfter: 0.2, crossfade: 2 }), clip({ id: 'c2', end: 3 })]);
    expect(schedule.clips[1].at).toBeCloseTo(0.2);
    expect(schedule.duration).toBeCloseTo(3.2);
  });
  it('reports zero for an empty timeline', () => {
    expect(scheduleClips([]).duration).toBe(0);
  });
});

describe('validateArrangement', () => {
  const durations = { s1: 12, s2: 5 };
  it('flags ranges beyond ten seconds of total duration after overlap', () => {
    const issues = validateArrangement([clip({ end: 6 }), clip({ id: 'c2', sourceId: 's2', end: 5 })], durations);
    expect(issues.some((i) => i.message.includes('10 秒'))).toBe(true);
  });
  it('accepts a timeline exactly ten seconds after overlap deduction', () => {
    const issues = validateArrangement([clip({ end: 6, crossfade: 1 }), clip({ id: 'c2', sourceId: 's2', end: 5 })], durations);
    expect(issues).toEqual([]);
  });
  it('reports a missing source per affected clip', () => {
    const issues = validateArrangement([clip({ sourceId: 'gone' })], durations);
    expect(issues[0].clipId).toBe('c1');
    expect(issues[0].message).toContain('素材已删除');
  });
  it('rejects reversed ranges and negative gaps', () => {
    const issues = validateArrangement(
      [clip({ start: 5, end: 2 }), clip({ id: 'c2', sourceId: 's2', silenceAfter: -1 })],
      durations,
    );
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });
});

describe('arrangement helpers', () => {
  it('changes signature whenever a selection changes but not clip identities', () => {
    const a = [clip()];
    const reorderedIds = [{ ...clip() }];
    expect(arrangementSignature(a)).toBe(arrangementSignature(reorderedIds));
    expect(arrangementSignature(a)).not.toBe(arrangementSignature([{ ...a[0], end: 3 }]));
  });
  it('lists clips referencing a source and caps crossfade by neighbours', () => {
    const clips = [clip(), clip({ id: 'c2', sourceId: 's1', end: 2 }), clip({ id: 'c3', sourceId: 's2' })];
    expect(clipsReferencing(clips, 's1').map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(maxCrossfade(clips, 0)).toBe(2);
    expect(maxCrossfade(clips, 2)).toBe(0);
  });
  it('creates a first clip capped at ten seconds', () => {
    expect(createClip('s1', 12, 'new').end).toBe(10);
    expect(createClip('s1', 3, 'new').end).toBe(3);
  });
});
