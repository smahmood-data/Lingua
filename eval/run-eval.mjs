import { performance } from 'node:perf_hooks'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { aggregateFixtureScores, percentile, scoreFixture, validateFixtures } from './scoring.mjs'

const DEFAULT_BASE_URL = 'http://localhost:3001'
const REQUEST_TIMEOUT_MS = 60_000

async function loadFixtures() {
  const raw = await readFile(new URL('./fixtures.json', import.meta.url), 'utf8')
  const fixtures = JSON.parse(raw)
  validateFixtures(fixtures)
  return fixtures
}

function safeOrigin(value) {
  try {
    return new URL(value).origin
  } catch {
    return value
  }
}

function percent(value) {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`
}

function formatAppointment(appointment) {
  return `${appointment.date ?? 'date n/a'} at ${appointment.time ?? 'time n/a'}${appointment.location ? `, ${appointment.location}` : ''}`
}

function printResults(results, aggregate, baseUrl) {
  const latencies = results.map((result) => result.latencyMs)
  const successful = results.filter((result) => result.httpOk)
  const failures = results.filter((result) => !result.httpOk || !result.schemaValid || result.metrics?.falseNegatives > 0 || result.metrics?.falsePositives > 0)

  console.log('Lingua Summary Evaluation')
  console.log('=========================')
  console.log(`Backend: ${safeOrigin(baseUrl)}`)
  console.log(`Fixtures: ${results.length}`)
  console.log(`HTTP successes: ${successful.length}/${results.length}`)
  console.log(`Schema validity: ${aggregate.schemaValid}/${results.length} (${percent(aggregate.schemaValid / results.length)})`)
  console.log('')
  console.log('Overall extraction')
  console.log(`True positives:  ${aggregate.extraction.truePositives}`)
  console.log(`False positives: ${aggregate.extraction.falsePositives}`)
  console.log(`False negatives: ${aggregate.extraction.falseNegatives}`)
  console.log(`Precision:       ${percent(aggregate.extraction.precision)}`)
  console.log(`Recall:          ${percent(aggregate.extraction.recall)}`)
  console.log(`F1:              ${percent(aggregate.extraction.f1)}`)
  console.log('')
  console.log('Unsupported facts')
  console.log(`${aggregate.unsupportedFacts} unsupported / ${aggregate.extractedFacts} extracted`)
  console.log(`Rate: ${percent(aggregate.unsupportedRate)}`)
  console.log('')
  console.log('Per-category metrics')
  for (const [category, metrics] of Object.entries(aggregate.extraction.perCategory)) {
    console.log(`${category}: P ${percent(metrics.precision)} | R ${percent(metrics.recall)} | F1 ${percent(metrics.f1)} (${metrics.truePositives} TP, ${metrics.falsePositives} FP, ${metrics.falseNegatives} FN)`)
  }
  console.log('')
  console.log('Latency')
  console.log(`p50: ${percentile(latencies, 0.5)?.toFixed(1) ?? 'n/a'} ms`)
  console.log(`p95: ${percentile(latencies, 0.95)?.toFixed(1) ?? 'n/a'} ms`)
  console.log('')
  console.log('Failure analysis')
  if (failures.length === 0) {
    console.log('No failed or mismatched fixtures.')
  } else {
    for (const result of failures) {
      console.log(`FAIL ${result.id}`)
      console.log(`  Expected: ${JSON.stringify(result.expected)}`)
      if (result.error) console.log(`  Error: ${result.error}`)
      if (result.validationErrors?.length) console.log(`  Schema: ${result.validationErrors.join('; ')}`)
      if (result.predicted) {
        console.log(`  Received: ${JSON.stringify(result.predicted)}`)
        console.log(`  Received appointments: ${result.predicted.appointments.map(formatAppointment).join(' | ') || '(none)'}`)
      }
      if (result.metrics) console.log(`  Counts: ${result.metrics.truePositives} TP, ${result.metrics.falsePositives} FP, ${result.metrics.falseNegatives} FN`)
    }
  }
}

function machineResults(results, aggregate, baseUrl) {
  return {
    runAt: new Date().toISOString(),
    backendOrigin: safeOrigin(baseUrl),
    fixtureCount: results.length,
    schemaValidity: { validResponses: aggregate.schemaValid, percentage: aggregate.schemaValid / results.length },
    extraction: aggregate.extraction,
    unsupportedFacts: { count: aggregate.unsupportedFacts, extractedFacts: aggregate.extractedFacts, rate: aggregate.unsupportedRate },
    latencyMs: {
      p50: percentile(results.map((result) => result.latencyMs), 0.5),
      p95: percentile(results.map((result) => result.latencyMs), 0.95),
      perFixture: Object.fromEntries(results.map((result) => [result.id, result.latencyMs])),
    },
    fixtures: results,
  }
}

async function evaluateFixture(fixture, baseUrl) {
  const started = performance.now()
  let response
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ transcript: fixture.transcript, ...(fixture.preferredLanguage ? { preferredLanguage: fixture.preferredLanguage } : {}) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(`Unable to reach Lingua backend at ${baseUrl}. Start the backend before running the evaluation. (${error.message})`)
  }

  const latencyMs = performance.now() - started
  const result = { id: fixture.id, name: fixture.name, expected: fixture.expected, latencyMs, httpStatus: response.status, httpOk: response.ok }
  if (!response.ok) {
    result.error = `HTTP ${response.status}: ${await response.text()}`
    return result
  }

  let body
  try {
    body = await response.json()
  } catch (error) {
    result.error = `Response was not valid JSON: ${error.message}`
    result.schemaValid = false
    result.validationErrors = [result.error]
    return result
  }

  const summary = body?.summary
  const score = scoreFixture(fixture, summary)
  result.schemaValid = score.schemaValid
  result.validationErrors = score.validationErrors
  result.predicted = summary
  result.metrics = score.metrics
  return result
}

const baseUrl = process.env.LINGUA_EVAL_BASE_URL || DEFAULT_BASE_URL
const fixtures = await loadFixtures()
const results = []
for (const fixture of fixtures) {
  results.push(await evaluateFixture(fixture, baseUrl))
}

const scores = results.filter((result) => result.schemaValid).map((result) => ({ schemaValid: true, counts: result.metrics ? Object.fromEntries(Object.entries(result.metrics.perCategory).map(([category, metrics]) => [category, { truePositives: metrics.truePositives, falsePositives: metrics.falsePositives, falseNegatives: metrics.falseNegatives }])) : null }))
const aggregate = aggregateFixtureScores(scores)
printResults(results, aggregate, baseUrl)

if (process.argv.includes('--write-results')) {
  await writeFile(resolve('eval/results.json'), `${JSON.stringify(machineResults(results, aggregate, baseUrl), null, 2)}\n`)
  console.log('\nWrote eval/results.json')
}
