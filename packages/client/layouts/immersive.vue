<template>
  <div class="immersive-layout">
    <slot />
  </div>
</template>

<style scoped>
.immersive-layout {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #0f172a;
}
</style>
