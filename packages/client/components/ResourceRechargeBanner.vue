<script setup lang="ts">
defineProps<{
  text: string
  variant?: 'panel' | 'modal'
}>()
</script>

<template>
  <p
    class="recharge-banner"
    :class="variant === 'modal' ? 'recharge-banner--modal' : 'recharge-banner--panel'"
    role="status"
  >
    {{ text }}
  </p>
</template>

<style scoped>
.recharge-banner {
  margin: 0;
  font-weight: 800;
  line-height: 1.25;
  letter-spacing: 0.01em;
  color: #fef3c7;
}

.recharge-banner--panel {
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  font-size: 1.05rem;
  text-align: center;
  background: linear-gradient(135deg, rgba(180, 83, 9, 0.35), rgba(15, 23, 42, 0.85));
  border: 2px solid rgba(251, 191, 36, 0.55);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25) inset;
}

.recharge-banner--modal {
  margin: 0.75rem 0 0;
  padding: 0.85rem 0.65rem;
  border-radius: 10px;
  font-size: clamp(1.25rem, 4.5vw, 1.65rem);
  text-align: center;
  background: rgba(15, 23, 42, 0.55);
  border: 2px solid rgba(251, 191, 36, 0.65);
}
</style>
