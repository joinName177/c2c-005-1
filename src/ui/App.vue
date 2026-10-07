<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { MediaRecorderAdapter } from '../adapters/media-recorder.adapter';
import { WebAudioAnalyzerAdapter } from '../adapters/web-audio-analyzer.adapter';
import { WebAudioCropperAdapter } from '../adapters/web-audio-cropper.adapter';
import { WebAudioArrangerAdapter } from '../adapters/web-audio-arranger.adapter';
import { CanvasCoverRendererAdapter } from '../adapters/canvas-cover-renderer.adapter';
import { IndexedDbMemeRepository } from '../adapters/indexeddb-meme.repository';
import { IndexedDbDraftRepository } from '../adapters/indexeddb-draft.repository';
import { BrowserShareAdapter } from '../adapters/browser-share.adapter';
import { useStudio, type StudioDependencies } from './useStudio';
import RecorderPanel from './components/RecorderPanel.vue';
import ArrangeConsole from './components/ArrangeConsole.vue';
import EmotionPanel from './components/EmotionPanel.vue';
import CoverWorkshop from './components/CoverWorkshop.vue';
import MemeGallery from './components/MemeGallery.vue';
import SharePanel from './components/SharePanel.vue';
import RemoveSourceDialog from './components/RemoveSourceDialog.vue';
import ResumeBanner from './components/ResumeBanner.vue';

const props = defineProps<{ dependencies?: StudioDependencies }>();
const defaults: StudioDependencies = {
  recorder: new MediaRecorderAdapter(),
  analyzer: new WebAudioAnalyzerAdapter(),
  cropper: new WebAudioCropperAdapter(),
  arranger: new WebAudioArrangerAdapter(),
  renderer: new CanvasCoverRendererAdapter(),
  repository: new IndexedDbMemeRepository(),
  drafts: new IndexedDbDraftRepository(),
  share: new BrowserShareAdapter(),
};
const activeDeps = props.dependencies ?? defaults;
const studio = useStudio(activeDeps);
const recording = ref(false);
const hasStoredDraft = ref(false);
async function start() { await studio.startRecording(); recording.value = !studio.error.value; }
async function stop() { await studio.stopRecording(); recording.value = false; }
onMounted(async () => {
  await studio.loadCollection();
  hasStoredDraft.value = !!(await activeDeps.drafts.loadDraft().catch(() => null));
});
</script>

<template>
  <div class="sound-app">
    <header>
      <div class="logo">声<span>!</span></div>
      <div><small>SOUND REACTION STUDIO / 005</small><h1>声音表情包工坊</h1></div>
      <nav>
        <button v-for="(s, i) in ['录音','编排','情绪','封面','作品集']" :key="s"
          :class="{ active: ['record', 'arrange', 'emotion', 'cover', 'collection'][i] === studio.stage.value }">
          {{ i + 1 }} {{ s }}
        </button>
      </nav>
    </header>
    <main>
      <section class="intro">
        <div>
          <span class="kicker">MAKE SOME NOISE. MAKE IT YOURS.</span>
          <h2>让声音，<em>长出表情。</em></h2>
          <p>多段素材进素材池，选范围、排时间线、插静音做交叉淡化，十秒内拼出一张会发声的表情包。</p>
        </div>
        <div class="intro-badge"><b>10</b><span>SECONDS<br>OF ATTITUDE</span></div>
      </section>
      <ResumeBanner v-if="hasStoredDraft && studio.resumed.value === false && studio.stage.value === 'record'"
        @resume="studio.resumeDraft().then(() => { hasStoredDraft = false; })"
        @dismiss="hasStoredDraft = false; studio.dismissResume();" />
      <div v-if="studio.error.value" class="error-banner">{{ studio.error.value }}</div>
      <div v-if="studio.notice.value" class="notice-banner">{{ studio.notice.value }}</div>

      <RecorderPanel v-if="studio.stage.value === 'record'" :recording="recording" :level="studio.level.value"
        :has-draft="studio.hasDraft.value" @record="start" @stop="stop" @import="studio.importAudio" @back="studio.backToRecord" />

      <ArrangeConsole v-else-if="studio.stage.value === 'arrange'"
        :title="studio.title.value"
        :sources="studio.sources.value" :clips="studio.clips.value" :positioned="studio.schedule.value.clips"
        :duration="studio.schedule.value.duration" :issues="studio.issues.value" :can-arrange="studio.canArrange.value"
        :processing="studio.processing.value" :progress-label="studio.progressLabel.value"
        :preview-blob="studio.renderedBlob.value" :preview-duration="studio.renderedDuration.value" :stale="studio.stale.value"
        @title="studio.setTitle"
        @add-clip="studio.appendClip" @patch-clip="studio.updateClip" @remove-clip="studio.removeClip"
        @move-clip="studio.moveClip" @remove-source="studio.requestRemoveSource"
        @render="studio.renderArrangement" @analyze="studio.analyze" @back="studio.backToRecord" />

      <EmotionPanel v-else-if="studio.stage.value === 'emotion' && studio.emotion.value" :result="studio.emotion.value"
        :stale="studio.stale.value" @select="studio.selectEmotion" @next="studio.goCover"
        @back="studio.backToArrange()" />

      <CoverWorkshop v-else-if="studio.stage.value === 'cover'" :config="studio.cover.value" :title="studio.title.value"
        @patch="studio.cover.value = { ...studio.cover.value, ...$event }" @title="studio.title.value = $event" @save="studio.save()" />

      <MemeGallery v-else :items="studio.collection.value" @edit="studio.editMeme" @remove="studio.deleteMeme"
        @share="studio.shareMeme" @new="studio.newRecording" />

      <SharePanel />
    </main>

    <RemoveSourceDialog v-if="studio.pendingSourceRemoval.value"
      :source="studio.pendingSourceRemoval.value.source" :affected="studio.pendingSourceRemoval.value.affected"
      @cancel="studio.cancelRemoveSource"
      @confirm="studio.confirmRemoveSource(studio.pendingSourceRemoval.value!.source, true)" />
  </div>
</template>
