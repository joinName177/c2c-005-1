<script setup lang="ts">
import type { ArrangementClip, AudioSource } from '../../core/arrangement';
defineProps<{ source: AudioSource; affected: ArrangementClip[] }>();
const emit = defineEmits<{ cancel: []; confirm: [] }>();
</script>
<template>
  <div class="modal-backdrop" data-testid="remove-source-dialog">
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="remove-title">
      <span class="kicker">REFERENCED SOURCE</span>
      <h3 id="remove-title">「{{ source.name }}」仍被以下片段引用</h3>
      <p>原素材删除后无法恢复。请选择取消，或一并移除引用它的编排片段（片段只是选择记录，移除不影响其他素材）。</p>
      <ul class="affected-list">
        <li v-for="(clip, index) in affected" :key="clip.id">
          片段 {{ index + 1 }}：保留 {{ clip.start.toFixed(1) }}s – {{ clip.end.toFixed(1) }}s
        </li>
      </ul>
      <footer>
        <button type="button" data-testid="cancel-remove" class="ghost-button" @click="emit('cancel')">取消</button>
        <button type="button" class="acid-button pink" data-testid="confirm-remove" @click="emit('confirm')">一并删除素材与 {{ affected.length }} 个片段</button>
      </footer>
    </div>
  </div>
</template>
