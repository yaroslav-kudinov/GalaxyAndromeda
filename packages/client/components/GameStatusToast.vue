<script setup lang="ts">
import type { GameToast } from '~/composables/useGameStatusToasts'

defineProps<{
  toasts: GameToast[]
}>()
</script>

<template>
  <div class="toast-stack" aria-live="polite">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="game-toast"
      :class="[
        `game-toast--${toast.kind}`,
        { 'game-toast--accent': toast.accent, 'game-toast--hide': !toast.visible },
      ]"
    >
      <p class="game-toast-title">{{ toast.title }}</p>
      <p v-if="toast.detail" class="game-toast-detail">{{ toast.detail }}</p>
    </div>
  </div>
</template>

<style scoped>
.toast-stack {
  position: absolute;
  top: 3.25rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  pointer-events: none;
  width: min(92vw, 360px);
}
.game-toast {
  width: 100%;
  padding: 0.65rem 1rem;
  border-radius: 10px;
  border: 1px solid rgba(100, 116, 139, 0.55);
  background: rgba(15, 23, 42, 0.94);
  backdrop-filter: blur(8px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  text-align: center;
  opacity: 1;
  transform: translateY(0);
  transition:
    opacity 0.65s ease,
    transform 0.65s ease;
}
.game-toast--hide {
  opacity: 0;
  transform: translateY(-10px);
}
.game-toast--accent {
  border-color: rgba(251, 191, 36, 0.75);
  box-shadow:
    0 8px 28px rgba(0, 0, 0, 0.35),
    0 0 0 1px rgba(251, 191, 36, 0.25);
}
.game-toast--identity.game-toast--accent {
  background: linear-gradient(180deg, rgba(30, 58, 95, 0.96), rgba(15, 23, 42, 0.94));
}
.game-toast--turn.game-toast--accent {
  background: linear-gradient(180deg, rgba(22, 78, 50, 0.92), rgba(15, 23, 42, 0.94));
  border-color: rgba(134, 239, 172, 0.55);
}
.game-toast-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: #f8fafc;
}
.game-toast-detail {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  color: #cbd5e1;
}
</style>
