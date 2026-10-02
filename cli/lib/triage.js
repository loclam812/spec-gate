export const TIERS = ['t0', 't1', 't2']

const T0_SIGNALS = [
  'translation', 'translations', 'translate', 'i18n', 'locale', 'copy', 'wording', 'typo', 'rename',
  'config', 'docs', 'readme',
  'bản dịch', 'chính tả', 'đổi tên', 'cấu hình', 'tài liệu',
]

const T2_SIGNALS = [
  'feature', 'flow', 'page', 'screen', 'dialog', 'modal', 'form', 'permission', 'role', 'workflow',
  'concurrent', 'parallel', 'realtime', 'real-time', 'websocket', 'notification', 'endpoint', 'migration',
  'tính năng', 'màn hình', 'luồng', 'quyền', 'trạng thái', 'đồng thời', 'thời gian thực', 'thông báo',
]

const UI_SIGNALS = [
  'screen', 'page', 'dialog', 'modal', 'form', 'button', 'popup', 'layout', 'view',
  'màn hình', 'trang', 'nút', 'giao diện', 'biểu mẫu',
]

// \b is ASCII-only in JavaScript; Vietnamese keywords need Unicode letter boundaries, and the
// boundary also keeps "state" out of "statement" and "copy" out of "copyright".
function mentions(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text)
}

export function triage(request, { override = null, screens = [] } = {}) {
  if (override !== null) {
    if (!TIERS.includes(override)) throw new Error(`--tier must be one of ${TIERS.join(', ')}`)
    return { tier: override, reasons: ['user override'] }
  }
  const t0 = T0_SIGNALS.filter((phrase) => mentions(request, phrase))
  const t2 = [...T2_SIGNALS, ...screens.map((screen) => screen.toLowerCase())].filter((phrase) => mentions(request, phrase))
  if (t0.length > 0 && t2.length > 0) return { tier: 't1', reasons: [`mixed signals: ${[...t0, ...t2].join(', ')}`] }
  if (t2.length > 0) return { tier: 't2', reasons: [`signals: ${t2.join(', ')}`] }
  if (t0.length > 0) return { tier: 't0', reasons: [`signals: ${t0.join(', ')}`] }
  return { tier: 't1', reasons: ['no decisive signal'] }
}

export function mentionsUi(request, screens = []) {
  return [...UI_SIGNALS, ...screens].some((phrase) => mentions(request, phrase))
}
