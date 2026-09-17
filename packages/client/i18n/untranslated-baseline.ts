/**
 * Файлы, в которых текст для игрока ещё зашит в разметку.
 *
 * Список умеет только сокращаться: перенесли тексты компонента в
 * `ui-strings.ts` — уберите его отсюда. Проверка `utils/ui-strings-guard.test.ts`
 * следит за обоими направлениями: новый файл с зашитым текстом она не пропустит,
 * а запись, из которой текст уже вычищен, потребует убрать.
 *
 * Порядок работ: сначала мелкие панели, затем крупные экраны
 * (`pages/game/[roomId].vue`, `pages/index.vue`, `components/BattleModal.vue`,
 * `components/MarkerActionModal.vue`) — каждый отдельным заходом.
 */
export const UNTRANSLATED_BASELINE: readonly string[] = [
  'components/BattleModal.vue',
  'components/BugReportModal.vue',
  'components/CellDetailPanel.vue',
  'components/CombatPreviewPanel.vue',
  'components/EventCardPanel.vue',
  'components/HexBoard.vue',
  'components/LandingMusicControl.vue',
  'components/MarkerActionModal.vue',
  'components/PatchNoteArticle.vue',
  'components/PhasePanel.vue',
  'components/RegionCellTooltip.vue',
  'components/RoomChatPanel.vue',
  'components/RoomLobbyPanel.vue',
  'components/SoundtrackPanel.vue',
  'pages/admin/index.vue',
  'pages/editor/index.vue',
  'pages/faq.vue',
  'pages/game/[roomId].vue',
  'pages/index.vue',
  'pages/legal/privacy.vue',
  'pages/legal/terms.vue',
  'pages/lobbies/index.vue',
  'pages/patch-notes/index.vue',
  'pages/patch-notes/[slug].vue',
]
