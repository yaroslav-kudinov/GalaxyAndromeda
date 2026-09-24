<script setup lang="ts">
/**
 * Корабль на поле боя: силуэт класса, корпус разрезан на секции прочности. Пробитые секции
 * горят с носа к корме — видно, сколько попаданий корабль уже принял и сколько ещё выдержит.
 */
import type { ShipType } from '@galaxy/rules'
import { BATTLE_SPRITES, hullSections } from '~/utils/battle-sprites'

const props = withDefaults(
  defineProps<{
    type: ShipType
    color: string
    hull: number
    damage: number
    /** Куда смотрит нос: свой флот — вверх, флот противника — вниз. */
    facing?: 'up' | 'down'
    destroyed?: boolean
    /** Только что принял попадание — вспышка и дрожь. */
    struck?: boolean
    /** Взрывается прямо сейчас. */
    exploding?: boolean
    /** Сейчас стреляет — вспышка у орудий. */
    firing?: boolean
    width?: number
  }>(),
  { facing: 'up', destroyed: false, struck: false, exploding: false, firing: false, width: 44 },
)

/** Своя маска на каждый экземпляр: одинаковые id у двух SVG на странице путают браузер. */
const clipId = `bs-clip-${Math.random().toString(36).slice(2, 10)}`

const sprite = computed(() => BATTLE_SPRITES[props.type])
const sections = computed(() => hullSections(props.type, props.hull))
const hitSections = computed(() => Math.min(props.hull, Math.max(0, props.damage)))
const height = computed(() => Math.round((props.width * 68) / 44))
</script>

<template>
  <svg
    class="bs"
    :class="{
      'bs--destroyed': destroyed && !exploding,
      'bs--struck': struck,
      'bs--exploding': exploding,
      'bs--firing': firing,
    }"
    viewBox="-22 -34 44 68"
    :width="width"
    :height="height"
    aria-hidden="true"
  >
    <defs>
      <clipPath :id="clipId">
        <path :d="sprite.hull" />
      </clipPath>
    </defs>
    <g :transform="facing === 'down' ? 'rotate(180)' : undefined">
      <ellipse
        v-for="(engine, i) in sprite.engines"
        :key="`e${i}`"
        class="bs-engine"
        :cx="engine[0]"
        :cy="engine[1]"
        :rx="engine[2]"
        :ry="engine[3]"
      />
      <path :d="sprite.hull" :fill="color" class="bs-hull" />
      <g :clip-path="`url(#${clipId})`">
        <rect
          v-for="(section, i) in sections"
          :key="`s${i}`"
          x="-20"
          :y="section.y"
          width="40"
          :height="section.height"
          class="bs-section"
          :class="{ 'bs-section--hit': i < hitSections }"
        />
        <line
          v-for="(section, i) in sections.slice(1)"
          :key="`d${i}`"
          class="bs-divider"
          x1="-20"
          x2="20"
          :y1="section.y"
          :y2="section.y"
        />
      </g>
      <path :d="sprite.hull" class="bs-outline" />
      <path v-if="sprite.details" :d="sprite.details" class="bs-details" />
      <circle
        v-for="(ring, i) in sprite.rings ?? []"
        :key="`r${i}`"
        class="bs-ring"
        :cx="ring[0]"
        :cy="ring[1]"
        :r="ring[2]"
      />
      <circle class="bs-muzzle" cx="0" :cy="sprite.top - 2" r="4.5" />
    </g>
  </svg>
</template>

<style scoped>
.bs {
  display: block;
  overflow: visible;
  transition: opacity 0.4s ease, filter 0.4s ease;
}
.bs-hull {
  fill-opacity: 0.95;
}
.bs-section {
  fill: transparent;
  transition: fill 0.25s ease;
}
.bs-section--hit {
  fill: #7f1d1d;
  fill-opacity: 0.92;
  animation: bs-burn 1.6s ease-in-out infinite;
}
.bs-divider {
  stroke: rgba(2, 6, 23, 0.75);
  stroke-width: 1.1;
  stroke-dasharray: 2 1.4;
}
.bs-outline {
  fill: none;
  stroke: #020617;
  stroke-width: 1.6;
  stroke-linejoin: round;
}
.bs-details {
  fill: none;
  stroke: rgba(2, 6, 23, 0.8);
  stroke-width: 1.2;
  stroke-linecap: round;
}
.bs-ring {
  fill: rgba(2, 6, 23, 0.25);
  stroke: rgba(2, 6, 23, 0.85);
  stroke-width: 1.1;
}
.bs-engine {
  fill: #7dd3fc;
  filter: drop-shadow(0 0 2px #38bdf8);
  animation: bs-engine 0.9s ease-in-out infinite alternate;
}
.bs-muzzle {
  fill: #fef08a;
  opacity: 0;
  transform-box: fill-box;
  transform-origin: center;
}
.bs--firing .bs-muzzle {
  animation: bs-muzzle 0.28s ease-out;
}
.bs--struck {
  animation: bs-shake 0.36s ease-in-out;
  filter: brightness(1.9) drop-shadow(0 0 6px #f87171);
}
.bs--exploding {
  animation: bs-explode 0.7s ease-out forwards;
}
.bs--destroyed {
  opacity: 0.28;
  filter: grayscale(1);
}
.bs--destroyed .bs-engine {
  display: none;
}
@keyframes bs-burn {
  0%, 100% { fill: #7f1d1d; }
  50% { fill: #b91c1c; }
}
@keyframes bs-engine {
  from { opacity: 0.55; }
  to { opacity: 1; }
}
@keyframes bs-muzzle {
  0% { opacity: 1; transform: scale(0.4); }
  100% { opacity: 0; transform: scale(1.6); }
}
@keyframes bs-shake {
  0%, 100% { transform: translate(0, 0); }
  20% { transform: translate(-3px, 1px); }
  40% { transform: translate(3px, -1px); }
  60% { transform: translate(-2px, 0); }
  80% { transform: translate(2px, 1px); }
}
@keyframes bs-explode {
  0% { transform: scale(1); filter: brightness(1); opacity: 1; }
  30% { transform: scale(1.18); filter: brightness(3) drop-shadow(0 0 10px #fb923c); opacity: 1; }
  100% { transform: scale(0.85); filter: grayscale(1) brightness(0.8); opacity: 0.28; }
}
@media (prefers-reduced-motion: reduce) {
  .bs--struck,
  .bs--exploding,
  .bs-section--hit,
  .bs-engine {
    animation: none;
  }
}
</style>
