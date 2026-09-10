/**
 * Строки новых кусков UI (лобби / чат / подсказки редактора).
 * Полный i18n (EN/ZH) отложен: держим ключи в одном модуле, чтобы не плодить хардкод.
 */
export const uiStringsRu = {
  lobby: {
    titleJoin: 'Вход в комнату',
    titlePrep: 'Комната подготовки',
    playersMeta: (count: number, max: number) => `Игроков: ${count}/${max}`,
    codeMeta: (code: string) => `код ${code}`,
    playingHint: 'игра уже идёт',
    pickSlotJoin: 'Стартовая позиция и цвет',
    pickSlotPrep: 'Где играть и цвет',
    prepHint:
      'Выберите стартовую позицию на карте и цвет. Партия начнётся, когда создатель комнаты нажмёт «Начать игру».',
    waitingHost: 'Ждём, пока создатель комнаты начнёт игру…',
    startGame: 'Начать игру',
    starting: 'Старт…',
    copyInvite: 'Скопировать ссылку',
    inviteCopied: 'Ссылка скопирована',
    closeRoom: 'Закрыть комнату',
    moreOptions: 'Ещё',
    hideOptions: 'Свернуть',
    enterAsPrefix: 'Вы войдёте как',
    needNickname: 'Никнейм не задан — выберите на главной',
    roomFull: 'Все слоты заняты — дождитесь освобождения места.',
    backHome: '← На главную',
    backLobbies: 'Список лобби',
    leaveHome: '← Выйти',
    joinSubmit: 'Войти',
    joining: 'Вход…',
  },
  chat: {
    title: 'Чат',
    publicChannel: 'Общий',
    dmChannel: (name: string) => `Лично: ${name}`,
    placeholderPublic: 'Сообщение в комнату…',
    placeholderDm: 'Личное сообщение…',
    send: 'Отправить',
    open: 'Чат',
    close: 'Свернуть чат',
    empty: 'Пока нет сообщений',
    pickPeer: 'Кому',
    everyone: 'Всем',
    you: 'вы',
    errorSend: 'Не удалось отправить',
  },
  editor: {
    hotkeysBarTitle: 'Клавиши',
    multiSelected: (n: number) => `Выбрано клеток: ${n}`,
    tokenValue: 'Значение',
  },
} as const

export type UiStrings = typeof uiStringsRu

/** Единая точка для будущего переключения локали */
export function useUiStrings(): UiStrings {
  return uiStringsRu
}
