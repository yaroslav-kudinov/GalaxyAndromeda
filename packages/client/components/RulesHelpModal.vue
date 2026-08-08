<script setup lang="ts">
import { RULES_HELP_SECTIONS, type RulesHelpSection } from '~/data/player-rules-help'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const activeId = ref(RULES_HELP_SECTIONS[0]?.id ?? 'victory')
const contentEl = ref<HTMLElement | null>(null)

const activeSection = computed(
  (): RulesHelpSection | undefined =>
    RULES_HELP_SECTIONS.find((s) => s.id === activeId.value) ?? RULES_HELP_SECTIONS[0],
)

watch(
  () => props.open,
  (open) => {
    if (open) {
      activeId.value = RULES_HELP_SECTIONS[0]?.id ?? 'victory'
      nextTick(() => {
        contentEl.value?.scrollTo({ top: 0 })
      })
    }
  },
)

function selectSection(id: string) {
  activeId.value = id
  nextTick(() => {
    contentEl.value?.scrollTo({ top: 0 })
  })
}

function onKeydown(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="rules-help-backdrop"
      role="presentation"
      @click.self="emit('close')"
    >
      <div
        class="rules-help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-help-title"
      >
        <header class="rules-help-header">
          <div class="rules-help-heading">
            <h2 id="rules-help-title">Справка по правилам</h2>
            <p class="rules-help-sub">
              Краткая однозначная выжимка на русском. Подсказка текущего хода — в правой панели.
            </p>
          </div>
          <button type="button" class="rules-help-close" title="Закрыть" @click="emit('close')">
            ×
          </button>
        </header>

        <div class="rules-help-body">
          <nav class="rules-help-nav" aria-label="Разделы правил">
            <button
              v-for="section in RULES_HELP_SECTIONS"
              :key="section.id"
              type="button"
              class="rules-help-nav-btn"
              :class="{ 'rules-help-nav-btn--active': section.id === activeId }"
              @click="selectSection(section.id)"
            >
              {{ section.title }}
            </button>
          </nav>

          <article ref="contentEl" class="rules-help-content">
            <template v-if="activeSection">
              <h3 class="rules-help-section-title">{{ activeSection.title }}</h3>
              <template v-for="(block, idx) in activeSection.blocks" :key="`${activeSection.id}-${idx}`">
                <p v-if="block.type === 'p'" class="rules-help-p">{{ block.text }}</p>
                <ul v-else-if="block.type === 'ul'" class="rules-help-list">
                  <li v-for="(item, i) in block.items" :key="i">{{ item }}</li>
                </ul>
                <ol v-else-if="block.type === 'ol'" class="rules-help-list rules-help-list--ol">
                  <li v-for="(item, i) in block.items" :key="i">{{ item }}</li>
                </ol>
                <p v-else-if="block.type === 'note'" class="rules-help-note">{{ block.text }}</p>
                <div v-else-if="block.type === 'table'" class="rules-help-table-wrap">
                  <table class="rules-help-table">
                    <thead>
                      <tr>
                        <th v-for="(h, hi) in block.headers" :key="hi">{{ h }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(row, ri) in block.rows" :key="ri">
                        <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </template>
            </template>
          </article>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.rules-help-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(2, 6, 23, 0.72);
  backdrop-filter: blur(3px);
}

.rules-help-modal {
  --rules-font: 'Manrope', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
  display: flex;
  flex-direction: column;
  width: min(960px, 100%);
  max-height: min(88vh, 860px);
  overflow: hidden;
  border-radius: 16px;
  border: 1px solid #475569;
  background: linear-gradient(165deg, #0f172a 0%, #111827 55%, #0b1220 100%);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
  color: #e8eef7;
  font-family: var(--rules-font);
  font-size: 1.02rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

.rules-help-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.15rem 1.35rem 1rem;
  border-bottom: 1px solid #334155;
}

.rules-help-heading h2 {
  margin: 0;
  font-family: var(--rules-font);
  font-size: 1.45rem;
  font-weight: 700;
  letter-spacing: 0.005em;
  color: #f8fafc;
}

.rules-help-sub {
  margin: 0.4rem 0 0;
  font-size: 0.95rem;
  font-weight: 500;
  line-height: 1.45;
  color: #a8b6c9;
}

.rules-help-close {
  flex: 0 0 auto;
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid #475569;
  border-radius: 10px;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 1.45rem;
  line-height: 1;
  cursor: pointer;
}

.rules-help-close:hover {
  background: #334155;
}

.rules-help-body {
  display: grid;
  grid-template-columns: minmax(12.5rem, 15rem) minmax(0, 1fr);
  min-height: 0;
  flex: 1;
}

.rules-help-nav {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.9rem 0.75rem;
  border-right: 1px solid #334155;
  overflow: auto;
  background: rgba(15, 23, 42, 0.65);
}

.rules-help-nav-btn {
  text-align: left;
  padding: 0.55rem 0.7rem;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: #d5deea;
  font-family: var(--rules-font);
  font-size: 0.98rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1.35;
  cursor: pointer;
}

.rules-help-nav-btn:hover {
  background: rgba(51, 65, 85, 0.55);
}

.rules-help-nav-btn--active {
  border-color: #64748b;
  background: rgba(56, 189, 248, 0.12);
  color: #f0f9ff;
}

.rules-help-content {
  padding: 1.1rem 1.4rem 1.5rem;
  overflow: auto;
  min-width: 0;
}

.rules-help-section-title {
  margin: 0 0 0.9rem;
  font-family: var(--rules-font);
  font-size: 1.28rem;
  font-weight: 700;
  letter-spacing: 0.005em;
  color: #f8fafc;
}

.rules-help-p,
.rules-help-list,
.rules-help-note {
  margin: 0 0 0.85rem;
  font-size: 1.02rem;
  font-weight: 500;
  line-height: 1.58;
  color: #e8eef7;
}

.rules-help-list {
  padding-left: 1.3rem;
}

.rules-help-list li + li {
  margin-top: 0.45rem;
}

.rules-help-list--ol {
  padding-left: 1.4rem;
}

.rules-help-note {
  padding: 0.7rem 0.85rem;
  border-left: 3px solid #38bdf8;
  border-radius: 0 10px 10px 0;
  background: rgba(56, 189, 248, 0.08);
  color: #c7e9fb;
  font-size: 0.98rem;
  line-height: 1.5;
}

.rules-help-table-wrap {
  margin: 0 0 1rem;
  overflow-x: auto;
  border: 1px solid #334155;
  border-radius: 12px;
}

.rules-help-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-family: var(--rules-font);
  font-size: 0.95rem;
  font-weight: 500;
  line-height: 1.4;
}

.rules-help-table th,
.rules-help-table td {
  padding: 0.55rem 0.65rem;
  border-bottom: 1px solid #1e293b;
  text-align: left;
  vertical-align: top;
  white-space: nowrap;
  background: #0f172a;
}

.rules-help-table th {
  background: #1e293b;
  color: #f1f5f9;
  font-weight: 700;
}

.rules-help-table tbody tr:nth-child(even) td {
  background: #152033;
}

.rules-help-table tbody tr:last-child th,
.rules-help-table tbody tr:last-child td {
  border-bottom: none;
}

/* Первый столбец (названия типов) закреплён при горизонтальном скролле */
.rules-help-table th:first-child,
.rules-help-table td:first-child {
  position: sticky;
  left: 0;
  z-index: 2;
  min-width: 9.5rem;
  box-shadow: 4px 0 10px rgba(2, 6, 23, 0.45);
}

.rules-help-table th:first-child {
  z-index: 3;
  background: #1e293b;
}

.rules-help-table td:first-child {
  font-weight: 700;
  color: #f8fafc;
}

.rules-help-table tbody tr:nth-child(even) td:first-child {
  background: #152033;
}

@media (max-width: 720px) {
  .rules-help-modal {
    font-size: 0.98rem;
  }

  .rules-help-body {
    grid-template-columns: 1fr;
  }

  .rules-help-nav {
    flex-direction: row;
    flex-wrap: wrap;
    border-right: none;
    border-bottom: 1px solid #334155;
    max-height: 9.5rem;
  }

  .rules-help-nav-btn {
    font-size: 0.9rem;
  }

  .rules-help-content {
    padding: 1rem 1.1rem 1.25rem;
  }
}
</style>
