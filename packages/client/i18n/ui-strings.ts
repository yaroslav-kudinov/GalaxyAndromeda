/**
 * Строки новых кусков UI (лобби / чат / подсказки редактора).
 * Полный i18n (EN/ZH) отложен: держим ключи в одном модуле, чтобы не плодить хардкод.
 */
import { pluralRu } from '~/utils/ru-plural'

/** «остался 1 центр власти» / «осталось 2 центра власти» */
function powerCentersLeft(count: number): string {
  if (count === 1) return 'остался 1 центр власти'
  return `осталось ${count} ${pluralRu(count, 'центр', 'центра', 'центров')} власти`
}

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
  doctrines: {
    heading: 'Доктрина',
    windowLabel: (from: number, to: number) => `Ходы ${from}–${to}`,
    choosePrompt:
      'Выберите доктрину на эти ходы. Соперники увидят вашу доктрину, только когда выберут все.',
    gives: 'Даёт',
    costs: 'Платите',
    choose: 'Выбрать',
    choosing: 'Выбор…',
    yourPick: (name: string) => `Вы выбрали: ${name}. Ждём соперников.`,
    waitingFor: (names: string) => `Ещё выбирают: ${names}`,
    activeTitle: 'Доктрины в силе',
    you: 'вы',
    notChosen: 'без доктрины',
    untilTurn: (turn: number) => `до хода ${turn} включительно`,
    nextChoice: (turn: number) => `Следующий выбор — в начале хода ${turn}.`,
  },
  combatTargets: {
    heading: (round: number) => `Цели · раунд ${round}`,
    diceLeft: (free: number, total: number) => `Свободно кубиков: ${free} из ${total}`,
    allAssigned: 'Все кубики распределены',
    freeGoAuto: 'Свободные кубики игра раздаст сама',
    auto: 'Авто',
    autoHint: 'Распределить, как предложила бы игра: сначала добивать подбитые и самые опасные',
    clear: 'Снять все',
    add: 'Добавить кубик',
    remove: 'Убрать кубик',
    hits: (damage: number, hull: number) => `Попаданий ${damage} из ${hull}`,
    expected: (value: string) => `≈ ${value} попад.`,
    needs: (threshold: number) => `${threshold}+`,
    dieTitle: (ship: string, threshold: number, target: string | null) =>
      target ? `${ship}: нужно ${threshold}+ → ${target}` : `${ship}: нужно ${threshold}+, цель не выбрана`,
    pickDieHint: 'Щёлкните кубик внизу, затем «+» у цели. Щелчок по назначенному кубику возвращает его.',
    noDice: 'Вашим кораблям в этом раунде нечем стрелять.',
    noTargets: 'Целей не осталось.',
    support: 'поддержка',
    fire: 'Огонь',
    supportBanner: (round: number) =>
      `Раунд ${round}: ваши корабли поддерживают бой. Выберите цели и подтвердите — без вас раунд не начнётся.`,
    supportPickSide: 'Выберите сторону — затем цели своих кораблей.',
    supportReady: 'Готов',
    assaultBlocked: 'Штурм невозможен: ни одна сторона не может стрелять. Можно только осадить.',
  },
  turnAnnounce: {
    matchStart: 'Начало партии',
    rechargeHint:
      'Каждый ход в начале планирования перевёрнутые фишки поднимаются — не больше вашего бюджета перезарядки.',
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
  turnOrder: {
    heading: 'Очередь хода',
    you: 'вы',
    active: 'ходит сейчас',
    moved: 'уже сходил',
    waiting: 'ждёт своей очереди',
    entryTitle: (position: number, name: string, status: string) =>
      `${position}. ${name} — ${status}`,
    note: 'Порядок разыгрывается заново каждый ход.',
  },
  victory: {
    heading: 'Путь к победе',
    goal: (needed: number, total: number) =>
      `Побеждает тот, кто возьмёт ${needed} из ${total} центров власти.`,
    score: (controlled: number, needed: number) => `${controlled} / ${needed}`,
    left: (count: number) => `ещё ${count}`,
    reachedShort: 'порог взят',
    eliminatedShort: 'выбыл',
    you: 'вы',
    entryTitle: (name: string, controlled: number, needed: number, remaining: number) =>
      `${name}: ${controlled} из ${needed} центров власти, ${powerCentersLeft(remaining)}`,
    entryReachedTitle: (name: string, controlled: number) =>
      `${name}: ${controlled} ${pluralRu(controlled, 'центр', 'центра', 'центров')} власти`
      + ' — порог победы взят',
    entryEliminatedTitle: (name: string) => `${name} выбыл — потеряны все центры власти`,
    turnsLeft: (count: number) =>
      `До конца партии ${count} ${pluralRu(count, 'ход', 'хода', 'ходов')}.`,
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
