/**
 * Решение о звуковом уведомлении чата.
 *
 * Звук — только на чужие сообщения и только после первой загрузки истории:
 * иначе при входе в комнату прозвучал бы весь архив переписки.
 */

export type ChatNotifyMessage = {
  id: string
  fromPlayerId: string
}

export type ChatNotifyDecision = {
  /** Проиграть звук уведомления */
  play: boolean
  /** Сколько чужих сообщений пришло в этой порции */
  incoming: number
}

export function decideChatNotify(input: {
  fresh: readonly ChatNotifyMessage[]
  selfPlayerId: string | null
  /** История уже загружена: первая порция сообщений звук не даёт */
  primed: boolean
}): ChatNotifyDecision {
  const self = input.selfPlayerId
  if (!self) return { play: false, incoming: 0 }

  let incoming = 0
  for (const message of input.fresh) {
    if (message.fromPlayerId !== self) incoming += 1
  }

  return { play: input.primed && incoming > 0, incoming }
}
