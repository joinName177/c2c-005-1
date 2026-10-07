<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { ArrangementClip, AudioSource, PositionedClip } from '../../core/arrangement';
import { clipDuration, maxCrossfade } from '../../core/arrangement';

const props = defineProps<{
  title: string;
  sources: Array<AudioSource & { blob: Blob }>;
  clips: ArrangementClip[];
  positioned: PositionedClip[];
  duration: number;
  issues: Array<{ clipId: string; message: string }>;
  canArrange: boolean;
  processing: boolean;
  progressLabel: string;
  previewBlob?: Blob;
  previewDuration: number;
  stale: boolean;
}>();
const emit = defineEmits<{
  title: [title: string];
  addClip: [sourceId: string];
  patchClip: [id: string, patch: Partial<Pick<ArrangementClip, 'start' | 'end' | 'silenceAfter' | 'crossfade'>>];
  removeClip: [id: string];
  moveClip: [id: string, delta: -1 | 1];
  removeSource: [sourceId: string];
  render: [];
  analyze: [];
  back: [];
}>();

const sourceName = (id: string) => props.sources.find((source) => source.id === id)?.name ?? '（素材已删除）';
const clipIssues = (id: string) => props.issues.filter((issue) => issue.clipId === id).map((issue) => issue.message);
const globalIssues = computed(() => props.issues.filter((issue) => issue.clipId === '*'));
const trackStyle = (clip: PositionedClip) => ({
  left: `${(clip.at / 10) * 100}%`,
  width: `${(clipDuration(clip) / 10) * 100}%`,
});

