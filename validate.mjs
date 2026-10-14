// ---------------------------------------------------------------------------
// Validates the shared vocabulary against both repositories.
//
//   node validate.mjs
//   ZAYTOUN=../zaytoun MASROUFI=../masroufi node validate.mjs
//
// It checks three things, in order of how badly they would hurt:
//
//   1. COVERAGE  — every Masroufi item has a mapping and vice versa. A missing
//      slug means a shopping list silently loses a nutrient.
//   2. REFERENCE — every zaytoun_food_id actually exists. A typo here points
//      the optimiser at nothing.
//   3. INVARIANT — per_100g_as_purchased / (edible * cooked_yield) matches
//      Zaytoun's as-eaten panel. This is the one that catches a wrong yield
//      factor, which is the error that makes a plan buy three times too much.
//
// Strictness is per-item and deliberate: 'strict' only where nutrients are
// genuinely conserved and water is the only thing moving.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync, readdirSync } from 'node:fs'

const VOCAB = JSON.parse(readFileSync(new URL('./vocabulary.json', import.meta.url), 'utf8'))
const ZAYTOUN = process.env.ZAYTOUN ?? '../zaytoun'
const MASROUFI = process.env.MASROUFI ?? '../masroufi'

const TOL = { strict: 0.08, loose: 0.25 }

let fail = 0
let warn = 0
const problem = (m) => { fail++; console.log(`  FAIL  ${m}`) }
const caution = (m) => { warn++; console.log(`  WARN  ${m}`) }

// --- read the two repositories ---------------------------------------------

