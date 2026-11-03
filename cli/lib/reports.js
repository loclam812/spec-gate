export const REPORT_FORMATS = ['go-json', 'junit', 'trx']

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

// CDATA text is literal; everything outside it is entity-encoded.
const decode = (text) =>
  text
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((part) => (part.startsWith('<![CDATA[') ? part.slice(9, -3) : decodeEntities(part)))
    .join('')

const decodeEntities = (text) =>
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
    return { name: classname ? `${classname} > ${name}` : name, body, file: attribute(attrs, 'file') ?? classname }
  })
}

// node --test names a case's file in its own attribute; vitest's classname is the file.
export function junitFiles(xml) {
  return new Map(junitCases(xml).map(({ name, file }) => [name, file]))
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

function parseGoJson(output) {
  const events = output.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
  const finals = events.filter(
    (event) => typeof event.Test === 'string' && ['pass', 'fail', 'skip'].includes(event.Action),
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

const TRX_STATUS = { Passed: 'pass', Failed: 'fail', Error: 'fail', Timeout: 'fail', Aborted: 'fail' }

// xUnit names a result by its full method name, NUnit and MSTest by the method alone; the class
// comes from the test definition, so every framework reads as `<class> > <test>`.
function trxResults(xml) {
  const classes = new Map(
    [...xml.matchAll(/<UnitTest\b([^>]*)>[\s\S]*?<TestMethod\b([^>]*?)\/?>/g)].map(([, attrs, method]) => [attribute(attrs, 'id'), attribute(method, 'className') ?? '']),
  )
  return [...xml.matchAll(/<UnitTestResult\b([^>]*?)(?:\/>|>([\s\S]*?)<\/UnitTestResult>)/g)].map(([, attrs, body = '']) => {
    const className = classes.get(attribute(attrs, 'testId')) ?? ''
    const testName = attribute(attrs, 'testName') ?? ''
    const test = testName.startsWith(`${className}.`) ? testName.slice(className.length + 1) : testName
    const outcome = attribute(attrs, 'outcome') ?? ''
    return { name: `${className.split('.').pop()} > ${test}`, status: TRX_STATUS[outcome] ?? 'skip', outcome, body }
  })
}

const element = (body, tag) => decode(body.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? '').trim()

export function trxFailures(xml) {
  return new Map(
    trxResults(xml)
      .filter(({ status }) => status === 'fail')
      .map(({ name, outcome, body }) => [name, { type: outcome === 'Timeout' ? 'timeout' : '', message: element(body, 'Message'), body: element(body, 'StackTrace') }]),
  )
}

// A TRX names no source file; the stack trace does. Frames under /_/ are a package's own source
// (deterministic build paths: MSTest's asserts come first), so the first other frame is the test's.
export function trxFiles(xml) {
  return new Map(
    [...trxFailures(xml)].flatMap(([name, { body }]) => {
      const file = [...body.matchAll(/ in (.+?):line \d+/g)].map((match) => match[1]).find((path) => !path.startsWith('/_/'))
      return file ? [[name, file]] : []
    }),
  )
}

export function reportFailures(format, xml) {
  if (format === 'junit') return Object.fromEntries(junitFailures(xml))
  if (format === 'trx') return Object.fromEntries(trxFailures(xml))
  return {}
}

export function reportFiles(format, xml) {
  if (format === 'junit') return junitFiles(xml)
  if (format === 'trx') return trxFiles(xml)
  return new Map()
}

export function hasCases(format, xml) {
  if (format === 'junit') return /<testcase\b/.test(xml)
  if (format === 'trx') return /<UnitTestResult\b/.test(xml)
  return false
}

// Go subtests are read like junit leaves: a case id often names a t.Run, and a table test whose
// parent fails on both trees can still hold the subtest that catches the bug.
export function parseReport(format, { output, xml }) {
  if (format === 'go-json') return parseGoJson(output)
  if (format === 'junit') return parseJunit(xml)
  if (format === 'trx') return new Map(trxResults(xml).map(({ name, status }) => [name, status]))
  throw new Error(`unknown report format "${format}"`)
}
