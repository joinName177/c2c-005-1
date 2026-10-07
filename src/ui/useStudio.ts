import { computed, ref } from 'vue';
import { classifyEmotion } from '../core/emotion-engine';
import { coverPresetFor } from '../core/cover-presets';
import {
  arrangementSignature,
  clipsReferencing,
  createClip,
  scheduleClips,
  validateArrangement,
  type ArrangementClip,
  type AudioSource,
} from '../core/arrangement';
import type { AudioFeatures, CoverConfig, EmotionLabel, EmotionResult, StudioStage, VoiceMeme } from '../core/models';
import type { RecorderPort } from '../ports/recorder.port';
import type { AudioAnalyzerPort } from '../ports/audio-analyzer.port';
import type { AudioCropperPort } from '../ports/audio-cropper.port';
import type { AudioArrangerPort } from '../ports/audio-arranger.port';
import type { CoverRendererPort } from '../ports/cover-renderer.port';
import type { MemeRepository } from '../ports/meme-repository.port';
import type { DraftRepository } from '../ports/draft-repository.port';
import type { SharePort } from '../ports/share.port';

export interface StudioDependencies {
  recorder: RecorderPort;
  analyzer: AudioAnalyzerPort;
  cropper: AudioCropperPort;
  arranger: AudioArrangerPort;
  renderer: CoverRendererPort;
  repository: MemeRepository;
  drafts: DraftRepository;
  share: SharePort;
  id?: () => string;
  debounce?: (fn: () => void, ms: number) => () => void;
}

