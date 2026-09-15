import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clampPanelOffset, type ClampPanelOffsetInput } from './drag-panel-bounds'

const viewport = { width: 1000, height: 800 }

/** Окно 400×300 в середине экрана, смещений пока нет */
function base(next: { x: number; y: number }): ClampPanelOffsetInput {
  return {
    rect: { left: 300, top: 250, right: 700, bottom: 550 },
    current: { x: 0, y: 0 },
    next,
    viewport,
    minVisible: 72,
    topMargin: 0,
  }
}

test('перетаскивание внутри экрана ничего не меняет', () => {
  assert.deepEqual(clampPanelOffset(base({ x: 50, y: 40 })), { x: 50, y: 40 })
})

test('окно можно увести за левый край, оставив видимую полоску', () => {
  // right = 700 − 640 = 60 < 72 → возвращаем на 12 пикселей
  assert.deepEqual(clampPanelOffset(base({ x: -640, y: 0 })), { x: -628, y: 0 })
})

test('умеренный уход за левый край не поправляется', () => {
  // right = 700 − 500 = 200 — видно достаточно
  assert.deepEqual(clampPanelOffset(base({ x: -500, y: 0 })), { x: -500, y: 0 })
})

test('окно можно увести за правый край, оставив видимую полоску', () => {
  // left = 300 + 700 = 1000 > 1000 − 72 → поправка −72
  assert.deepEqual(clampPanelOffset(base({ x: 700, y: 0 })), { x: 628, y: 0 })
})

test('шапку не дают увести выше верхнего края', () => {
  assert.deepEqual(clampPanelOffset(base({ x: 0, y: -400 })), { x: 0, y: -250 })
})

test('верхний отступ сдвигает границу вниз', () => {
  const input = { ...base({ x: 0, y: -400 }), topMargin: 12 }
  assert.deepEqual(clampPanelOffset(input), { x: 0, y: -238 })
})

test('окно можно увести вниз, оставив видимую полоску', () => {
  // top = 250 + 600 = 850 > 800 − 72 → поправка −122
  assert.deepEqual(clampPanelOffset(base({ x: 0, y: 600 })), { x: 0, y: 478 })
})

test('уже смещённое окно считает поправку от текущего смещения', () => {
  const input: ClampPanelOffsetInput = {
    rect: { left: 100, top: 250, right: 500, bottom: 550 },
    current: { x: -200, y: 0 },
    next: { x: -600, y: 0 },
    viewport,
    minVisible: 72,
  }
  // сдвиг ещё на −400: right = 500 − 400 = 100 — видно достаточно
  assert.deepEqual(clampPanelOffset(input), { x: -600, y: 0 })
})

test('окно уже полоски видимости не уводится за край совсем', () => {
  const input: ClampPanelOffsetInput = {
    rect: { left: 0, top: 0, right: 40, bottom: 30 },
    current: { x: 0, y: 0 },
    next: { x: -30, y: 0 },
    viewport,
    minVisible: 72,
  }
  // ширина окна 40 < 72, поэтому видимыми держим все 40 пикселей: уводить некуда
  assert.deepEqual(clampPanelOffset(input), { x: 0, y: 0 })
})
