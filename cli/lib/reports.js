export const REPORT_FORMATS = ['go-json', 'junit']

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

const decode = (text) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name])

function attribute(attrs, name) {
  const match = attrs.match(new RegExp(`\\b${name}="([^"]*)"`))
  return match ? decode(match[1]) : null
}

function parseGoJson(output) {
  const events = output.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
  const finals = events.filter(
    (event) => typeof event.Test === 'string' && !event.Test.includes('/') && ['pass', 'fail', 'skip'].includes(event.Action),
  )
  return new Map(finals.map((event) => [event.Test, event.Action]))
}

function parseJunit(xml) {
  const cases = [...xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)]
  return new Map(
    cases.map(([, attrs, body = '']) => {
      const name = attribute(attrs, 'name')
      const classname = attribute(attrs, 'classname')
      const status = /<(failure|error)\b/.test(body) ? 'fail' : /<skipped\b/.test(body) ? 'skip' : 'pass'
      return [classname ? `${classname} > ${name}` : name, status]
    }),
  )
}

export function parseReport(format, { output, xml }) {
  if (format === 'go-json') return parseGoJson(output)
  if (format === 'junit') return parseJunit(xml)
  throw new Error(`unknown report format "${format}"`)
}
