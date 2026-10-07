<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AudioMaterial } from '../../core/models';
import { itemDuration, MAX_ARRANGEMENT_SECONDS, type TimelineItem } from '../../core/arrangement';
import type { ItemPatch } from '../useStudio';

const props = defineProps<{
  materials: AudioMaterial[];
  items: TimelineItem[];
  total: number;
  problem?: string;
  processing: boolean;
  pendingDelete?: { material: AudioMaterial; affected: TimelineItem[] };
  previewBlob?: Blob;
  previewKey: number;
}>();
const emit = defineEmits<{
  addClip: [id: string];
  deleteMaterial: [id: string];
  confirmDelete: [removeClips: boolean];
  patchItem: [id: string, patch: ItemPatch];
  moveItem: [id: string, delta: number];
  removeItem: [id: string];
  insertSilence: [afterIndex: number];
  import: [file: File];
  toRecord: [];
  preview: [];
  compose: [];
}>();

const previewUrl = ref('');
watch(() => props.previewKey, () => {
  if (!props.previewBlob) return;
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = URL.createObjectURL(props.previewBlob);
});

const over = computed(() => props.total > MAX_ARRANGEMENT_SECONDS + 1e-6);
function materialOf(item: TimelineItem) { return item.kind === 'clip' ? props.materials.find((entry) => entry.id === item.materialId) : undefined; }
function nameOf(item: TimelineItem) { return materialOf(item)?.name ?? '缺失素材'; }
function crossfadeLimit(index: number) {
  const item = props.items[index]; const next = props.items[index + 1];
  return next ? Math.min(itemDuration(item), itemDuration(next)) : 0;
}
function numberValue(event: Event) { return Number((event.target as HTMLInputElement).value); }
</script>

<template>
  <section class="stage-card arrange-board">
    <span class="kicker">02 / ARRANGE THE CLIPS</span>
    <h2>多片段编排台</h2>

    <div class="pool">
      <div class="pool-head"><h3>素材池</h3><div class="pool-actions"><button type="button" @click="emit('toRecord')">🎙 去录音</button><label>导入音频<input type="file" accept="audio/*" @change="($event.target as HTMLInputElement).files?.[0] && emit('import', ($event.target as HTMLInputElement).files![0])"></label></div></div>
      <p v-if="!materials.length" class="pool-empty">还没有素材，录一段或导入一份音频开始编排。</p>
      <div v-for="material in materials" :key="material.id" class="material-row">
        <b>{{ material.name }}</b><span>{{ material.duration.toFixed(1) }}s</span>
        <button type="button" :data-testid="`add-clip-${material.id}`" @click="emit('addClip', material.id)">＋ 加入时间线</button>
        <button type="button" class="danger" :data-testid="`delete-material-${material.id}`" @click="emit('deleteMaterial', material.id)">删除</button>
      </div>
    </div>

    <div v-if="pendingDelete" class="confirm-dialog" role="alertdialog">
      <b>素材「{{ pendingDelete.material.name }}」仍被 {{ pendingDelete.affected.length }} 个片段引用</b>
      <ul><li v-for="clip in pendingDelete.affected" :key="clip.id">第 {{ items.findIndex((item) => item.id === clip.id) + 1 }} 段 · 保留 {{ clip.kind === 'clip' ? `${clip.start.toFixed(1)}s – ${clip.end.toFixed(1)}s` : '' }}</li></ul>
      <div class="confirm-actions">
        <button type="button" data-testid="cancel-delete" @click="emit('confirmDelete', false)">取消</button>
        <button type="button" class="danger" data-testid="confirm-delete" @click="emit('confirmDelete', true)">一并移除这些片段</button>
      </div>
    </div>

    <div class="timeline-items">
      <div v-for="(item, index) in items" :key="item.id" class="tl-item" :class="item.kind">
        <header><b>{{ index + 1 }}. {{ item.kind === 'clip' ? nameOf(item) : '静音' }}</b><span>{{ itemDuration(item).toFixed(1) }}s</span>
          <button type="button" :disabled="index === 0" @click="emit('moveItem', item.id, -1)">↑</button>
          <button type="button" :disabled="index === items.length - 1" @click="emit('moveItem', item.id, 1)">↓</button>
          <button type="button" class="danger" @click="emit('removeItem', item.id)">移除</button>
        </header>
        <template v-if="item.kind === 'clip'">
          <div class="range-pair">
            <label>起点 {{ item.start.toFixed(1) }}s<input type="range" min="0" :max="Math.max(0, (materialOf(item)?.duration ?? 0) - 0.1)" step="0.1" :value="item.start" @input="emit('patchItem', item.id, { start: numberValue($event) })"></label>
            <label>终点 {{ item.end.toFixed(1) }}s<input type="range" :min="Math.min(materialOf(item)?.duration ?? 0, item.start + 0.1)" :max="materialOf(item)?.duration ?? 0" step="0.1" :value="item.end" @input="emit('patchItem', item.id, { end: numberValue($event) })"></label>
          </div>
        </template>
        <label v-else class="silence-duration">静音时长<input type="number" min="0.1" :max="MAX_ARRANGEMENT_SECONDS" step="0.1" :value="item.duration" @input="emit('patchItem', item.id, { duration: numberValue($event) })"> s</label>
        <label v-if="index < items.length - 1" class="crossfade">与下一段交叉淡化 {{ item.crossfade.toFixed(1) }}s<input type="range" min="0" :max="crossfadeLimit(index)" step="0.1" :value="item.crossfade" @input="emit('patchItem', item.id, { crossfade: numberValue($event) })"></label>
      </div>
      <p v-if="!items.length" class="pool-empty">时间线是空的，从素材池把素材加进来。</p>
    </div>

    <div class="arrange-footer">
      <button type="button" data-testid="insert-silence" @click="emit('insertSilence', items.length - 1)">＋ 插入静音</button>
      <span class="total" :class="{ over }">总时长 {{ total.toFixed(1) }}s / {{ MAX_ARRANGEMENT_SECONDS }}s<em v-if="over">（已超出，请缩短片段或增大重叠）</em></span>
    </div>
    <p v-if="problem" class="arrange-problem">{{ problem }}</p>
    <audio v-if="previewUrl" :src="previewUrl" controls autoplay class="preview-player"></audio>
    <div class="arrange-actions">
      <button type="button" data-testid="preview" :disabled="processing || !items.length || !!problem" @click="emit('preview')">{{ processing ? '处理中…' : '▶ 试听编排' }}</button>
      <button type="button" class="acid-button" data-testid="compose" :disabled="processing || over || !items.length || !!problem" @click="emit('compose')">{{ processing ? '合成中…' : '合成并分析 →' }}</button>
    </div>
  </section>
</template>
