import { computed, reactive, ref } from 'vue';
import { classifyEmotion } from '../core/emotion-engine';
import { coverPresetFor } from '../core/cover-presets';
import { clipsUsingMaterial, createClipItem, createSilenceItem, layoutTimeline, validateArrangement, type TimelineItem } from '../core/arrangement';
import type { AudioFeatures, AudioMaterial, CoverConfig, EmotionLabel, EmotionResult, StudioStage, VoiceMeme } from '../core/models';
import type { RecorderPort } from '../ports/recorder.port';
import type { AudioAnalyzerPort } from '../ports/audio-analyzer.port';
import type { AudioCropperPort } from '../ports/audio-cropper.port';
import type { ArrangementComposerPort } from '../ports/arrangement-composer.port';
import type { MaterialRepositoryPort } from '../ports/material-repository.port';
import type { DraftStorePort } from '../ports/draft-store.port';
import type { CoverRendererPort } from '../ports/cover-renderer.port';
import type { MemeRepository } from '../ports/meme-repository.port';
import type { SharePort } from '../ports/share.port';

export interface StudioDependencies { recorder: RecorderPort; analyzer: AudioAnalyzerPort; cropper: AudioCropperPort; composer: ArrangementComposerPort; materials: MaterialRepositoryPort; drafts: DraftStorePort; renderer: CoverRendererPort; repository: MemeRepository; share: SharePort }
export interface ItemPatch { start?: number; end?: number; duration?: number; crossfade?: number }