function zaytounFoods() {
  const p = `${ZAYTOUN}/src/data/foods.ts`
  if (!existsSync(p)) return null
  const src = readFileSync(p, 'utf8')
  const out = new Map()
  // food('<id>', '<name>', '<ar>', '<group>', [kcal, protein, carbs, fat, fiber, sodium?], ...
  const re = /food\('([a-z0-9-]+)'[\s\S]*?\[\s*([\d.,\s-]+?)\]/g
  let m
  while ((m = re.exec(src))) {
    const n = m[2].split(',').map((x) => parseFloat(x.trim()))
    out.set(m[1], { kcal: n[0], protein: n[1], carbs: n[2], fat: n[3], fiber: n[4] })
  }
  return out
}

function masroufiSlugs() {
  const p = `${MASROUFI}/app/kitchen/catalogue.py`
  if (!existsSync(p)) return null
  const src = readFileSync(p, 'utf8')
  return new Set([...src.matchAll(/^\s+\("([a-z_]+)"/gm)].map((m) => m[1]))
}

// The researched catalogue: data/raw/*_items.csv, seeded alongside the
// hand-written one. Slugs are the first column; RAW_SLUG_ALIASES in
// catalogue.py folds a few of them into hand-written items.
function masroufiResearched() {
  const dir = `${MASROUFI}/data/raw`
  if (!existsSync(dir)) return new Set()
  const aliases = new Map()
  const cat = readFileSync(`${MASROUFI}/app/kitchen/catalogue.py`, 'utf8')
  const block = cat.match(/RAW_SLUG_ALIASES[^{]*\{([^}]*)\}/)
  if (block) for (const m of block[1].matchAll(/"([a-z_]+)":\s*"([a-z_]+)"/g)) aliases.set(m[1], m[2])
  const out = new Set()
  for (const f of readdirSync(dir).filter((f) => f.endsWith('_items.csv'))) {
    const lines = readFileSync(`${dir}/${f}`, 'utf8').split(/\r?\n/).slice(1)
    for (const line of lines) {
      const slug = line.split(',')[0]
      if (slug) out.add(aliases.get(slug) ?? slug)
    }
  }
  return out
}

function masroufiDishes() {
  const p = `${MASROUFI}/app/kitchen/dishes.py`
  if (!existsSync(p)) return null
  const src = readFileSync(p, 'utf8')
  return new Set([...src.matchAll(/"slug":\s*"([a-z_]+)"/g)].map((m) => m[1]))
}

const foods = zaytounFoods()
const mItems = masroufiSlugs()
const mDishes = masroufiDishes()
const mResearched = mItems ? masroufiResearched() : new Set()

console.log(`vocabulary ${VOCAB.version} — ${VOCAB.items.length} items, ${VOCAB.dishes.length} dishes`)
console.log(`zaytoun:  ${foods ? foods.size + ' foods' : 'NOT FOUND at ' + ZAYTOUN}`)
console.log(`masroufi: ${mItems ? mItems.size + ' items, ' + mDishes.size + ' dishes' : 'NOT FOUND at ' + MASROUFI}` +
  (mResearched.size ? `, plus ${[...mResearched].filter((s) => !mItems.has(s)).length} researched items in data/raw` : ''))

// --- 1. coverage ------------------------------------------------------------

console.log('\ncoverage')
const vSlugs = new Set(VOCAB.items.map((i) => i.slug))
if (mItems) {
  for (const s of mItems) if (!vSlugs.has(s)) problem(`Masroufi item "${s}" has no entry in the vocabulary`)
  for (const s of vSlugs) if (!mItems.has(s) && !mResearched.has(s)) problem(`vocabulary item "${s}" is not in Masroufi's catalogue`)
  // The hand-written catalogue must be covered in full. The researched one is
  // being worked through: its gap is reported, not failed, so CI stays a signal
  // about regressions rather than about a backlog everyone already knows of.
  const backlog = [...mResearched].filter((s) => !mItems.has(s) && !vSlugs.has(s))
  if (backlog.length) {
    caution(`${backlog.length} researched Masroufi items have no vocabulary entry yet (e.g. ${backlog.slice(0, 5).join(', ')})`)
  }
}
if (mDishes) {
  const vDishes = new Set(VOCAB.dishes.map((d) => d.masroufi))
  for (const s of mDishes) if (!vDishes.has(s)) problem(`Masroufi dish "${s}" has no alias entry`)
}
if (!fail) console.log('  ok' + (warn ? ' for the hand-written catalogue' : ''))

// --- 2. references ----------------------------------------------------------

console.log('\nreferences')
let refErrors = 0
if (foods) {
  for (const it of VOCAB.items) {
    if (it.zaytoun_food_id && !foods.has(it.zaytoun_food_id)) {
      problem(`"${it.slug}" points at Zaytoun food "${it.zaytoun_food_id}", which does not exist`)
      refErrors++
    }
  }
  for (const d of VOCAB.dishes) {
    if (d.zaytoun && !foods.has(d.zaytoun)) {
      problem(`dish "${d.masroufi}" points at Zaytoun food "${d.zaytoun}", which does not exist`)
      refErrors++
    }
  }
}
if (!refErrors) console.log('  ok')

// --- 3. the invariant -------------------------------------------------------

console.log('\ninvariant  (as_purchased / (edible x cooked_yield)  vs  Zaytoun as-eaten)')
let checked = 0
if (foods) {
  for (const it of VOCAB.items) {
    if (it.check === 'none' || !it.zaytoun_food_id) continue
    const z = foods.get(it.zaytoun_food_id)
    if (!z) continue
    const divisor = it.edible_fraction * it.cooked_yield
    const tol = TOL[it.check]
    checked++

    // 'strict' tests energy, which only holds where nutrients are conserved.
    // 'loose' tests protein alone, because fat renders out of meat and water
    // leaves unevenly, so energy is not a reliable tracer there.
    const field = it.check === 'strict' ? 'kcal' : 'protein'
    const derived = it.per_100g_as_purchased[field] / divisor
    const actual = z[field]
    if (!actual) continue
    const off = Math.abs(derived - actual) / actual
    if (off > tol) {
      problem(
        `${it.slug} -> ${it.zaytoun_food_id}: derived ${field} ${derived.toFixed(1)} vs Zaytoun ${actual} ` +
        `(${(off * 100).toFixed(0)}% off, ${it.check} tolerance ${(tol * 100).toFixed(0)}%)`,
      )
    }
  }
}
console.log(`  ${checked} joins checked`)

// --- 4. internal sanity -----------------------------------------------------

console.log('\ninternal sanity')
for (const it of VOCAB.items) {
  const n = it.per_100g_as_purchased
  // Fibre sits inside the carbohydrate figure but yields about 2 kcal/g, not 4.
  // A flat Atwater 4-4-9 therefore overstates energy badly for spices and pulses,
  // which is a property of the formula, not an error in the panel.
  const digestible = Math.max(0, n.carbs - n.fiber)
  const derived = n.protein * 4 + digestible * 4 + n.fiber * 2 + n.fat * 9
  // Skip items whose energy is genuinely not from macros (salt, tea, coffee).
  if (n.kcal > 20 && Math.abs(derived - n.kcal) / n.kcal > 0.25) {
    caution(`${it.slug}: macros imply ${derived.toFixed(0)} kcal but panel says ${n.kcal}`)
  }
  if (it.cooked_yield <= 0 || it.edible_fraction <= 0 || it.edible_fraction > 1) {
    problem(`${it.slug}: edible_fraction or cooked_yield out of range`)
  }
  if (!['strict', 'loose', 'none'].includes(it.check)) problem(`${it.slug}: unknown check "${it.check}"`)
}

console.log(`\n${fail} failures, ${warn} warnings`)
process.exit(fail ? 1 : 0)
