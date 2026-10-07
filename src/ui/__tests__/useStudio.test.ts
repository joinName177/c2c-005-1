import { describe, expect, it, vi } from 'vitest';
import { useStudio, type StudioDependencies } from '../useStudio';
import { coverPresetFor } from '../../core/cover-presets';
import type { VoiceMeme } from '../../core/models';
import type { DraftRepository, StoredDraft } from '../../ports/draft-repository.port';

class MemoryDrafts implements DraftRepository {
  draft: StoredDraft | null = null;
  blobs = new Map<string, Blob>();
  async loadDraft() { return this.draft ? JSON.parse(JSON.stringify(this.draft)) : null; }
  async saveDraft(draft: NonNullable<MemoryDrafts['draft']>) { this.draft = JSON.parse(JSON.stringify(draft)); }
  async clearDraft() { this.draft = null; this.blobs.clear(); }
  async getSource(id: string) { return this.blobs.get(id); }
  async putSource(id: string, blob: Blob) { this.blobs.set(id, blob); }
  async deleteSources(ids: string[]) { ids.forEach((id) => this.blobs.delete(id)); }
}

function dependencies(overrides: Partial<StudioDependencies> = {}): StudioDependencies {
  const saved: VoiceMeme[] = [];
  const seq = (() => { let n = 0; return () => `id-${++n}`; })();
  return {
    id: seq,
    debounce: (fn) => fn,
    recorder: { isRecording: false, start: async () => {}, stop: async () => new Blob(['voice'], { type: 'audio/webm' }) },
    analyzer: { analyze: async () => ({ duration: 2, features: { loudness: .75, dynamics: .55, pitch: .8, zeroCrossing: .62, pauseRatio: .12, tempoVariation: .6 } }) },
    cropper: { inspect: async () => ({ duration: 6, needsCrop: false }), crop: async (blob, range) => ({ blob, duration: range.end - range.start }) },
    arranger: { render: async ({ schedule }) => ({ blob: new Blob(['mix']), duration: schedule.duration }) },
    renderer: { render: async () => new Blob(['cover'], { type: 'image/png' }) },
    repository: { list: async () => saved, save: async (m) => { saved.push(m); }, rename: async () => {}, delete: async () => {} },
    drafts: new MemoryDrafts(),
    share: { share: async () => 'shared' as const },
    ...overrides,
  };
}

async function toAnalyze(studio: ReturnType<typeof useStudio>) {
  await studio.startRecording();
  await studio.stopRecording();
  await studio.renderArrangement();
  await studio.analyze();
}

