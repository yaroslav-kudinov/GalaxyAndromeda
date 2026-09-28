/**
 * «Действует сейчас»: неочевидные условия, которые прямо сейчас влияют на игрока.
 *
 * Правила хранят такие условия в разных местах — доктрины (свои и соперников), осады, центры,
 * которые сменят хозяина в начале следующего хода. Игроки о них не знали: «Атака» молча
 * не действовала при осаде, гиперорудие не помогало из-за «Обороны» соперника. Здесь они
 * собраны в один список короткими фразами.
 */
import type { GameSnapshot } from '@galaxy/rules'
import {
  activeDoctrineId,
  doctrineDefinition,
  powerCentersCapturedNextTurn,
  SIEGE_REROLL_PASSES_MAX,
} from '@galaxy/rules'

export interface PlayerCondition {
  /** `warn` — против вас, `good` — в вашу пользу, `info` — просто знать. */
  tone: 'info' | 'warn' | 'good'
  text: string
}

const cell = (key: string) => `(${key})`

export function playerConditions(game: GameSnapshot, playerId: string): PlayerCondition[] {
  const out: PlayerCondition[] = []
  const nameOf = (id: string | null | undefined) => game.players.find((player) => player.id === id)?.name ?? id ?? '—'
  const sieges = Object.entries(game.sieges ?? {})
  const myBesieged = sieges.filter(([, siege]) => siege.besiegedId === playerId)
  const rivals = game.players.filter((player) => player.id !== playerId && !player.eliminated)

  // Своя доктрина: что даёт и чем платит; «Атака» при осаде ваших центров не действует.
  const mine = activeDoctrineId(game, playerId)
  if (mine !== 'none') {
    const def = doctrineDefinition(mine)
    if (mine === 'attack' && myBesieged.length) {
      out.push({
        tone: 'warn',
        text: `«Атака» сейчас не действует: осаждён ваш центр власти ${myBesieged.map(([key]) => cell(key)).join(', ')}. Бонус вернётся, когда осаду снимут.`,
      })
    } else {
      out.push({ tone: 'info', text: `Ваша доктрина «${def.name}»: ${def.gives}. Плата: ${def.costs}.` })
    }
  }

  // Доктрины соперников, которые меняют ваши бои и их манёвры.
  for (const rival of rivals) {
    const id = activeDoctrineId(game, rival.id)
    if (id === 'defense') {
      out.push({ tone: 'warn', text: `У игрока ${rival.name} «Оборона»: на его клетках вашим кораблям нужно на 1 больше, чтобы попасть.` })
    } else if (id === 'attack') {
      const suspended = sieges.some(([, siege]) => siege.besiegedId === rival.id)
      if (!suspended) out.push({ tone: 'warn', text: `У игрока ${rival.name} «Атака»: его корабли попадают на 1 легче и стреляют на клетку дальше.` })
    } else if (id === 'maneuvers') {
      out.push({ tone: 'info', text: `У игрока ${rival.name} «Манёвры»: его линкоры, авианосцы и гиперорудия ходят на клетку дальше.` })
    }
  }

  // Осады: ваши центры под осадой и ваши осады.
  for (const [key, siege] of myBesieged) {
    out.push({
      tone: 'warn',
      text: `Ваш центр ${cell(key)} осаждает игрок ${nameOf(siege.besiegerId)}: в начале каждого хода гарнизон теряет корабль, строить там и поддерживать оттуда нельзя. Можно напасть на осаждающих маркером на этой клетке или отступить всем гарнизоном.`,
    })
  }
  for (const [key, siege] of sieges.filter(([, s]) => s.besiegerId === playerId)) {
    const garrison = game.cells
      .find((c) => `${c.coord.q},${c.coord.r}` === key)
      ?.ships.filter((ship) => ship.ownerId === siege.besiegedId).length ?? 0
    const passes = Math.min(SIEGE_REROLL_PASSES_MAX, garrison)
    out.push({
      tone: 'info',
      text: `Вы осаждаете центр ${cell(key)} игрока ${nameOf(siege.besiegedId)}: гарнизон теряет по кораблю в начале хода. Штурм — маркером на этой клетке; при штурме гарнизон перебрасывает промахи${passes ? ` (${passes === 1 ? 'один раз' : 'дважды'})` : ''}.`,
    })
  }

  // Центры, которые сменят хозяина в начале следующего хода.
  for (const capture of powerCentersCapturedNextTurn(game)) {
    const key = `${capture.coord.q},${capture.coord.r}`
    if (capture.ownerId === playerId) {
      out.push({
        tone: 'warn',
        text: `Ваш центр ${cell(key)} перейдёт к игроку ${nameOf(capture.capturerId)} в начале следующего хода${capture.by === 'siege' ? ': у гарнизона остался последний корабль' : ''}.`,
      })
    } else if (capture.capturerId === playerId) {
      out.push({
        tone: 'good',
        text: capture.by === 'siege'
          ? `Центр ${cell(key)} станет вашим в начале следующего хода: у гарнизона остался последний корабль.`
          : `Центр ${cell(key)} можно занять в начале следующего хода — в счёт лимита захвата.`,
      })
    }
  }

  return out
}
