<script setup lang="ts">
import { renderMarkdownLite } from '~/utils/markdown-lite'
import type { PatchNote } from '~/utils/patch-notes'

const props = defineProps<{ note: PatchNote }>()

const html = computed(() => {
  const stripped = props.note.markdown
    .replace(/^Дата:.*$/m, '')
    .replace(/^Ветка:.*$/m, '')
    .replace(/\n{3,}/g, '\n\n')
  return renderMarkdownLite(stripped)
})
</script>

<template>
  <article class="patch-article">
    <p class="meta">
      {{ note.date }}
      <template v-if="note.branch"> · ветка {{ note.branch }}</template>
    </p>
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div class="md" v-html="html" />
  </article>
</template>

<style scoped>
.meta {
  margin: 0 0 1rem;
  color: #94a3b8;
  font-size: 0.88rem;
}

.md {
  font-size: 0.95rem;
  line-height: 1.55;
  color: #e2e8f0;
}

.md :deep(h1) {
  margin: 0 0 0.75rem;
  font-size: 1.45rem;
}

.md :deep(h2) {
  margin: 1.35rem 0 0.5rem;
  font-size: 1.1rem;
}

.md :deep(h3) {
  margin: 1.1rem 0 0.4rem;
  font-size: 1rem;
}

.md :deep(p),
.md :deep(ul) {
  margin: 0 0 0.75rem;
}

.md :deep(ul) {
  padding-left: 1.2rem;
}

.md :deep(code) {
  padding: 0.05rem 0.3rem;
  border-radius: 4px;
  background: #0f172a;
  font-size: 0.88em;
}

.md :deep(pre) {
  overflow: auto;
  padding: 0.75rem;
  border-radius: 8px;
  background: #0f172a;
  border: 1px solid #334155;
}

.md :deep(pre code) {
  padding: 0;
  background: none;
}

.md :deep(a) {
  color: #93c5fd;
}
</style>
