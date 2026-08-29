<template>
  <!--
    Static galaxy photograph for the home menu only (not in-game space-bg.jpg).
    Source: NASA / CXC / JPL-Caltech / STScI — Small Magellanic Cloud “wing”,
    Great Observatories composite, catalog PIA16884
    https://photojournal.jpl.nasa.gov/catalog/PIA16884
    License: public domain (NASA / US government work).
    The mosaic has circular instrument footprints (black arcs on the left).
    Landscape `cover` would show the full width of the square JPEG, so we zoom
    and pin to the right. Extra size leaves room for the idle pan without
    revealing those arcs or wrapping/tiling a seam.
  -->
  <div class="galaxy-backdrop" aria-hidden="true">
    <div class="galaxy-photo" />
    <div class="galaxy-veil" />
  </div>
</template>

<style scoped>
.galaxy-backdrop {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  background: #050814;
}

.galaxy-photo {
  position: absolute;
  inset: -64px;
  background-image: url('/images/andromeda-galaxy.jpg');
  background-repeat: no-repeat;
  background-position: 100% 42%;
  background-size: 240% auto;
  filter: blur(5px) saturate(1.08);
  animation: galaxy-float 20s ease-in-out infinite;
}

.galaxy-veil {
  position: absolute;
  inset: 0;
  background: #02061742;
}

@keyframes galaxy-float {
  0% {
    transform: translate(0, 0);
  }
  25% {
    transform: translate(-2.5%, -1.8%);
  }
  50% {
    transform: translate(-0.7%, 2.3%);
  }
  75% {
    transform: translate(-2.8%, 0.8%);
  }
  100% {
    transform: translate(0, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .galaxy-photo {
    animation: none;
  }
}
</style>