export function useStudio(deps: StudioDependencies) {
  const stage = ref<StudioStage>('record'); const error = ref(''); const notice = ref(''); const level = ref(0);
  const draft = reactive<{ id?: string; title: string }>({ title: '我的声音表情' });
  const materials = ref<AudioMaterial[]>([]); const items = ref<TimelineItem[]>([]);
  const version = ref(0); const processing = ref(false);
  const composed = ref<{ blob: Blob; duration: number; token: number }>();
  const previewBlob = ref<Blob>(); const previewKey = ref(0);
  const pendingDelete = ref<{ material: AudioMaterial; affected: ReturnType<typeof clipsUsingMaterial> }>();
  const emotion = ref<EmotionResult>(); const features = ref<AudioFeatures>(); const cover = ref<CoverConfig>(coverPresetFor('元气满满')); const collection = ref<VoiceMeme[]>([]);
  const totalDuration = computed(() => layoutTimeline(items.value).total);
  const arrangementError = computed(() => (items.value.length ? validateArrangement(items.value, materials.value) : undefined));
  const readyToSave = computed(() => Boolean(composed.value && composed.value.token === version.value && emotion.value && features.value));

  function persistDraft() { void deps.drafts.save({ title: draft.title, items: JSON.parse(JSON.stringify(items.value)) as TimelineItem[], updatedAt: new Date().toISOString() }).catch(() => {}); }
  function invalidate() { version.value += 1; composed.value = undefined; emotion.value = undefined; features.value = undefined; persistDraft(); }

  async function startRecording() { error.value = ''; try { await deps.recorder.start((value) => { level.value = value; }); notice.value = '正在录音，最长 10 秒'; } catch { error.value = '无法使用麦克风权限，请在浏览器设置中允许访问或导入音频。'; } }
  async function addMaterial(blob: Blob, name?: string) {
    const info = await deps.cropper.inspect(blob);
    const material: AudioMaterial = { id: `mat-${Date.now()}-${materials.value.length}`, name: name?.trim() || `素材 ${materials.value.length + 1}`, blob, duration: info.duration, createdAt: new Date().toISOString() };
    materials.value = [...materials.value, material];
    try { await deps.materials.save(material); } catch { error.value = '素材未能保存到本地，刷新后可能丢失'; }
    return material;
  }
  async function stopRecording() { try { const blob = await deps.recorder.stop(); const material = await addMaterial(blob, `录音 ${new Date().toLocaleTimeString()}`); if (!items.value.length) addClip(material.id); stage.value = 'arrange'; notice.value = '录音已放入素材池，可继续编排'; } catch (cause) { error.value = cause instanceof Error ? cause.message : '录音结束失败'; } }
  async function importAudio(blob: Blob, name?: string) { try { const material = await addMaterial(blob, name); if (!items.value.length) addClip(material.id); stage.value = 'arrange'; notice.value = '素材已导入素材池'; } catch { error.value = '无法读取这段音频，请换一份素材'; } }

  function addClip(materialId: string) { const material = materials.value.find((entry) => entry.id === materialId); if (!material) return; items.value = [...items.value, createClipItem(material)]; invalidate(); }
  function insertSilence(afterIndex = items.value.length - 1) { const next = [...items.value]; next.splice(Math.min(afterIndex + 1, next.length), 0, createSilenceItem()); items.value = next; invalidate(); }
  function moveItem(id: string, delta: number) { const index = items.value.findIndex((item) => item.id === id); const target = index + delta; if (index < 0 || target < 0 || target >= items.value.length) return; const next = [...items.value]; [next[index], next[target]] = [next[target], next[index]]; items.value = next; invalidate(); }
  function removeItem(id: string) { items.value = items.value.filter((item) => item.id !== id); invalidate(); }
  function patchItem(id: string, patch: ItemPatch) { items.value = items.value.map((item) => (item.id === id ? { ...item, ...patch } : item)); invalidate(); }

  async function requestDeleteMaterial(id: string) {
    const material = materials.value.find((entry) => entry.id === id); if (!material) return;
    const affected = clipsUsingMaterial(items.value, id);
    if (affected.length) { pendingDelete.value = { material, affected }; return; }
    materials.value = materials.value.filter((entry) => entry.id !== id); await deps.materials.delete(id);
  }
  async function confirmDeleteMaterial(removeClips: boolean) {
    const pending = pendingDelete.value; pendingDelete.value = undefined;
    if (!pending || !removeClips) return;
    items.value = items.value.filter((item) => !(item.kind === 'clip' && item.materialId === pending.material.id)); invalidate();
    materials.value = materials.value.filter((entry) => entry.id !== pending.material.id); await deps.materials.delete(pending.material.id);
  }

  async function composeCurrent(token: number) {
    if (composed.value && composed.value.token === token) return composed.value;
    const result = await deps.composer.compose(materials.value, items.value);
    if (token !== version.value) return undefined;
    composed.value = { ...result, token };
    return composed.value;
  }
  async function preview() {
    const problem = validateArrangement(items.value, materials.value); if (problem) { error.value = problem; return; }
    error.value = ''; const token = version.value; processing.value = true;
    try { const result = await composeCurrent(token); if (!result) return; previewBlob.value = result.blob; previewKey.value += 1; notice.value = '试听与最终保存使用同一份编排'; }
    catch (cause) { error.value = cause instanceof Error ? `合成失败：${cause.message}，编排已保留，可调整后重试` : '合成失败，编排已保留，可重试'; }
    finally { processing.value = false; }
  }
  async function composeAndAnalyze() {
    const problem = validateArrangement(items.value, materials.value); if (problem) { error.value = problem; return; }
    error.value = ''; const token = version.value; processing.value = true;
    try {
      const result = await composeCurrent(token); if (!result) return;
      const analysis = await deps.analyzer.analyze(result.blob); if (token !== version.value) return;
      features.value = analysis.features; emotion.value = classifyEmotion(analysis.features); cover.value = coverPresetFor(emotion.value.label); stage.value = 'emotion';
    } catch (cause) { error.value = cause instanceof Error ? `合成失败：${cause.message}，编排已保留，可调整后重试` : '合成失败，编排已保留，可重试'; }
    finally { processing.value = false; }
  }

  function selectEmotion(label: EmotionLabel) { const current = emotion.value ?? classifyEmotion({ loudness:0,dynamics:0,pitch:0,zeroCrossing:0,pauseRatio:1,tempoVariation:0 }); emotion.value = { ...current, label, explanation: `已手动选择「${label}」标签。` }; cover.value = { ...coverPresetFor(label), title: cover.value.title || label }; }
  function goCover() { stage.value = 'cover'; }
  function backToRecord() { stage.value = 'record'; }
  async function save(target?: HTMLCanvasElement) {
    if (!composed.value || composed.value.token !== version.value || !emotion.value || !features.value) { error.value = '请先完成合成与情绪分析，再确认作品'; return; }
    try { const coverBlob = await deps.renderer.render(cover.value, target); const meme: VoiceMeme = { id: draft.id ?? `meme-${Date.now()}`, title: draft.title.trim() || '未命名声音', emotion: emotion.value.label, confidence: emotion.value.confidence, features: features.value, audio: composed.value.blob, duration: composed.value.duration, cover: coverBlob, coverConfig: { ...cover.value }, createdAt: new Date().toISOString() }; await deps.repository.save(meme); await loadCollection(); stage.value = 'collection'; notice.value = '作品已保存到本地'; } catch { error.value = '保存失败，本次编辑内容仍保留，请检查浏览器存储空间。'; }
  }
  async function loadCollection() { collection.value = (await deps.repository.list()).sort((a,b) => b.createdAt.localeCompare(a.createdAt)); }
  async function restoreWorkspace() {
    materials.value = await deps.materials.list();
    const saved = await deps.drafts.load();
    if (saved) { draft.title = saved.title || draft.title; const known = new Set(materials.value.map((material) => material.id)); items.value = saved.items.filter((item) => item.kind !== 'clip' || known.has(item.materialId)); }
    if (items.value.length) stage.value = 'arrange';
  }
  function editMeme(meme: VoiceMeme) { draft.id = meme.id; draft.title = meme.title; composed.value = { blob: meme.audio, duration: meme.duration, token: version.value }; features.value = meme.features; emotion.value = { label:meme.emotion,confidence:meme.confidence,explanation:'编辑已保存作品',scores:{'暴躁老哥':0,'温柔姐姐':0,'阴阳怪气':0,'元气满满':0} }; cover.value = { ...meme.coverConfig }; stage.value = 'cover'; }
  async function deleteMeme(id: string) { await deps.repository.delete(id); await loadCollection(); }
  async function shareMeme(meme: VoiceMeme) { const result = await deps.share.share(meme); notice.value = result === 'shared' ? '已打开系统分享' : '浏览器不支持文件分享，已下载音频和封面'; }
  function newRecording() { draft.id = undefined; draft.title = '我的声音表情'; items.value = []; composed.value = undefined; emotion.value = undefined; features.value = undefined; version.value += 1; void deps.drafts.clear().catch(() => {}); stage.value = 'record'; error.value = ''; }
  return { stage,error,notice,level,draft,materials,items,version,processing,composed,previewBlob,previewKey,pendingDelete,emotion,features,cover,collection,totalDuration,arrangementError,readyToSave,startRecording,stopRecording,importAudio,addMaterial,addClip,insertSilence,moveItem,removeItem,patchItem,requestDeleteMaterial,confirmDeleteMaterial,preview,composeAndAnalyze,selectEmotion,goCover,backToRecord,save,loadCollection,restoreWorkspace,editMeme,deleteMeme,shareMeme,newRecording };
}