const uidFactory = () => `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const debounceFactory = (fn: () => void, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => { if (timer) clearTimeout(timer); timer = setTimeout(fn, ms); };
};

export function useStudio(deps: StudioDependencies) {
  const uid = deps.id ?? uidFactory;
  const stage = ref<StudioStage>('record');
  const error = ref('');
  const notice = ref('');
  const level = ref(0);

  const draftId = ref<string>();
  const title = ref('我的声音表情');
  const sources = ref<Array<AudioSource & { blob: Blob }>>([]);
  const clips = ref<ArrangementClip[]>([]);
  const cover = ref<CoverConfig>(coverPresetFor('元气满满'));
  const emotion = ref<EmotionResult>();
  const features = ref<AudioFeatures>();
  const collection = ref<VoiceMeme[]>([]);

  const processing = ref(false);
  const progressLabel = ref('');
  const renderedBlob = ref<Blob>();
  const renderedDuration = ref(0);
  const renderedSignature = ref('');
  const stale = ref(false);
  const hasDraft = ref(false);
  const resumed = ref(false);
  /** 编排修订号：任何改动都递增，用于判定处理结果是否已过期。 */
  let revision = 0;

  /** 待确认删除的素材及其受影响片段。 */
  const pendingSourceRemoval = ref<{ source: AudioSource; affected: ArrangementClip[] }>();

  const schedule = computed(() => scheduleClips(clips.value));
  const sourceDurations = computed<Record<string, number>>(() =>
    Object.fromEntries(sources.value.map((source) => [source.id, source.duration])));
  const issues = computed(() => validateArrangement(clips.value, sourceDurations.value));
  const canArrange = computed(() => clips.value.length > 0 && issues.value.length === 0);
  const analysisCurrent = computed(() =>
    !stale.value && !!emotion.value && renderedSignature.value === signature());
  const overLimit = computed(() => schedule.value.duration > 10);
  function signature() { return arrangementSignature(clips.value); }

  // ---------- 草稿持久化（只存选择 + 原素材 Blob；失败不阻断编辑） ----------
  const persist = () => {
    deps.drafts.saveDraft({
      title: title.value,
      clips: clips.value.map(({ ...clip }) => clip),
      sources: sources.value.map(({ id, name, duration, kind }) => ({ id, name, duration, kind })),
      memeId: draftId.value,
    }).catch(() => { /* 存储不可用时仍可继续本次编辑 */ });
  };
  const schedulePersist = deps.debounce ? deps.debounce(persist, 300) : debounceFactory(persist, 300);
  function touch() {
    revision += 1;
    hasDraft.value = clips.value.length > 0 || sources.value.length > 0;
    // 编排变化后，已经合成/分析出的旧结果立即失效。
    if (renderedSignature.value) stale.value = true;
    schedulePersist();
  }

  // ---------- 录音 / 导入 → 素材池 ----------
  async function startRecording() {
    error.value = '';
    try {
      await deps.recorder.start((value) => { level.value = value; });
      notice.value = '正在录音，录完会进入素材池';
    } catch {
      error.value = '无法使用麦克风权限，请在浏览器设置中允许访问或导入音频。';
    }
  }
  async function stopRecording() {
    try {
      const blob = await deps.recorder.stop();
      await addSource(blob, `录音 ${sources.value.length + 1}`, 'record');
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '录音结束失败';
    }
  }
  async function importAudio(blob: Blob) {
    error.value = '';
    try { await addSource(blob, blob instanceof File ? blob.name : `导入音频 ${sources.value.length + 1}`, 'import'); }
    catch (cause) { error.value = cause instanceof Error ? cause.message : '音频无法解码，请换一个文件'; }
  }
  async function addSource(blob: Blob, name: string, kind: AudioSource['kind']) {
    const info = await deps.cropper.inspect(blob);
    const id = uid();
    sources.value = [...sources.value, { id, name, duration: info.duration, kind, blob }];
    await deps.drafts.putSource(id, blob).catch(() => undefined);
    // 首个素材自动生成一段全选片段，直接开始编排。
    if (clips.value.length === 0) clips.value = [createClip(id, info.duration, uid())];
    stage.value = 'arrange';
    notice.value = '素材已放入素材池，原素材始终保留，剪辑只记录选择范围';
    touch();
  }

  // ---------- 编排台操作（每次改动自动重排后续位置） ----------
  function updateClip(id: string, patch: Partial<Pick<ArrangementClip, 'start' | 'end' | 'silenceAfter' | 'crossfade'>>) {
    const index = clips.value.findIndex((clip) => clip.id === id);
    if (index < 0) return;
    clips.value = clips.value.map((clip, clipIndex) => {
      if (clipIndex !== index) return clip;
      const next = { ...clip, ...patch };
      if (patch.start !== undefined) next.start = clampStart(patch.start, next.end);
      if (patch.end !== undefined) next.end = clampEnd(patch.end, next.start, clip.sourceId);
      next.silenceAfter = Math.max(0, next.silenceAfter);
      // 交叉淡化不能超过相邻段长度，也不能越过本段起点（静音之后的重叠上限）。
      const neighbour = clips.value[index + 1];
      if (neighbour) {
        const cap = Math.min(next.end - next.start, neighbour.end - neighbour.start, next.end - next.start + next.silenceAfter);
        next.crossfade = Math.max(0, Math.min(next.crossfade, cap));
      } else {
        next.crossfade = 0;
      }
      return next;
    });
    touch();
  }
  function clampStart(start: number, end: number) { return Math.max(0, Math.min(start, Math.max(0, end - 0.05))); }
  function clampEnd(end: number, start: number, sourceId: string) {
    const duration = sourceDurations.value[sourceId] ?? end;
    return Math.min(duration, Math.max(end, start + 0.05));
  }
  function appendClip(sourceId: string) {
    const source = sources.value.find((item) => item.id === sourceId);
    if (!source) return;
    clips.value = [...clips.value, createClip(sourceId, source.duration, uid())];
    touch();
  }
  function removeClip(id: string) {
    clips.value = clips.value.filter((clip) => clip.id !== id);
    touch();
  }
  function moveClip(id: string, delta: -1 | 1) {
    const index = clips.value.findIndex((clip) => clip.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= clips.value.length) return;
    const next = [...clips.value];
    [next[index], next[target]] = [next[target], next[index]];
    clips.value = next;
    touch();
  }

  // ---------- 删除素材：先列受影响片段 ----------
  async function requestRemoveSource(sourceId: string) {
    const source = sources.value.find((item) => item.id === sourceId);
    if (!source) return;
    const affected = clipsReferencing(clips.value, sourceId);
    if (affected.length) pendingSourceRemoval.value = { source, affected };
    else await confirmRemoveSource(source, false);
  }
  function cancelRemoveSource() { pendingSourceRemoval.value = undefined; }
  async function confirmRemoveSource(source: AudioSource, removeClips: boolean) {
    pendingSourceRemoval.value = undefined;
    if (removeClips) clips.value = clips.value.filter((clip) => clip.sourceId !== source.id);
    sources.value = sources.value.filter((item) => item.id !== source.id);
    await deps.drafts.deleteSources([source.id]).catch(() => undefined);
    touch();
  }

  // ---------- 合成 + 情绪分析（同一份编排产出，供试听与保存共用） ----------
  async function renderArrangement() {
    if (!canArrange.value) { error.value = '编排还不能合成，请检查片段范围与总时长'; return; }
    error.value = '';
    processing.value = true;
    progressLabel.value = '正在离线合成多片段';
    const requested = signature();
    const revisionAtStart = revision;
    try {
      const sourceBlobs = Object.fromEntries(sources.value.map((source) => [source.id, source.blob]));
      const result = await deps.arranger.render({ schedule: schedule.value, sources: sourceBlobs });
      renderedBlob.value = result.blob;
      renderedDuration.value = result.duration;
      renderedSignature.value = requested;
      // 处理期间继续编辑：旧结果即使刚产出也立即标记失效。
      stale.value = revision !== revisionAtStart;
      notice.value = stale.value ? '编排已被修改，试听结果为旧版本，请重新生成' : '合成完成，可以试听';
    } catch {
      // 失败时保留当前编排，允许原样重试。
      error.value = '合成失败，编排仍保留，请重试';
    } finally {
      processing.value = false;
      progressLabel.value = '';
    }
  }
  async function analyze() {
    if (!renderedBlob.value || stale.value) {
      error.value = '请先生成与当前编排一致的试听';
      return;
    }
    processing.value = true;
    progressLabel.value = '正在分析情绪';
    const requested = renderedSignature.value;
    try {
      const result = await deps.analyzer.analyze(renderedBlob.value);
      features.value = result.features;
      emotion.value = classifyEmotion(result.features);
      cover.value = coverPresetFor(emotion.value.label);
      stage.value = 'emotion';
      notice.value = '';
      // 落库时校验编辑期间编排是否变化。
      if (signature() !== requested) stale.value = true;
    } catch {
      error.value = '情绪分析失败，合成结果和编排都已保留，可以重试';
    } finally {
      processing.value = false;
      progressLabel.value = '';
    }
  }
  function selectEmotion(label: EmotionLabel) {
    const current = emotion.value ?? classifyEmotion({ loudness: 0, dynamics: 0, pitch: 0, zeroCrossing: 0, pauseRatio: 1, tempoVariation: 0 });
    emotion.value = { ...current, label, explanation: `已手动选择「${label}」标签。` };
    cover.value = { ...coverPresetFor(label), title: cover.value.title || label };
  }
  function goCover() { if (analysisCurrent.value) stage.value = 'cover'; }

  // ---------- 保存与作品 ----------
  async function save(target?: HTMLCanvasElement) {
    if (!renderedBlob.value || !emotion.value || !features.value) {
      error.value = '作品信息尚未完整，请先完成合成与声音分析';
      return;
    }
    if (!analysisCurrent.value) {
      error.value = '编排已修改，旧结果已失效，请重新合成分析后再保存';
      return;
    }
    try {
      const coverBlob = await deps.renderer.render(cover.value, target);
      const meme: VoiceMeme = {
        id: draftId.value ?? `meme-${Date.now()}`,
        title: title.value.trim() || '未命名声音',
        emotion: emotion.value.label,
        confidence: emotion.value.confidence,
        features: features.value,
        audio: renderedBlob.value,
        duration: renderedDuration.value,
        cover: coverBlob,
        coverConfig: { ...cover.value },
        createdAt: new Date().toISOString(),
        arrangement: { clips: clips.value.map((clip) => ({ ...clip })) },
      };
      await deps.repository.save(meme);
      draftId.value = meme.id;
      await loadCollection();
      // 已确认的作品不再提示“未完成编排”，但素材与选择保留，供再次编辑。
      await deps.drafts.saveDraft({
        title: title.value,
        clips: clips.value.map((clip) => ({ ...clip })),
        sources: sources.value.map(({ id, name, duration, kind }) => ({ id, name, duration, kind })),
        memeId: meme.id,
      }).catch(() => undefined);
      stage.value = 'collection';
      notice.value = '作品已保存到本地';
    } catch {
      error.value = '保存失败，编排内容仍保留，请检查浏览器存储空间后重试。';
    }
  }
  async function loadCollection() {
    collection.value = (await deps.repository.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function editMeme(meme: VoiceMeme) {
    error.value = '';
    notice.value = '';
    draftId.value = meme.id;
    title.value = meme.title;
    cover.value = { ...meme.coverConfig };
    emotion.value = {
      label: meme.emotion, confidence: meme.confidence, explanation: '编辑已保存作品',
      scores: { '暴躁老哥': 0, '温柔姐姐': 0, '阴阳怪气': 0, '元气满满': 0 },
    };
    features.value = meme.features;
    const stored = meme.arrangement;
    const sourceIds = [...new Set((stored?.clips ?? []).map((clip) => clip.sourceId))];
    const blobs = await Promise.all(sourceIds.map((sourceId) => deps.drafts.getSource(sourceId)));
    const restorable = !!stored && stored.clips.length > 0 && sourceIds.length > 0 && blobs.every((blob) => !!blob);
    if (restorable && stored) {
      // 素材仍在：完整恢复多片段编排，接着改。
      const meta = (await deps.drafts.loadDraft())?.sources ?? [];
      sources.value = sourceIds.map((sourceId, index) => {
        const info = meta.find((item) => item.id === sourceId);
        return {
          id: sourceId,
          name: info?.name ?? '素材',
          duration: info?.duration ?? 0,
          kind: info?.kind ?? 'import',
          blob: blobs[index]!,
        };
      });
      clips.value = stored.clips.map((clip) => ({ ...clip }));
      renderedBlob.value = meme.audio;
      renderedDuration.value = meme.duration;
      renderedSignature.value = signature();
      stale.value = false;
      stage.value = 'arrange';
      notice.value = '已恢复上次的编排和素材，可以继续调整';
    } else {
      // 旧作品或素材缺失：回退为单段音频，直接编辑封面。
      sources.value = [{ id: uid(), name: meme.title, duration: meme.duration, kind: 'import', blob: meme.audio }];
      clips.value = [];
      renderedBlob.value = meme.audio;
      renderedDuration.value = meme.duration;
      renderedSignature.value = '';
      stale.value = false;
      stage.value = 'cover';
    }
    hasDraft.value = true;
  }
  async function deleteMeme(id: string) {
    await deps.repository.delete(id);
    await loadCollection();
  }
  async function shareMeme(meme: VoiceMeme) {
    const result = await deps.share.share(meme);
    notice.value = result === 'shared' ? '已打开系统分享' : '浏览器不支持文件分享，已下载音频和封面';
  }

  // ---------- 重新打开继续编辑 ----------
  async function resumeDraft() {
    const stored = await deps.drafts.loadDraft();
    if (!stored) return;
    const loaded: typeof sources.value = [];
    for (const meta of stored.sources) {
      const blob = await deps.drafts.getSource(meta.id);
      if (blob) loaded.push({ ...meta, blob });
    }
    const validIds = new Set(loaded.map((source) => source.id));
    sources.value = loaded;
    clips.value = stored.clips
      .filter((clip) => validIds.has(clip.sourceId))
      .map((clip) => ({ ...clip }));
    title.value = stored.title;
    draftId.value = stored.memeId;
    hasDraft.value = true;
    resumed.value = true;
    stage.value = clips.value.length ? 'arrange' : 'record';
    notice.value = '已恢复未完成的编排，可以接着编辑';
  }
  function dismissResume() { resumed.value = false; }
  function newRecording() {
    draftId.value = undefined;
    title.value = '我的声音表情';
    sources.value = [];
    clips.value = [];
    emotion.value = undefined;
    features.value = undefined;
    renderedBlob.value = undefined;
    renderedDuration.value = 0;
    renderedSignature.value = '';
    stale.value = false;
    hasDraft.value = false;
    stage.value = 'record';
    error.value = '';
    notice.value = '';
    void deps.drafts.clearDraft().catch(() => undefined);
  }
  function backToRecord() { stage.value = 'record'; }
  function backToArrange() { stage.value = 'arrange'; }
  function setTitle(value: string) {
    title.value = value;
    if (hasDraft.value) schedulePersist();
  }

  return {
    stage, error, notice, level, title, sources, clips, schedule, issues, overLimit, canArrange,
    cover, emotion, features, collection, processing, progressLabel, renderedBlob, renderedDuration,
    stale, analysisCurrent, hasDraft, resumed, pendingSourceRemoval,
    startRecording, stopRecording, importAudio, updateClip, appendClip, removeClip, moveClip,
    requestRemoveSource, cancelRemoveSource, confirmRemoveSource,
    renderArrangement, analyze, selectEmotion, goCover,
    save, loadCollection, editMeme, deleteMeme, shareMeme,
    resumeDraft, dismissResume, newRecording, backToRecord, backToArrange, setTitle,
  };
}
