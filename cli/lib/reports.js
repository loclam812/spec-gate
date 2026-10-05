export const REPORT_FORMATS = ['go-json', 'junit']

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

const decode = (text) =>
  text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name])

function attribute(attrs, name) {
  const match = attrs.match(new RegExp(`\\b${name}="([^"]*)"`))
  return match ? decode(match[1]) : null
}

function junitCases(xml) {
  return [...xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)].map(([, attrs, body = '']) => {
    const name = attribute(attrs, 'name')
    const classname = attribute(attrs, 'classname')
    return { name: classname ? `${classname} > ${name}` : name, body }
  })
}

export function junitFailures(xml) {
  return new Map(
    junitCases(xml).flatMap(({ name, body }) => {
      const failed = body.match(/<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/)
      if (!failed) return []
      const [, , attrs, text = ''] = failed
      return [[name, { type: attribute(attrs, 'type') ?? '', message: attribute(attrs, 'message') ?? '', body: decode(text).trim() }]]
    }),
  )
}

function parseGoJson(output, { subtests = false } = {}) {
  const events = output.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
  const finals = events.filter(
    (event) => typeof event.Test === 'string' && (subtests || !event.Test.includes('/')) && ['pass', 'fail', 'skip'].includes(event.Action),
  )
  return new Map(finals.map((event) => [event.Test, event.Action]))
}

function parseJunit(xml) {
  return new Map(
    junitCases(xml).map(({ name, body }) => {
      const status = /<(failure|error)\b/.test(body) ? 'fail' : /<skipped\b/.test(body) ? 'skip' : 'pass'
      return [name, status]
    }),
  )
}

// Eval scores top-level tests only; a run also reads subtests, since a case id often names a t.Run.
export function parseReport(format, { output, xml }, { subtests = false } = {}) {
  if (format === 'go-json') return parseGoJson(output, { subtests })
  if (format === 'junit') return parseJunit(xml)
  throw new Error(`unknown report format "${format}"`)
}
