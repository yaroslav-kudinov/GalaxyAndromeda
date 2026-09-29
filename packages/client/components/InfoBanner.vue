<script setup lang="ts">
/**
 * Яркая плашка с главным для хода: перезарядка, захват, доктрина. Заголовок крупно, пояснение
 * мелко. Цвет отличает плашки друг от друга; `warn` — что-то не действует или идёт против вас.
 */
defineProps<{
  title: string
  detail?: string | null
  tone?: 'amber' | 'teal' | 'violet' | 'warn'
  variant?: 'panel' | 'modal'
}>()
</script>

<template>
  <div
    class="ib"
    :class="['ib--' + (tone ?? 'amber'), variant === 'modal' ? 'ib--modal' : 'ib--panel']"
    role="status"
  >
    <p class="ib-title">{{ title }}</p>
    <p v-if="detail" class="ib-detail">{{ detail }}</p>
  </div>
</template>

<style scoped>
.ib {
  padding: 0.6rem 0.75rem;
  border-radius: 10px;
  border: 2px solid;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25) inset;
  text-align: center;
}
.ib-title {
  margin: 0;
  font-weight: 800;
  line-height: 1.25;
  letter-spacing: 0.01em;
  font-size: 1.02rem;
}
.ib-detail {
  margin: 0.3rem 0 0;
  font-size: 0.78rem;
  line-height: 1.35;
  color: #cbd5e1;
}
.ib--modal .ib-title {
  font-size: clamp(1.05rem, 4vw, 1.3rem);
}
.ib--amber {
  border-color: rgba(251, 191, 36, 0.55);
  background: linear-gradient(135deg, rgba(180, 83, 9, 0.35), rgba(15, 23, 42, 0.85));
  color: #fef3c7;
}
.ib--teal {
  border-color: rgba(45, 212, 191, 0.55);
  background: linear-gradient(135deg, rgba(15, 118, 110, 0.35), rgba(15, 23, 42, 0.85));
  color: #ccfbf1;
}
.ib--violet {
  border-color: rgba(192, 132, 252, 0.55);
  background: linear-gradient(135deg, rgba(109, 40, 217, 0.35), rgba(15, 23, 42, 0.85));
  color: #ede9fe;
}
.ib--warn {
  border-color: rgba(248, 113, 113, 0.65);
  background: linear-gradient(135deg, rgba(185, 28, 28, 0.35), rgba(15, 23, 42, 0.85));
  color: #fee2e2;
}
</style>