const previewUrl = ref('');
const audioEl = ref<HTMLAudioElement>();
function makeObjectUrl(blob: Blob) {
  return typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : '';
}
function revokeObjectUrl(url: string) {
  if (url && typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(url);
}
watch(() => props.previewBlob, (blob) => {
  revokeObjectUrl(previewUrl.value);
  previewUrl.value = blob ? makeObjectUrl(blob) : '';
}, { immediate: true });
onBeforeUnmount(() => revokeObjectUrl(previewUrl.value));
</script>

<template>
  <section class="arrange-console">
    <div class="stage-card arrange-head">
      <div>
        <span class="kicker">02 / MULTI-CLIP DESK</span>
        <h2>多片段编排台</h2>
        <label class="arrange-title">作品名称
          <input :value="title" aria-label="作品名称" @input="emit('title', ($event.target as HTMLInputElement).value)">
        </label>
        <p>录音或导入的素材都在素材池里，原素材始终保留；片段只记录保留范围、静音与交叉淡化。</p>
      </div>
      <button type="button" class="ghost-button" data-testid="back-record" @click="emit('back')">＋ 再录/再导一段</button>
    </div>

    <div class="desk-grid">
      <aside class="stage-card source-pool">
        <h3>素材池</h3>
        <p v-if="!sources.length" class="empty-work">素材池为空，先录音或导入一段声音。</p>
        <article v-for="source in sources" :key="source.id" class="pool-item">
          <b>{{ source.kind === 'record' ? '● 录音' : '↥ 导入' }}</b>
          <span>{{ source.name }}</span>
          <small>{{ source.duration.toFixed(1) }}s</small>
          <div class="pool-actions">
            <button type="button" data-testid="add-clip-source" @click="emit('addClip', source.id)">加到时间线</button>
            <button type="button" class="danger" :data-testid="`remove-source-${source.kind}`" @click="emit('removeSource', source.id)">删除素材</button>
          </div>
        </article>
      </aside>

      <div class="timeline-wrap">
        <div class="stage-card">
          <div class="timeline-summary">
            <h3>时间线（按顺序播放）</h3>
            <span :class="{ over: duration > 10 }" data-testid="total-duration">
              总时长（扣除重叠）{{ duration.toFixed(2) }}s / 10.00s
            </span>
          </div>
          <div class="multi-track">
            <span v-for="tick in 11" :key="tick" :style="{ left: `${((tick - 1) / 10) * 100}%` }">{{ tick - 1 }}</span>
            <div
              v-for="(clip, index) in positioned"
              :key="clip.id"
              class="track-block"
              :class="{ last: index === positioned.length - 1 }"
              :style="trackStyle(clip)"
            >
              <i>{{ index + 1 }}</i>
              <em v-if="index < positioned.length - 1 && clip.crossfade > 0" class="xfade-badge" :style="{ width: `${(clip.crossfade / clipDuration(clip)) * 100}%` }">↔{{ clip.crossfade.toFixed(1) }}s</em>
              <em v-if="clip.silenceAfter > 0 && index < positioned.length - 1" class="silence-badge" :style="{ left: '100%', width: `${(clip.silenceAfter / 10) * 100}%` }">··{{ clip.silenceAfter.toFixed(1) }}s</em>
            </div>
            <div v-if="duration > 10" class="limit-line"></div>
          </div>

          <div v-if="!clips.length" class="empty-work">时间线上还没有片段，从素材池“加到时间线”。</div>
          <article v-for="(clip, index) in clips" :key="clip.id" class="clip-row">
            <header>
              <b>片段 {{ index + 1 }} · {{ sourceName(clip.sourceId) }}</b>
              <div>
                <button type="button" :disabled="index === 0" @click="emit('moveClip', clip.id, -1)">← 前移</button>
                <button type="button" :disabled="index === clips.length - 1" @click="emit('moveClip', clip.id, 1)">后移 →</button>
                <button type="button" class="danger" data-testid="remove-clip" @click="emit('removeClip', clip.id)">移除片段</button>
              </div>
            </header>
            <div class="clip-controls">
              <label>保留起点 {{ clip.start.toFixed(1) }}s
                <input type="range" min="0" :max="Math.max(0, clip.end - 0.05)" step="0.1" :value="clip.start"
                  @input="emit('patchClip', clip.id, { start: Number(($event.target as HTMLInputElement).value) })">
              </label>
              <label>保留终点 {{ clip.end.toFixed(1) }}s
                <input type="range" :min="clip.start + 0.05" :max="sources.find(s => s.id === clip.sourceId)?.duration ?? 0" step="0.1" :value="clip.end"
                  @input="emit('patchClip', clip.id, { end: Number(($event.target as HTMLInputElement).value) })">
              </label>
              <label v-if="index < clips.length - 1">之后插入静音 {{ clip.silenceAfter.toFixed(1) }}s
                <input type="range" min="0" max="5" step="0.1" :value="clip.silenceAfter" data-testid="silence"
                  @input="emit('patchClip', clip.id, { silenceAfter: Number(($event.target as HTMLInputElement).value) })">
              </label>
              <label v-if="index < clips.length - 1">与下一段交叉淡化 {{ clip.crossfade.toFixed(1) }}s
                <input type="range" min="0" :max="maxCrossfade(clips, index)" step="0.1" :value="Math.min(clip.crossfade, maxCrossfade(clips, index))" data-testid="crossfade"
                  @input="emit('patchClip', clip.id, { crossfade: Number(($event.target as HTMLInputElement).value) })">
              </label>
            </div>
            <ul v-if="clipIssues(clip.id).length" class="clip-issues">
              <li v-for="message in clipIssues(clip.id)" :key="message">{{ message }}</li>
            </ul>
          </article>
        </div>

        <div class="stage-card render-bar">
          <div class="preview">
            <button type="button" class="acid-button" data-testid="render" :disabled="!canArrange || processing" @click="emit('render')">
              {{ processing && progressLabel.includes('合成') ? '合成中…' : previewBlob ? '按当前编排重新生成试听' : '生成试听' }}
            </button>
            <audio v-if="previewBlob" ref="audioEl" :src="previewUrl || undefined" controls data-testid="preview-audio"></audio>
            <span v-if="previewBlob" class="preview-meta">
              试听 {{ previewDuration.toFixed(2) }}s
              <b v-if="stale" class="stale">编排已改动，这是旧结果，需重新生成</b>
            </span>
          </div>
          <ul v-if="globalIssues.length" class="clip-issues global">
            <li v-for="issue in globalIssues" :key="issue.message" data-testid="total-error">{{ issue.message }}</li>
          </ul>
          <button type="button" class="acid-button pink" data-testid="analyze" :disabled="!canArrange || processing || stale || !previewBlob" @click="emit('analyze')">
            {{ processing && progressLabel.includes('分析') ? '分析中…' : '确认编排并分析情绪 →' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
