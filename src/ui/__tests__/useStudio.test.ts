import { describe, expect, it } from 'vitest';
import { useStudio, type StudioDependencies } from '../useStudio';
import { coverPresetFor } from '../../core/cover-presets';
import { layoutTimeline, type ArrangementDraft, type TimelineItem } from '../../core/arrangement';
import type { AudioMaterial, VoiceMeme } from '../../core/models';

function dependencies(overrides: Partial<StudioDependencies> = {}): StudioDependencies & { pool: AudioMaterial[]; savedDraft: { value?: ArrangementDraft } } {
  const saved: VoiceMeme[] = [];
  const pool: AudioMaterial[] = [];
  const savedDraft: { value?: ArrangementDraft } = {};
  const deps: StudioDependencies = {
    recorder: { isRecording: false, start: async () => {}, stop: async () => new Blob(['voice'], { type: 'audio/webm' }) },
    analyzer: { analyze: async () => ({ duration: 2, features: { loudness:.75,dynamics:.55,pitch:.8,zeroCrossing:.62,pauseRatio:.12,tempoVariation:.6 } }) },
    cropper: { inspect: async () => ({duration:2,needsCrop:false}), crop: async (blob, range) => ({blob,duration:range.end-range.start}) },
    composer: { compose: async (_materials, items) => ({ blob: new Blob(['mix']), duration: layoutTimeline(items).total }) },
    materials: { list: async () => pool, save: async (m) => { pool.push(m) }, delete: async (id) => { const i = pool.findIndex((m) => m.id === id); if (i >= 0) pool.splice(i, 1); } },
    drafts: { load: async () => savedDraft.value, save: async (d) => { savedDraft.value = d }, clear: async () => { savedDraft.value = undefined } },
    renderer: { render: async () => new Blob(['cover'], { type: 'image/png' }) },
    repository: { list: async()=>saved, save: async(m)=>{saved.push(m)}, rename:async()=>{}, delete:async()=>{} },
    share: { share: async () => 'shared' },
    ...overrides,
  };
  return Object.assign(deps, { pool, savedDraft });
}

async function recordOne(studio: ReturnType<typeof useStudio>) { await studio.startRecording(); await studio.stopRecording(); }

