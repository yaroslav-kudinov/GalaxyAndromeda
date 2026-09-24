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
    botsTitle: 'Боты',
    botsHint: 'Бот займёт свободное место и будет ходить сам. До начала игры бота можно убрать, чтобы место занял человек.',
    addBot: 'Посадить бота',
    removeBot: 'Убрать бота',
    freeSeat: 'свободно',
    botLevelLabel: 'Сложность бота',
    botLevel: { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный' } as Record<'easy' | 'medium' | 'hard', string>,
    botLevelHint: {
      easy: 'Играет прямолинейно: занимает ближайшее и нападает, когда сильнее.',
      medium: 'Меняет планы по обстановке — расширяется, копит силы, атакует. Свои центры власти почти не защищает.',
      hard: 'Играет на победу: защищает свои центры власти, мешает лидеру и добивает партию.',
    } as Record<'easy' | 'medium' | 'hard', string>,
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
    bot: 'бот',
    botWithLevel: (level: 'easy' | 'medium' | 'hard') =>
      `бот · ${{ easy: 'лёгкий', medium: 'средний', hard: 'сложный' }[level]}`,
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
  battleField: {
    supportLine: 'поддержка',
    bombardLine: 'обстрел',
    round: (n: number) => `Раунд ${n}`,
    hits: (n: number) => `попаданий ${n}`,
    destroyed: 'уничтожен',
    noFire: 'не стреляет',
    stats: (dice: number, threshold: number) => `${dice}к · ${threshold}+`,
    expected: (value: string) => `≈ ${value}`,
    likelyKill: 'хватит добить',
    diceFree: (free: number, total: number) => `Свободно кубиков: ${free} из ${total}`,
    allAssigned: 'Все кубики назначены',
    hint:
      'Щёлкните по вражескому кораблю — ему уйдёт свободный кубик: выбранный или самый точный. Щелчок по кубику на цели возвращает его, правый щелчок по цели снимает один кубик.',
    auto: 'Авто',
    autoHint: 'Распределить, как предложила бы игра: сначала добивать подбитые и самые опасные',
    clear: 'Снять все',
    dieGroup: (threshold: number, count: number) => (count > 1 ? `${threshold}+ ×${count}` : `${threshold}+`),
    dieTarget: (target: string) => `→ ${target}`,
    dieFree: 'свободен',
    returnDie: (threshold: number) => `Кубик ${threshold}+ — щёлкните, чтобы вернуть`,
    dieTitle: (threshold: number, target: string) =>
      target
        ? `Кубик ${threshold}+ → ${target}. Щёлкните, чтобы вернуть`
        : `Кубик ${threshold}+: щёлкните, затем выберите цель — или сразу щёлкните по цели`,
    rolledTitle: (value: number, threshold: number, hit: boolean, target: string) =>
      `${value} (нужно ${threshold}+)${target ? ` → ${target}` : ''}: ${hit ? 'попадание' : 'промах'}`,
    shipTitle: (
      name: string,
      owner: string,
      damage: number,
      hull: number,
      dice: number,
      threshold: number | null,
      distance: number,
    ) =>
      `${name} · ${owner}. Попаданий ${damage} из ${hull}. `
      + (dice && threshold != null ? `Кубиков: ${dice}, попадает на ${threshold}+` : 'Не стреляет')
      + (distance > 0 ? `, стреляет с расстояния ${distance}` : ''),
    ready: 'готов',
    notReady: 'ждём',
  },
  combatRerolls: {
    heading: (round: number) => `Раунд ${round}: перебросы гарнизона`,
    left: (count: number) => `Перебросов: ${count}`,
    mineHint:
      'Ваш гарнизон может перебросить свои промахи — по одному на корабль. Щёлкните промах, посмотрите результат и решайте дальше.',
    waiting: (name: string) => `${name} перебрасывает промахи гарнизона. Попадания применятся после.`,
    support: 'поддержка',
    noTarget: 'без цели',
    dieTitle: (value: number, threshold: number, target: string, history: number[]) =>
      `${value} (нужно ${threshold}+) → ${target}${history.length ? `; было ${history.join(', ')}` : ''}`,
    auto: 'Перебросить остальное за меня',
    done: 'Готово',
    destroyed: 'будет уничтожен',
    hitsNow: (count: number) => `+${count} попад. сейчас`,
    shipTitle: (name: string, before: number, now: number, hull: number) =>
      `${name}: до раунда попаданий ${before}, в этом броске ${now}, прочность ${hull}`,
  },
  siegeContinuation: {
    title: (q: number, r: number) => `Бой за осаждённый центр (${q}, ${r}) выигран`,
    body: 'Продолжить осаду — гарнизон снова решит, нападать ли. Или отойти всем флотом на соседнюю клетку, сняв осаду.',
    keep: 'Продолжить осаду',
    withdraw: (q: number, r: number) => `Отойти в (${q}, ${r})`,
    waiting: (name: string) => `${name} решает, продолжать ли осаду`,
    blocked: 'Сначала решите, продолжать ли осаду',
  },
  garrisonChoice: {
    banner: 'Ваш гарнизон стоит на клетке этого боя. Встаньте на сторону одного из противников — тогда он будет биться на клетке — или не вмешивайтесь.',
  },
  siegeMark: {
    note: (besieger: string, besieged: string, garrison: number) =>
      `Осада: ${besieger} осаждает центр игрока ${besieged}. В гарнизоне ${garrison} ${pluralRu(garrison, 'корабль', 'корабля', 'кораблей')}: в начале каждого хода гарнизон теряет корабль, а когда кораблей не останется, центр перейдёт к осаждающему. Гарнизон может напасть на осаждающих или отступить.`,
  },
  captureAhead: {
    siege: (name: string) =>
      `В начале следующего хода перейдёт к игроку ${name}: у гарнизона остался последний корабль, осада его снимет.`,
    claim: (name: string) =>
      `В начале следующего хода может перейти к игроку ${name}: на центре только его корабли, он займёт центр в счёт лимита захвата.`,
  },
  planningDecisions: {
    heading: 'Нужно решить',
    sub: 'Решения идут по порядку. Пока они не приняты, маркеры не ставятся и ход не передаётся.',
    blocked: 'Сначала примите решения в карточке «Нужно решить» над картой',
    stepsLabel: 'Порядок решений в начале хода',
    stepNames: {
      'siege-losses': 'Потери в осаде',
      doctrine: 'Доктрина',
      'doctrine-wait': 'Доктрина',
      claims: 'Клетки захвата',
      recharge: 'Фишки перезарядки',
      markers: 'Маркеры действия',
    },
    doctrineWait: (picked: number, total: number) =>
      `Ваша доктрина выбрана. Ждём остальных: выбрали ${picked} из ${total}. Доктрины вскроются разом, и тогда станет известно, сколько клеток можно занять.`,
    stepBlocked: {
      'siege-losses': 'Сначала выберите, какой корабль гарнизона потерять в осаде',
      doctrine: 'Сначала выберите доктрину в карточке «Нужно решить»',
      'doctrine-wait': 'Ждём, пока доктрину выберут все игроки',
      claims: 'Сначала выберите клетки для захвата',
      recharge: 'Сначала выберите фишки для перезарядки',
    },
    combatFirst: 'Сначала завершите бой',
    doctrineTitle: 'Доктрина на ближайшие ходы — соперники увидят её, когда выберут все',
    costs: 'платите',
    claimsTitle: (need: number, total: number) =>
      `Захват: ваши корабли стоят на ${total} клетках, занять можно ${need}. Выберите здесь или щелчком по клетке на карте — подходящие обведены пунктиром.`,
    claimsConfirm: (picked: number, need: number) => `Занять (${picked} из ${need})`,
    rechargeTitle: (need: number, total: number) =>
      `Перезарядка: поднимите лицом вверх ${need} из ${total} перевёрнутых фишек. Выберите здесь или щелчком по клетке на карте — клетки с перевёрнутыми фишками обведены пунктиром.`,
    rechargeConfirm: (picked: number, need: number) => `Поднять (${picked} из ${need})`,
    siegeTitle: 'Осада: гарнизон теряет по кораблю на каждой осаждённой клетке. Выберите, какой.',
    siegeConfirm: 'Потерять выбранные',
    powerCenter: 'центр власти',
    noTokens: 'без фишек',
    credits: (value: number) => `кредиты ${value}`,
    production: (value: number) => `производство ${value}`,
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
    bot: 'бот',
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
