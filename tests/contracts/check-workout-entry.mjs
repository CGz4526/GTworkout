import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const module = { exports: {} }
const code = ts.transpileModule(readFileSync(new URL('../../src/lib/workoutEntry.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
vm.runInNewContext(code, { module, exports: module.exports })
const { editSetWeight, appendWorkoutSet, removeWorkoutSet, keyboardWeightPreferred } = module.exports
const make = sets => ({ id: 'exercise-stable', exerciseId: 'barbell', exerciseName: '杠铃卧推', sets })
const source = make([
  { id: 'warm', warmup: true, reps: 10, completed: false },
  { id: 'work1', reps: 10, completed: false },
  { id: 'work2', weight: 50, reps: 8, completed: false },
  { id: 'work3', reps: 8, completed: false },
  { id: 'done', reps: 8, completed: true },
])
const changed = editSetWeight(source, 0, 20)
assert.deepEqual(Array.from(changed.sets, s => s.weight), [20, 20, 50, 50, undefined])
assert.deepEqual(Array.from(source.sets, s => s.weight), [undefined, undefined, 50, undefined, undefined])
assert.deepEqual(Array.from(changed.sets, s => s.id), ['warm', 'work1', 'work2', 'work3', 'done'])
assert.equal(editSetWeight(changed, 2, undefined).sets[3].weight, 50)
assert.equal(editSetWeight(source, 2, 0).sets[3].weight, 0)
assert.equal(editSetWeight(source, 2, 30).sets[1].weight, undefined)
console.log('PASS: forward-only inheritance preserves explicit weights, zero, completed blanks and stable IDs')

const extraWarmup = appendWorkoutSet(changed, true)
assert.deepEqual(Array.from(extraWarmup.sets.slice(0, 3), s => !!s.warmup), [true, true, false])
assert.equal(extraWarmup.sets[1].weight, 20)
assert.equal(extraWarmup.sets[2].id, 'work1')
const extraWork = appendWorkoutSet(changed, false)
assert.equal(extraWork.sets.at(-1).weight, 50)
assert.equal(extraWork.sets.at(-1).warmup, undefined)
const noWarmups = make([{ weight: 80, reps: 5, completed: false }])
assert.equal(appendWorkoutSet(noWarmups, true).sets[0].weight, undefined, 'never inherit backward from a later heavy working set')
assert.equal(removeWorkoutSet(extraWarmup, 1).sets[1].id, 'work1')
assert.equal(removeWorkoutSet(extraWarmup, 1).sets[0].id, 'warm')
console.log('PASS: warmups precede working sets; addition/removal preserves recorded rows and appropriate inheritance')

for (const name of ['杠铃卧推', '哑铃弯举', '深蹲', '罗马尼亚硬拉', '壶铃摆动', 'Dumbbell row']) assert.equal(keyboardWeightPreferred(name), true)
for (const name of ['绳索下压', '坐姿划船', '卷腹', '史密斯深蹲', '器械卧推']) assert.equal(keyboardWeightPreferred(name), false)
console.log('PASS: free-weight names prefer keyboard; other controls keep wheel defaults')
