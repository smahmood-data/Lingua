import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  aggregateFixtureScores,
  calculateMetrics,
  percentile,
  scoreFixture,
  validateSummary,
} from './scoring.mjs'

const baseFixture = (expected) => ({
  id: 'test',
  transcript: [{ speaker: 'user', originalText: 'test' }],
  expected: {
    appointments: [], deadlines: [], instructions: [], locations: [], documents: [], decisions: [], clarifications: [], nextSteps: [],
    ...expected,
  },
})

const validSummary = (overrides = {}) => ({
  summary: 'A concise summary.',
  appointments: [], deadlines: [], instructions: [], locations: [], documents: [], decisions: [], clarifications: [], nextSteps: [],
  ...overrides,
})

test('perfect scalar prediction scores one true positive', () => {
  const score = scoreFixture(baseFixture({ documents: [{ canonical: 'photo ID' }] }), validSummary({ documents: ['photo ID'] }))
  assert.equal(score.schemaValid, true)
  assert.deepEqual(score.counts.documents, { truePositives: 1, falsePositives: 0, falseNegatives: 0 })
})

test('aliases and punctuation normalization match conservatively', () => {
  const score = scoreFixture(baseFixture({ locations: [{ canonical: 'Main Street branch', aliases: ['Main Street bank branch'] }] }), validSummary({ locations: ['MAIN STREET BANK BRANCH.'] }))
  assert.equal(score.metrics.precision, 1)
  assert.equal(score.metrics.recall, 1)
})

test('missing and extra facts are counted separately', () => {
  const score = scoreFixture(baseFixture({ documents: [{ canonical: 'passport' }, { canonical: 'visa' }] }), validSummary({ documents: ['passport', 'birth certificate'] }))
  assert.deepEqual(score.counts.documents, { truePositives: 1, falsePositives: 1, falseNegatives: 1 })
})

test('one prediction cannot match two expected facts', () => {
  const score = scoreFixture(baseFixture({ documents: [{ canonical: 'ID' }, { canonical: 'photo ID' }] }), validSummary({ documents: ['photo ID'] }))
  assert.deepEqual(score.counts.documents, { truePositives: 1, falsePositives: 0, falseNegatives: 1 })
})

test('empty expected and empty predicted facts have explicit null rates', () => {
  const metrics = calculateMetrics({ appointments: { truePositives: 0, falsePositives: 0, falseNegatives: 0 } })
  assert.equal(metrics.precision, null)
  assert.equal(metrics.recall, null)
  assert.equal(metrics.f1, null)
})

test('empty expected plus an extracted fact is unsupported', () => {
  const score = scoreFixture(baseFixture({}), validSummary({ locations: ['invented location'] }))
  const aggregate = aggregateFixtureScores([{ schemaValid: true, counts: score.counts }])
  assert.equal(aggregate.unsupportedFacts, 1)
  assert.equal(aggregate.unsupportedRate, 1)
})

test('appointment fields use one-to-one matching and aliases', () => {
  const fixture = baseFixture({ appointments: [{ date: { canonical: 'Thursday' }, time: { canonical: '2 PM', aliases: ['2:00 PM'] }, location: null, notes: null }] })
  const summary = validSummary({ appointments: [{ date: 'Thursday', time: '2:00 PM', location: null, notes: '' }, { date: 'Tuesday', time: '2 PM', location: null, notes: '' }] })
  const score = scoreFixture(fixture, summary)
  assert.deepEqual(score.counts.appointments, { truePositives: 1, falsePositives: 1, falseNegatives: 0 })
})

test('schema validation catches missing fields and wrong types', () => {
  const validation = validateSummary({ summary: '', appointments: [{ date: null, time: null, location: null }], deadlines: [], instructions: [], locations: [], documents: [], decisions: [], clarifications: [], nextSteps: [] })
  assert.equal(validation.valid, false)
  assert.match(validation.errors.join(' '), /missing notes/)
})

test('percentiles use deterministic nearest-rank values', () => {
  assert.equal(percentile([40, 10, 30, 20], 0.5), 20)
  assert.equal(percentile([40, 10, 30, 20], 0.95), 40)
  assert.equal(percentile([], 0.5), null)
})
