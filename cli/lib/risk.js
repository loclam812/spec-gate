const FEATURE_SIGNALS = [
  'feature', 'flow', 'page', 'screen', 'dialog', 'modal', 'form', 'permission', 'role', 'workflow',
  'concurrent', 'parallel', 'realtime', 'real-time', 'websocket', 'notification', 'endpoint', 'migration',
  'tính năng', 'màn hình', 'luồng', 'quyền', 'trạng thái', 'đồng thời', 'thời gian thực', 'thông báo',
]

// Who may do what: a one-line change here is still a permission change, so these decide T2 even
// next to a T0 word ("change the config so guests can …").
const ACCESS_SIGNALS = [
  'admin', 'admins', 'viewer', 'viewers', 'guest', 'guests', 'access', 'allow', 'allowed', 'deny', 'denied',
  'cho phép', 'người xem', 'quản trị', 'truy cập',
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

export function riskSignals(request, { screens = [] } = {}) {
  const found = (phrases) => phrases.filter((phrase) => mentions(request, phrase))
  const access = found(ACCESS_SIGNALS)
  const feature = found(FEATURE_SIGNALS)
  const screenHits = found(screens.map((screen) => screen.toLowerCase()))
  const ui = mentionsUi(request)
  const level = access.length > 0 || feature.length + screenHits.length >= 2 ? 'high' : 'low'
  return { access, feature, screens: screenHits, ui, level }
}

export function mentionsUi(request) {
  return UI_SIGNALS.some((phrase) => mentions(request, phrase))
}
