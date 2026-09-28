/**
 * Журнал партии человеческим языком: кто что сделал, по ходам.
 *
 * Сервер пишет события короткими служебными строками («Движение с (2,0): Крейсер → (3,0)»),
 * а имя игрока — только в событии смены очереди («Фаза «Действия», ход Бот Альфа»). Здесь
 * действия приписываются тому, чья сейчас очередь, служебные строки переписываются, а
 * координаты собираются, чтобы по щелчку показать клетку на карте.
 */
import type { GameEvent, HexCoord } from '@galaxy/rules'

export interface JournalPlayer {
  id: string
  name: string
  color?: string
}

export interface JournalEntry {
  id: string
  /** Кто действовал; `null` — событие партии (захват, осада, доктрины). */
  actorId: string | null
  text: string
  coords: HexCoord[]
  /** Пропуск очереди, смена фазы — второстепенное, показывается бледнее. */
  minor?: boolean
}

export interface JournalTurn {
  turn: number
  entries: JournalEntry[]
}

const PHASE_TURN = /^Фаза «[^»]+», ход (.+?)(?: \((?:остались маркеры|пропуск без действий)\))?$/
const TURN_START = /^Ход \d+, фаза «[^»]+», ход (.+)$/
const COORD = /\((-?\d+),\s*(-?\d+)\)/g

function coordsOf(text: string): HexCoord[] {
  const out: HexCoord[] = []
  for (const match of text.matchAll(COORD)) out.push({ q: Number(match[1]), r: Number(match[2]) })
  return out
}

/** «Крейсер» → «крейсер»: внутри фразы класс корабля пишется со строчной. */
function lowerFirst(text: string): string {
  return text.replace(/(^|[;,]\s*)([А-ЯЁ])/g, (_all, lead: string, letter: string) => lead + letter.toLowerCase())
}

/** «Крейсер@(1,5), Крейсер@(1,5), Эсминец@(2,5)» → «крейсер ×2 на (1,5), эсминец на (2,5)». */
function describeBuilt(list: string): string {
  const groups = new Map<string, number>()
  for (const item of list.split(/,\s*(?=[А-ЯЁа-яё])/)) {
    const key = item.trim()
    if (key) groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  return [...groups.entries()]
    .map(([item, count]) => {
      const [type, where] = item.split('@')
      const name = lowerFirst(type ?? item)
      return `${name}${count > 1 ? ` ×${count}` : ''}${where ? ` на ${where}` : ''}`
    })
    .join(', ')
}

/** Служебная строка действия → фраза без подлежащего: «двигает корабли из (2,0): …». */
export function humanizeAction(message: string): string {
  let m = message.match(/^Движение с (\(-?\d+,\s*-?\d+\)): (.*)$/)
  if (m) {
    const [moves, outcome] = m[2]!.split(/;\s*бой:\s*/)
    const body = moves === '—' ? 'корабли не сдвинулись' : lowerFirst(moves!)
    return `ведёт корабли из ${m[1]}: ${body}${outcome ? `. Бой: ${outcome}` : ''}`
  }
  m = message.match(/^Обстрел с (\(-?\d+,\s*-?\d+\)): (.*)$/)
  if (m) {
    const [shots, outcome] = m[2]!.split(/;\s*бой:\s*/)
    return `обстреливает из ${m[1]}: ${lowerFirst(shots!)}${outcome ? `. Итог: ${outcome}` : ''}`
  }
  m = message.match(/^Построено: (.*)$/)
  if (m) return `строит: ${describeBuilt(m[1]!)}`
  m = message.match(/^Подготовка к бою на (\(-?\d+,\s*-?\d+\))$/)
  if (m) return `нападает на клетку ${m[1]}`
  m = message.match(/^Подготовка к обстрелу на (\(-?\d+,\s*-?\d+\))$/)
  if (m) return `готовит обстрел клетки ${m[1]}`
  m = message.match(/^Осада центра власти на (\(-?\d+,\s*-?\d+\))$/)
  if (m) return `осаждает центр власти ${m[1]}`
  return message
}

/**
 * События → ходы (новые сверху), в каждом ходу — по порядку. Смена очереди в фазе действий
 * без записи не показывается: она только задаёт, кому приписать следующие события.
 */
export function buildGameJournal(events: readonly GameEvent[], players: readonly JournalPlayer[]): JournalTurn[] {
  const idByName = new Map(players.map((player) => [player.name, player.id]))
  const turns = new Map<number, JournalEntry[]>()
  let actor: string | null = null

  for (const event of events) {
    const list = turns.get(event.turn) ?? []
    turns.set(event.turn, list)
    const text = event.message.trim()

    const turnStart = text.match(TURN_START)
    if (turnStart) {
      actor = idByName.get(turnStart[1]!) ?? null
      continue
    }
    const phaseTurn = text.match(PHASE_TURN)
    if (event.type === 'phase' && phaseTurn) {
      actor = idByName.get(phaseTurn[1]!) ?? null
      if (/пропуск без действий/.test(text) && actor) {
        list.push({ id: event.id, actorId: actor, text: 'пропускает очередь: маркеров не осталось', coords: [], minor: true })
      }
      continue
    }
    if (event.type === 'phase') {
      list.push({ id: event.id, actorId: null, text, coords: [], minor: true })
      continue
    }

    // Действие того, чья очередь, — только узнаваемые ходы (движение, постройка, нападение, осада).
    // «Осаждённый решает…», «Защитник отступил» описывают других — их не подписываем.
    const human = humanizeAction(text)
    const actorId = event.phase === 'actions' && human !== text ? actor : null
    list.push({
      id: event.id,
      actorId,
      text: actorId ? human : text,
      coords: coordsOf(text),
    })
  }

  return [...turns.entries()]
    .filter(([, entries]) => entries.length > 0)
    .sort(([a], [b]) => b - a)
    .map(([turn, entries]) => ({ turn, entries }))
}
