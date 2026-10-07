<script setup lang="ts">
import WaveformMeter from './WaveformMeter.vue';
defineProps<{ recording:boolean; level:number; hasDraft?:boolean }>();
const emit=defineEmits<{record:[];stop:[];import:[file:File];back:[]}>();
</script>
<template><section class="recorder-panel"><div class="time-code"><b>{{ recording?'REC':'READY' }}</b><strong>{{ recording?'00:06':'00:00' }}</strong><span>单段录音建议 10 秒内，素材可在编排台继续拼接</span></div><WaveformMeter :level="level"/><div class="recorder-actions"><button v-if="!recording" data-testid="record" class="record-button" type="button" @click="emit('record')"><i></i>开始录音</button><button v-else data-testid="stop" class="record-button stop" type="button" @click="emit('stop')">■ 结束录音</button><label>导入音频<input type="file" accept="audio/*" @change="($event.target as HTMLInputElement).files?.[0] && emit('import', ($event.target as HTMLInputElement).files![0])"></label><button v-if="hasDraft && !recording" type="button" class="ghost-button" data-testid="back-arrange" @click="emit('back')">← 回到编排台</button></div><p>录音只在本机处理，不会上传。录好的素材进入素材池，原素材始终保留。</p></section></template>