describe('useStudio', () => {
  it('turns microphone denial into a recoverable error', async () => {
    const studio = useStudio(dependencies({ recorder: { isRecording:false, start:async()=>{throw new DOMException('denied','NotAllowedError')}, stop:async()=>new Blob() } }));
    await studio.startRecording();
    expect(studio.error.value).toContain('麦克风权限');
    expect(studio.stage.value).toBe('record');
  });
  it('puts recordings into the material pool and starts an arrangement', async () => {
    const deps = dependencies(); const studio = useStudio(deps);
    await recordOne(studio);
    expect(studio.stage.value).toBe('arrange');
    expect(studio.materials.value).toHaveLength(1);
    expect(deps.pool).toHaveLength(1);
    expect(studio.items.value).toHaveLength(1);
    expect(studio.items.value[0].kind).toBe('clip');
  });
  it('composes and analyzes before moving to emotion, then invalidates results on edit', async () => {
    const studio = useStudio(dependencies()); await recordOne(studio);
    await studio.composeAndAnalyze();
    expect(studio.stage.value).toBe('emotion');
    expect(studio.emotion.value?.label).toBe('元气满满');
    expect(studio.readyToSave.value).toBe(true);
    studio.patchItem(studio.items.value[0].id, { end: 1 });
    expect(studio.readyToSave.value).toBe(false);
    expect(studio.emotion.value).toBeUndefined();
    await studio.save();
    expect(studio.error.value).toContain('合成与情绪分析');
  });
  it('blocks totals over ten seconds and keeps the arrangement for retry after failure', async () => {
    const deps = dependencies({ cropper: { inspect: async () => ({duration:8,needsCrop:false}), crop: async (blob, range) => ({blob,duration:range.end-range.start}) } });
    const studio = useStudio(deps); await recordOne(studio);
    const materialId = studio.materials.value[0].id;
    studio.addClip(materialId);
    expect(studio.totalDuration.value).toBeCloseTo(16);
    await studio.composeAndAnalyze();
    expect(studio.error.value).toContain('10');
    expect(studio.stage.value).toBe('arrange');
    studio.patchItem(studio.items.value[0].id, { end: 2 });
    studio.patchItem(studio.items.value[1].id, { end: 2 });
    await studio.composeAndAnalyze();
    expect(studio.stage.value).toBe('emotion');
  });
  it('keeps the arrangement when composing fails so the user can retry', async () => {
    let calls = 0;
    const deps = dependencies({ composer: { compose: async (_m, items) => { calls += 1; if (calls === 1) throw new Error('解码失败'); return { blob: new Blob(['mix']), duration: layoutTimeline(items).total }; } } });
    const studio = useStudio(deps); await recordOne(studio);
    await studio.composeAndAnalyze();
    expect(studio.error.value).toContain('合成失败');
    expect(studio.items.value).toHaveLength(1);
    await studio.composeAndAnalyze();
    expect(studio.stage.value).toBe('emotion');
  });
  it('discards stale compose results when the user edits during processing', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const deps = dependencies({ composer: { compose: async (_m, items) => { await gate; return { blob: new Blob(['mix']), duration: layoutTimeline(items).total }; } } });
    const studio = useStudio(deps); await recordOne(studio);
    const pending = studio.composeAndAnalyze();
    studio.patchItem(studio.items.value[0].id, { end: 1 });
    release(); await pending;
    expect(studio.stage.value).toBe('arrange');
    expect(studio.composed.value).toBeUndefined();
    expect(studio.readyToSave.value).toBe(false);
  });
  it('lists affected clips before deleting a referenced material and honours cancel', async () => {
    const deps = dependencies(); const studio = useStudio(deps); await recordOne(studio);
    const materialId = studio.materials.value[0].id;
    await studio.requestDeleteMaterial(materialId);
    expect(studio.pendingDelete.value?.affected).toHaveLength(1);
    expect(studio.materials.value).toHaveLength(1);
    await studio.confirmDeleteMaterial(false);
    expect(studio.materials.value).toHaveLength(1);
    expect(studio.items.value).toHaveLength(1);
    await studio.requestDeleteMaterial(materialId);
    await studio.confirmDeleteMaterial(true);
    expect(studio.materials.value).toHaveLength(0);
    expect(studio.items.value).toHaveLength(0);
    expect(deps.pool).toHaveLength(0);
  });
  it('deletes unreferenced materials without confirmation', async () => {
    const studio = useStudio(dependencies()); await recordOne(studio);
    studio.removeItem(studio.items.value[0].id);
    await studio.requestDeleteMaterial(studio.materials.value[0].id);
    expect(studio.pendingDelete.value).toBeUndefined();
    expect(studio.materials.value).toHaveLength(0);
  });
  it('restores materials and the draft arrangement so editing can continue', async () => {
    const deps = dependencies(); const first = useStudio(deps); await recordOne(first);
    first.insertSilence(0);
    await Promise.resolve();
    const second = useStudio(deps);
    await second.restoreWorkspace();
    expect(second.stage.value).toBe('arrange');
    expect(second.materials.value).toHaveLength(1);
    expect(second.items.value.map((item: TimelineItem) => item.kind)).toEqual(['clip', 'silence']);
  });
  it('saves the composed audio and arranged duration, not the raw material', async () => {
    const deps = dependencies(); const studio = useStudio(deps); await recordOne(studio);
    const materialId = studio.materials.value[0].id;
    studio.addClip(materialId);
    studio.patchItem(studio.items.value[0].id, { crossfade: 0.5 });
    await studio.composeAndAnalyze(); studio.goCover();
    await studio.save();
    expect(studio.stage.value).toBe('collection');
    const works = await deps.repository.list();
    expect(works[0].duration).toBeCloseTo(3.5);
    expect(works[0].audio.size).toBe(3);
  });
  it('keeps the draft when saving fails and can edit an existing work', async () => {
    const studio = useStudio(dependencies({ repository: { list:async()=>[], save:async()=>{throw new DOMException('full','QuotaExceededError')}, rename:async()=>{}, delete:async()=>{} } }));
    studio.composed.value = { blob: new Blob(['a']), duration: 1, token: studio.version.value };
    studio.cover.value = coverPresetFor('温柔姐姐'); studio.emotion.value = { label:'温柔姐姐',confidence:.8,explanation:'柔和',scores:{'暴躁老哥':0,'温柔姐姐':1,'阴阳怪气':0,'元气满满':0} };
    studio.features.value = { loudness:.2,dynamics:.2,pitch:.4,zeroCrossing:.2,pauseRatio:.3,tempoVariation:.2 };
    await studio.save(); expect(studio.error.value).toContain('保存失败'); expect(studio.composed.value?.blob.size).toBe(1);
    const existing = { id:'old',title:'旧作品',emotion:'温柔姐姐' as const,confidence:.8,features:{loudness:.2,dynamics:.2,pitch:.4,zeroCrossing:.2,pauseRatio:.3,tempoVariation:.2},audio:new Blob(['a']),duration:1,cover:new Blob(['c']),coverConfig:coverPresetFor('温柔姐姐'),createdAt:'2026-10-05' };
    studio.editMeme(existing); expect(studio.draft.title).toBe('旧作品'); expect(studio.stage.value).toBe('cover');
  });
});
