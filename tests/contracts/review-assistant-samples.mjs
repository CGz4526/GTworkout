import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

// Explicit audit of archived synthetic reports. No fetch, credentials or database access.
const root = new URL('../../', import.meta.url)
const read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'))
const scenarios = read('server/src/test/resources/contracts/assistant-scenarios.json')
const inputs = [
  { file: '.cache/assistant-live-eval2.json', variant: 'baseline', ids: ['A01', 'A02', 'A03', 'A04', 'A05', 'A06'] },
  { file: '.cache/assistant-live-eval2-multi.json', variant: 'multi-actions', ids: ['A01', 'A02', 'A06'] },
]
const inRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max
const results = []
let refused = 0
let previousCumulative = 0
for (const input of inputs) {
  const report = read(input.file)
  assert.equal(report.data, 'synthetic-only')
  assert.equal(report.maxRequests, 30)
  assert.equal(report.requestedModel, 'deepseek-v4-flash')
  const generated = report.cases.filter(record => record.scope === 'real-generation')
  assert.deepEqual(generated.map(record => record.id), input.ids)
  let attempts = 0
  for (const record of generated) {
    const label = `${record.id}/${input.variant}`
    assert.equal(record.passed, true, label)
    assert.equal(record.runStatus, 'SUCCEEDED', label)
    assert.equal(record.actualCode, 'SUCCESS', label)
    assert.equal(record.serverFactsCorrect, true, label)
    assert.equal(record.confirmationIdempotent, true, label)
    assert.ok(inRange(record.requestAttempts, 1, 4), label)
    assert.equal(record.requestAttempts, record.modelAttempts, label)
    assert.ok(inRange(record.toolCalls, 1, 8), label)
    assert.ok(Number.isSafeInteger(record.totalTokens) && record.totalTokens > 0, label)
    const scenario = scenarios.cases.find(candidate => candidate.id === record.id)
    assert.ok(scenario, label)
    const request = { ...scenarios.baseRequest, ...scenario.requestPatch }
    if (input.variant === 'multi-actions') request.allowedExerciseIds = ['squat', 'row', 'press']
    const { plan } = record
    assert.equal(plan.schemaVersion, 1, label)
    assert.equal(plan.templates.length, request.days, label)
    assert.equal(plan.estimatedMinutes.length, request.days, label)
    const actionIds = new Set()
    const daySignatures = new Set()
    const minutes = []
    let totalSets = 0
    for (const [index, template] of plan.templates.entries()) {
      assert.ok(typeof template.name === 'string' && template.name.trim().length > 0 && template.name.length <= 40, label)
      assert.ok(inRange(template.items.length, 1, 8), label)
      const seen = new Set()
      let seconds = 300
      const signature = []
      for (const item of template.items) {
        assert.ok(request.allowedExerciseIds.includes(item.exerciseId), label)
        assert.ok(!seen.has(item.exerciseId), label)
        seen.add(item.exerciseId); actionIds.add(item.exerciseId)
        assert.ok(inRange(item.defaultSets, 1, 6), label)
        assert.ok(inRange(item.defaultReps, 1, 30), label)
        assert.ok(inRange(item.restSeconds, 30, 300), label)
        seconds += item.defaultSets * 45 + (item.defaultSets - 1) * item.restSeconds + 60
        totalSets += item.defaultSets
        // Ignore action order and names when measuring exact prescription repetition.
        signature.push(JSON.stringify([item.exerciseId, item.defaultSets, item.defaultReps, item.restSeconds]))
      }
      const estimated = Math.ceil(seconds / 60)
      assert.equal(estimated, plan.estimatedMinutes[index], label)
      assert.ok(estimated <= request.minutes, label)
      minutes.push(estimated)
      daySignatures.add(JSON.stringify(signature.sort()))
    }
    attempts += record.requestAttempts
    results.push({
      id: record.id, variant: input.variant, constraintsPassed: true,
      days: request.days, allowedActions: request.allowedExerciseIds.length,
      selectedActions: actionIds.size, totalSets, uniqueDayPrescriptions: daySignatures.size,
      identicalDays: request.days > 1 ? daySignatures.size === 1 : null,
      estimatedMinutes: minutes, requestedMinuteCeiling: request.minutes,
      modelRequests: record.requestAttempts, toolCalls: record.toolCalls, reportedTokens: record.totalTokens,
    })
  }
  const rejected = report.cases.filter(record => record.scope === 'real-service-validation')
  if (input.variant === 'baseline') assert.deepEqual(rejected.map(record => record.id), ['A07', 'A08', 'A09', 'A10', 'A11', 'A12', 'A13', 'A14'])
  for (const record of rejected) {
    assert.equal(record.actualCode, 'INVALID_COACH_REQUEST')
    assert.equal(record.requestAttempts, 0)
    assert.equal(record.passed, true)
  }
  refused += rejected.length
  assert.equal(report.requestAttempts - previousCumulative, attempts, 'Cumulative requests must match report cases')
  previousCumulative = report.requestAttempts
}
assert.ok(previousCumulative <= 30)
const budget = Number(readFileSync(new URL('.cache/assistant-live-eval2-budget.txt', root), 'utf8').trim())
assert.equal(budget, previousCumulative, 'Budget changed; review newer reports before auditing these samples')
const review = {
  reviewedAt: new Date().toISOString(), source: 'archived-synthetic-live-reports', realModelRequestsAdded: 0,
  generatedTasks: results.length, rejectedBeforeModel: refused,
  cumulativeRequests: budget, remainingRequests: 30 - budget,
  tasksAtFourRequestLimit: results.filter(result => result.modelRequests === 4).length,
  reportedTokens: results.reduce((sum, result) => sum + result.reportedTokens, 0),
  qualityRating: 'NOT_ESTABLISHED',
  limitations: ['One sample per variant', 'No goals, experience or equipment preferences in current request',
    'No controlled personalization comparison', 'Coverage and repetition are descriptive, not quality scores',
    'Server evidence and confirmation flags originate in the live probe; this audit does not rerun them'],
  results,
}
const output = `.cache/assistant-quality-review-${randomUUID()}.json`
writeFileSync(new URL(output, root), JSON.stringify(review, null, 2) + '\n', { flag: 'wx' })
console.table(results.map(({ id, variant, days, allowedActions, selectedActions, uniqueDayPrescriptions, modelRequests }) =>
  ({ id, variant, days, actions: `${selectedActions}/${allowedActions}`, uniqueDayPrescriptions, modelRequests })))
console.log(`PASS: ${results.length} archived plans rechecked; ${refused} requests rejected before model; zero new model calls`)
console.log(`Request budget ${budget}/30; tasks at four-request limit ${review.tasksAtFourRequestLimit}/${results.length}`)
console.log(`Quality rating: ${review.qualityRating}; report ${output}`)
