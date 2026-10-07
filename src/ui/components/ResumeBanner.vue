<script setup lang="ts">
defineEmits<{ resume: []; dismiss: [] }>();
</script>
<template>
  <div class="resume-banner" data-testid="resume-banner">
    <span>检测到上次未完成的多片段编排，素材和剪辑选择都还在。</span>
    <button type="button" data-testid="resume-btn" class="acid-button" @click="$emit('resume')">接着编辑</button>
    <button type="button" class="ghost-button" @click="$emit('dismiss')">放弃</button>
  </div>
</template>
