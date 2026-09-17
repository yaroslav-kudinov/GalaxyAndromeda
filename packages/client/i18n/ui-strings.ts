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
  patchToast: {
    kicker: 'Обновление',
    read: 'Читать',
    dismiss: 'Понятно',
  },
  cell: {
    powerCenter: 'Центр власти',
    fleet: 'Корабли',
    fleetEmpty: 'Кораблей нет',
  },
  rulesHelp: {
    title: 'Справка по правилам',
    // Раньше: «Краткая однозначная выжимка на русском» — канцелярит,
    // и «правая панель» вместо принятого в глоссарии названия
    sub: 'Короткий разбор правил. Подсказка для текущего хода — в боковой панели.',
    close: 'Закрыть',
    sections: 'Разделы правил',
  },
  lobbyPlayers: {
    freeSlot: 'Свободный слот',
    you: 'ваш слот',
    inGame: 'на странице партии',
    inRoom: 'в комнате',
    awaited: 'ждём игрока',
  },
  coach: {
    badge: 'Обучение',
    grip: 'Потяните, чтобы переставить подсказку',
    objective: 'Сейчас',
    more: 'Подробнее',
    why: 'Зачем:',
    hint: 'Подсказка:',
    next: 'Далее',
    finish: 'Завершить обучение',
  },
  turnEvents: {
    heading: 'События хода',
    pastTurns: (count: number) => `Прошлые ходы (${count})`,
    turn: (number: number) => `Ход ${number}`,
    applied: 'Применено',
    appliedAt: (when: string) => `Применено ${when}`,
    notApplied: 'Не применено',
    // Раньше: «События прошлых ходов пока не зафиксированы в журнале» —
    // канцелярит про журнал вместо простого объяснения
    empty: 'Прошлых ходов ещё не было — здесь появится их история.',
  },
  turnAnnounce: {
    newTurn: (number: number) => `Новый ход ${number}`,
    matchStart: 'Начало партии',
    // Раньше: «Карта уже применена автоматически» — неясно, карта события
    // или игровая карта; и рассказ про то, чем является само окно
    eventHint: 'Карта события уже вступила в силу — подтверждать ничего не нужно.',
    rechargeHint:
      'Когда счётчик дойдёт до нуля, перевёрнутые фишки ресурсов снова станут доступны.',
    ok: 'Понятно',
  },
  productionOrder: {
    fleetLabel: 'Корабли в заявке',
    placedAt: (q: number, r: number) => `на клетке (${q}, ${r})`,
    // Раньше: «Щелчок — убрать этот и следующие» — телеграф
    removeHint: 'Щёлкните, чтобы убрать этот корабль и все следующие за ним.',
    pickCell: 'щёлкните клетку региона',
    notPlaced: 'ещё не размещён',
  },
  slots: {
    pickTitle: 'Выбор стартовой позиции и цвета',
    slotNumber: (n: number) => `Слот ${n}`,
    slotWord: 'Слот',
    you: 'вы',
    free: 'свободно',
    taken: 'занят',
    chosen: 'выбран',
    available: 'свободен',
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
