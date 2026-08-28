export const CATEGORIES = [
  'appointments',
  'deadlines',
  'instructions',
  'locations',
  'documents',
  'decisions',
  'clarifications',
  'nextSteps',
]

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function specValues(spec) {
  if (typeof spec === 'string') return [spec]
  if (!spec || typeof spec !== 'object' || typeof spec.canonical !== 'string') return []
  return [spec.canonical, ...(Array.isArray(spec.aliases) ? spec.aliases : [])]
}

function matchesSpec(expected, predicted) {
  const normalized = normalizeText(predicted)
  return normalized.length > 0 && specValues(expected).some((value) => normalizeText(value) === normalized)
}

function matchScalarFacts(expected = [], predicted = []) {
  const used = new Set()
  let truePositives = 0
  let falseNegatives = 0

  for (const expectedFact of expected) {
    const matchIndex = predicted.findIndex((fact, index) => !used.has(index) && matchesSpec(expectedFact, fact))
    if (matchIndex === -1) {
      falseNegatives += 1
    } else {
      used.add(matchIndex)
      truePositives += 1
    }
  }

  return {
    truePositives,
    falseNegatives,
    falsePositives: predicted.length - used.size,
  }
}

const APPOINTMENT_FIELDS = ['date', 'time', 'location', 'notes']

function appointmentMatches(expected, predicted) {
  return APPOINTMENT_FIELDS.every((field) => {
    const expectedValue = expected?.[field]
    if (expectedValue === null || expectedValue === undefined) return true
    return typeof predicted?.[field] === 'string' && matchesSpec(expectedValue, predicted[field])
  })
}

function matchAppointments(expected = [], predicted = []) {
  const used = new Set()
  let truePositives = 0
  let falseNegatives = 0

  for (const expectedAppointment of expected) {
    const matchIndex = predicted.findIndex((appointment, index) => !used.has(index) && appointmentMatches(expectedAppointment, appointment))
    if (matchIndex === -1) {
      falseNegatives += 1
    } else {
      used.add(matchIndex)
      truePositives += 1
    }
  }

  return {
    truePositives,
    falseNegatives,
    falsePositives: predicted.length - used.size,
  }
}

function emptyCounts() {
  return { truePositives: 0, falsePositives: 0, falseNegatives: 0 }
}

export function validateSummary(summary) {
  const errors = []
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return { valid: false, errors: ['summary must be an object'] }
  }

  if (typeof summary.summary !== 'string') errors.push('summary.summary must be a string')

  for (const category of CATEGORIES) {
    if (!Array.isArray(summary[category])) {
      errors.push(`summary.${category} must be an array`)
      continue
    }
    if (category !== 'appointments' && summary[category].some((fact) => typeof fact !== 'string')) {
      errors.push(`summary.${category} must contain only strings`)
    }
  }

  if (Array.isArray(summary.appointments)) {
    summary.appointments.forEach((appointment, index) => {
      if (!appointment || typeof appointment !== 'object' || Array.isArray(appointment)) {
        errors.push(`summary.appointments[${index}] must be an object`)
        return
      }
      for (const field of APPOINTMENT_FIELDS) {
        if (!(field in appointment)) errors.push(`summary.appointments[${index}] is missing ${field}`)
      }
      if (!('date' in appointment) || (appointment.date !== null && typeof appointment.date !== 'string')) errors.push(`summary.appointments[${index}].date has an invalid type`)
      if (!('time' in appointment) || (appointment.time !== null && typeof appointment.time !== 'string')) errors.push(`summary.appointments[${index}].time has an invalid type`)
      if (!('location' in appointment) || (appointment.location !== null && typeof appointment.location !== 'string')) errors.push(`summary.appointments[${index}].location has an invalid type`)
      if (!('notes' in appointment) || typeof appointment.notes !== 'string') errors.push(`summary.appointments[${index}].notes has an invalid type`)
    })
  }

  return { valid: errors.length === 0, errors }
}