describe('useStudio 多片段编排', () => {
  it('录音与导入都进入素材池，首个素材自动生成片段且原素材保留', async () => {
    const studio = useStudio(dependencies());
    await studio.startRecording(); await studio.stopRecording();
    expect(studio.stage.value).toBe('arrange');
    expect(studio.sources.value).toHaveLength(1);
    expect(studio.clips.value).toHaveLength(1);
    await studio.importAudio(new Blob(['file']));
    expect(studio.sources.value).toHaveLength(2);
    expect(studio.clips.value).toHaveLength(1);
    studio.appendClip(studio.sources.value[1].id);
    expect(studio.clips.value).toHaveLength(2);
    expect(studio.sources.value[0].blob.size).toBeGreaterThan(0);
  });

  it('改前一段长度与静音、淡化后，后续片段位置随之重排并扣除重叠', async () => {
    const studio = useStudio(dependencies({
      cropper: { inspect: async () => ({ duration: 8, needsCrop: false }), crop: async (b, r) => ({ blob: b, duration: r.end - r.start }) },
    }));
    await studio.stopRecording();
    await studio.importAudio(new Blob());
    studio.appendClip(studio.sources.value[1].id);
    expect(studio.schedule.value.duration).toBeCloseTo(16);
    const first = studio.clips.value[0].id;
    studio.updateClip(first, { end: 4, silenceAfter: 2, crossfade: 1 });
    const [a, b] = studio.schedule.value.clips;
    expect(a.at).toBeCloseTo(0);
    expect(a.out - a.at).toBeCloseTo(4);
    expect(b.at).toBeCloseTo(5); // 4 + 2 静音 − 1 重叠
    expect(studio.schedule.value.duration).toBeCloseTo(13);
    studio.updateClip(first, { end: 6 });
    expect(studio.schedule.value.clips[1].at).toBeCloseTo(7); // 6 + 2 − 1
    expect(studio.schedule.value.duration).toBeCloseTo(15);
    expect(studio.overLimit.value).toBe(true);
    expect(studio.canArrange.value).toBe(false);
    expect(studio.issues.value.some((i) => i.message.includes('10 秒'))).toBe(true);
  });

  it('总时长超限时禁止合成', async () => {
    const studio = useStudio(dependencies({ cropper: { inspect: async () => ({ duration: 8, needsCrop: false }), crop: async () => ({ blob: new Blob(), duration: 8 }) } }));
    await studio.stopRecording();
    await studio.importAudio(new Blob());
    studio.appendClip(studio.sources.value[1].id);
    await studio.renderArrangement();
    expect(studio.error.value).toContain('不能合成');
    expect(studio.renderedBlob.value).toBeUndefined();
  });

  it('试听与最终保存使用同一份合成产物', async () => {
    const renderSpy = vi.fn(async ({ schedule }: { schedule: { duration: number } }) => ({ blob: new Blob(['mix']), duration: schedule.duration }));
    const studio = useStudio(dependencies({ arranger: { render: renderSpy } }));
    await toAnalyze(studio);
    studio.selectEmotion('元气满满'); studio.goCover();
    await studio.save();
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(studio.collection.value[0].audio.size).toBe((await renderSpy.mock.results[0].value).blob.size);
    expect(studio.collection.value[0].duration).toBe(6);
  });

  it('处理中继续编辑会让刚完成的合成结果立即失效，可重新生成', async () => {
    let release: ((v: { blob: Blob; duration: number }) => void) | undefined;
    const pending = new Promise<{ blob: Blob; duration: number }>((resolve) => { release = resolve; });
    const studio = useStudio(dependencies({
      arranger: { render: () => pending },
    }));
    await studio.stopRecording();
    const rendering = studio.renderArrangement();
    expect(studio.processing.value).toBe(true);
    studio.updateClip(studio.clips.value[0].id, { end: 3 }); // 处理中编辑
    release!({ blob: new Blob(['old']), duration: 3 });
    await rendering;
    expect(studio.stale.value).toBe(true);
    // 旧结果不能进入分析/确认
    await studio.analyze();
    expect(studio.error.value).toContain('试听');
    await studio.renderArrangement();
    expect(studio.stale.value).toBe(false);
  });

  it('合成失败保留编排，重试后成功', async () => {
    const studio = useStudio(dependencies({
      arranger: { render: async () => { throw new Error('boom'); } },
    }));
    await studio.stopRecording();
    await studio.renderArrangement();
    expect(studio.error.value).toContain('合成失败');
    expect(studio.clips.value).toHaveLength(1);
    expect(studio.processing.value).toBe(false);
  });

  it('分析后再改编排会令旧结果失效，并阻止确认保存', async () => {
    const studio = useStudio(dependencies());
    await toAnalyze(studio);
    expect(studio.stage.value).toBe('emotion');
    studio.selectEmotion('元气满满');
    studio.goCover();
    expect(studio.stage.value).toBe('cover');
    // 回编排台调整保留范围，旧合成/分析立即失效
    studio.backToArrange();
    studio.updateClip(studio.clips.value[0].id, { end: 3 });
    expect(studio.stale.value).toBe(true);
    expect(studio.analysisCurrent.value).toBe(false);
    // 情绪面板不允许继续
    studio.stage.value = 'emotion';
    studio.goCover();
    expect(studio.stage.value).toBe('emotion');
    // 直接保存也被拦截
    await studio.save();
    expect(studio.error.value).toContain('已失效');
    expect(studio.collection.value).toHaveLength(0);
  });

  it('删除被引用的素材先列出受影响片段，可取消或一并移除', async () => {
    const studio = useStudio(dependencies());
    await studio.stopRecording();
    const sourceId = studio.sources.value[0].id;
    studio.requestRemoveSource(sourceId);
    expect(studio.pendingSourceRemoval.value?.affected).toHaveLength(1);
    studio.cancelRemoveSource();
    expect(studio.sources.value).toHaveLength(1);
    studio.requestRemoveSource(sourceId);
    await studio.confirmRemoveSource(studio.pendingSourceRemoval.value!.source, true);
    expect(studio.sources.value).toHaveLength(0);
    expect(studio.clips.value).toHaveLength(0);
  });

  it('删除未被引用的素材无需确认且不影响其他片段', async () => {
    const studio = useStudio(dependencies());
    await studio.stopRecording();
    await studio.importAudio(new Blob());
    const unused = studio.sources.value[1];
    await studio.requestRemoveSource(unused.id);
    expect(studio.pendingSourceRemoval.value).toBeUndefined();
    expect(studio.sources.value).toHaveLength(1);
  });

  it('草稿持久化：刷新后可恢复素材与编排接着编辑', async () => {
    const deps = dependencies();
    const first = useStudio(deps);
    await first.stopRecording();
    first.updateClip(first.clips.value[0].id, { end: 2, silenceAfter: 0.5 });
    expect((await deps.drafts.loadDraft())?.clips[0].end).toBe(2);
    const reopened = useStudio(deps);
    await reopened.resumeDraft();
    expect(reopened.sources.value).toHaveLength(1);
    expect(reopened.clips.value[0].end).toBe(2);
    expect(reopened.stage.value).toBe('arrange');
  });

  it('再次编辑已保存作品时恢复完整编排', async () => {
    const deps = dependencies();
    const studio = useStudio(deps);
    await toAnalyze(studio);
    studio.selectEmotion('温柔姐姐'); studio.goCover(); await studio.save();
    const meme = studio.collection.value[0];
    const again = useStudio(deps);
    await again.editMeme(meme);
    expect(again.stage.value).toBe('arrange');
    expect(again.clips.value).toHaveLength(1);
    expect(again.sources.value).toHaveLength(1);
  });

  it('旧作品（无编排）回退为单段编辑封面', async () => {
    const studio = useStudio(dependencies());
    const legacy: VoiceMeme = {
      id: 'legacy', title: '旧', emotion: '温柔姐姐', confidence: .8,
      features: { loudness: .2, dynamics: .2, pitch: .4, zeroCrossing: .2, pauseRatio: .3, tempoVariation: .2 },
      audio: new Blob(['a']), duration: 1, cover: new Blob(['c']), coverConfig: coverPresetFor('温柔姐姐'), createdAt: '2026-10-05',
    };
    await studio.editMeme(legacy);
    expect(studio.stage.value).toBe('cover');
  });
});