function countsForFixture(fixture, summary) {
  const counts = Object.fromEntries(CATEGORIES.map((category) => [category, emptyCounts()]))
  for (const category of CATEGORIES) {
    counts[category] = category === 'appointments'
      ? matchAppointments(fixture.expected[category], summary[category])
      : matchScalarFacts(fixture.expected[category], summary[category])
  }
  return counts
}

export function calculateMetrics(countsByCategory) {
  const perCategory = {}
  const total = emptyCounts()

  for (const category of CATEGORIES) {
    const counts = countsByCategory[category] ?? emptyCounts()
    perCategory[category] = { ...counts, ...rates(counts) }
    total.truePositives += counts.truePositives
    total.falsePositives += counts.falsePositives
    total.falseNegatives += counts.falseNegatives
  }

  return { ...total, ...rates(total), perCategory }
}

function rates({ truePositives, falsePositives, falseNegatives }) {
  const precisionDenominator = truePositives + falsePositives
  const recallDenominator = truePositives + falseNegatives
  const precision = precisionDenominator === 0 ? null : truePositives / precisionDenominator
  const recall = recallDenominator === 0 ? null : truePositives / recallDenominator
  const f1 = precision === null || recall === null || precision + recall === 0
    ? null
    : (2 * precision * recall) / (precision + recall)
  return { precision, recall, f1 }
}

export function scoreFixture(fixture, summary) {
  const validation = validateSummary(summary)
  if (!validation.valid) {
    return { schemaValid: false, validationErrors: validation.errors, counts: null }
  }
  const counts = countsForFixture(fixture, summary)
  return { schemaValid: true, validationErrors: [], counts, metrics: calculateMetrics(counts) }
}

export function aggregateFixtureScores(scores) {
  const aggregateCounts = Object.fromEntries(CATEGORIES.map((category) => [category, emptyCounts()]))
  let schemaValid = 0

  for (const score of scores) {
    if (score.schemaValid) {
      schemaValid += 1
      for (const category of CATEGORIES) {
        const target = aggregateCounts[category]
        const source = score.counts[category]
        target.truePositives += source.truePositives
        target.falsePositives += source.falsePositives
        target.falseNegatives += source.falseNegatives
      }
    }
  }

  const metrics = calculateMetrics(aggregateCounts)
  const extractedFacts = metrics.truePositives + metrics.falsePositives
  const unsupportedFacts = metrics.falsePositives
  return {
    schemaValid,
    extraction: metrics,
    unsupportedFacts,
    extractedFacts,
    unsupportedRate: extractedFacts === 0 ? null : unsupportedFacts / extractedFacts,
  }
}

export function percentile(values, percentileValue) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil(percentileValue * sorted.length))
  return sorted[rank - 1]
}

export function validateFixtures(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) throw new Error('fixtures.json must contain a non-empty array')
  const ids = new Set()
  for (const fixture of fixtures) {
    if (!fixture || typeof fixture !== 'object') throw new Error('Each fixture must be an object')
    if (typeof fixture.id !== 'string' || fixture.id.length === 0) throw new Error('Each fixture needs a stable id')
    if (ids.has(fixture.id)) throw new Error(`Duplicate fixture id: ${fixture.id}`)
    ids.add(fixture.id)
    if (!Array.isArray(fixture.transcript) || fixture.transcript.length === 0) throw new Error(`${fixture.id}: transcript must be non-empty`)
    if (!fixture.expected || typeof fixture.expected !== 'object') throw new Error(`${fixture.id}: expected is required`)
    for (const category of CATEGORIES) {
      if (!Array.isArray(fixture.expected[category])) throw new Error(`${fixture.id}: expected.${category} must be an array`)
    }
    for (const appointment of fixture.expected.appointments) {
      if (!appointment || typeof appointment !== 'object') throw new Error(`${fixture.id}: expected appointment must be an object`)
      for (const field of APPOINTMENT_FIELDS) {
        if (!(field in appointment)) throw new Error(`${fixture.id}: expected appointment missing ${field}`)
      }
    }
  }
  return fixtures.length
}
