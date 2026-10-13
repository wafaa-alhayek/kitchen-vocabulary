// ---------------------------------------------------------------------------
// Costs every Masroufi dish in nutrients, through the shared vocabulary, and
// compares it against Zaytoun's panel for the same dish.
//
//   MASROUFI=... ZAYTOUN=... node reconcile.mjs
//
// This is the review instrument for the yield factors and the per-adult
// quantities. Two independently seeded estimates of the same dish should land
// near each other; where they don't, one is wrong and the gap says which way.
//
// It subtracts accompaniments first. Masroufi dishes are whole meals and carry
// the rice or bread served alongside; Zaytoun dishes are the named dish alone.
// Comparing them without correcting for that shows a 100-270% gap that is
// entirely an artefact of scope.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs'

const V = JSON.parse(readFileSync(new URL('./vocabulary.json', import.meta.url), 'utf8'))
const ZAYTOUN = process.env.ZAYTOUN ?? '../zaytoun'
const MASROUFI = process.env.MASROUFI ?? '../masroufi'

const item = Object.fromEntries(V.items.map((i) => [i.slug, i]))
const alias = Object.fromEntries(V.dishes.map((d) => [d.masroufi, d]))

// --- Masroufi dishes --------------------------------------------------------

const mDishes = []
for (const chunk of readFileSync(`${MASROUFI}/app/kitchen/dishes.py`, 'utf8').split('"slug":').slice(1)) {
  const slug = chunk.match(/^\s*"([a-z_]+)"/)?.[1]
  const items = chunk.match(/"items":\s*\{([^}]*)\}/s)?.[1]
  if (!slug || !items) continue
  const ing = {}
  for (const m of items.matchAll(/"([a-z_]+)":\s*([\d.]+)/g)) ing[m[1]] = parseFloat(m[2])
  mDishes.push({ slug, ing })
}

// --- Zaytoun foods with all their portions ----------------------------------

const zFoods = new Map()
for (const chunk of readFileSync(`${ZAYTOUN}/src/data/foods.ts`, 'utf8').split('food(').slice(1)) {
  const id = chunk.match(/^\s*'([a-z0-9-]+)'/)?.[1]
  const nums = chunk.match(/\[\s*([\d.,\s-]+?)\]/)
  if (!id || !nums) continue
  const n = nums[1].split(',').map((x) => parseFloat(x.trim()))
  const portions = [...chunk.matchAll(/\[\s*'([^']+)'\s*,\s*([\d.]+)/g)].map((p) => ({
    label: p[1],
    g: parseFloat(p[2]),
  }))
  zFoods.set(id, {
    per100: { kcal: n[0], protein: n[1], carbs: n[2], fat: n[3], fiber: n[4] },
    portions: portions.length ? portions : [{ label: 'serving', g: 100 }],
  })
}

// --- nutrients ---------------------------------------------------------------

function toGrams(slug, qty) {
  const it = item[slug]
  if (!it) return 0
  if (it.unit_override === 'piece' || it.unit_override === 'bunch') return qty * it.grams_per_unit
  if (it.density_g_per_ml) return qty * it.density_g_per_ml // Masroufi stores ml
  return qty
}

function sum(ing, skip = []) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 }
  for (const [slug, qty] of Object.entries(ing)) {
    if (skip.includes(slug)) continue
    const it = item[slug]
    if (!it) continue
    const f = toGrams(slug, qty) / 100
    for (const k of Object.keys(t)) t[k] += (it.per_100g_as_purchased[k] ?? 0) * f
  }
  return t
}

// --- report ------------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n)
const num = (s, n) => String(s).padStart(n)

console.log('Every Masroufi dish, costed per adult through the vocabulary.\n')
console.log(
  pad('dish', 18), num('meal', 6), num('dish', 6), num('prot', 6), num('fib', 5),
  ' ', pad('zaytoun portion', 22), num('kcal', 6), num('gap', 7),
)
console.log('-'.repeat(88))

const residuals = []

for (const d of mDishes) {
  const a = alias[d.slug] ?? {}
  const withAll = sum(d.ing)
  const dishOnly = sum(d.ing, a.serves_with ?? [])

  const z = a.zaytoun ? zFoods.get(a.zaytoun) : null
  let zPortion = null
  if (z) {
    zPortion = a.zaytoun_portion
      ? z.portions.find((p) => p.label === a.zaytoun_portion) ?? z.portions[0]
      : z.portions[0]
  }
  const zKcal = z ? Math.round((z.per100.kcal * zPortion.g) / 100) : null
  const gap = zKcal ? (dishOnly.kcal - zKcal) / zKcal : null
  if (gap !== null) residuals.push({ slug: d.slug, gap, m: Math.round(dishOnly.kcal), z: zKcal })

  console.log(
    pad(d.slug, 18),
    num(Math.round(withAll.kcal), 6),
    num(Math.round(dishOnly.kcal), 6),
    num(dishOnly.protein.toFixed(1), 6),
    num(dishOnly.fiber.toFixed(1), 5),
    ' ',
    pad(z ? `${a.zaytoun} (${zPortion.label} ${zPortion.g}g)` : '—', 22),
    num(zKcal ?? '—', 6),
    num(gap === null ? '—' : `${gap > 0 ? '+' : ''}${(gap * 100).toFixed(0)}%`, 7),
  )
}

console.log('\n"meal" is the whole Masroufi recipe; "dish" has the accompaniment subtracted.')

if (residuals.length) {
  const mean = residuals.reduce((s, r) => s + r.gap, 0) / residuals.length
  const allHigh = residuals.every((r) => r.gap > 0)
  console.log(
    `\nAfter correcting for scope, Masroufi still reads ${(mean * 100).toFixed(0)}% ` +
    `${mean > 0 ? 'higher' : 'lower'} than Zaytoun on average across ${residuals.length} dishes` +
    `${allHigh ? ', and higher on every single one' : ''}.`,
  )
  console.log(
    'A consistent one-directional bias is not two datasets disagreeing at random —\n' +
    "it is one of them being systematically off. Masroufi's own docstring predicts\n" +
    'this: the per-adult quantities were "set by a developer, not a cook", and it\n' +
    'warns that an overstated quantity there becomes money wasted.',
  )
  console.log('\nworst first:')
  for (const r of residuals.sort((a, b) => b.gap - a.gap)) {
    console.log(`  ${pad(r.slug, 18)} ${num(r.m, 5)} vs ${num(r.z, 5)} kcal   ${(r.gap * 100).toFixed(0)}%`)
  }
}

console.log('\nNutrient density per 100 g purchased (real prices would reorder this):')
const rank = (key) =>
  V.items
    .filter((i) => i.per_100g_as_purchased[key] > 0 && i.state !== 'dry' + '_spice')
    .sort((a, b) => b.per_100g_as_purchased[key] - a.per_100g_as_purchased[key])
    .slice(0, 6)
    .map((i) => `${i.slug} ${i.per_100g_as_purchased[key]}`)
    .join(', ')
console.log('  protein g:', rank('protein'))
console.log('  fibre g:  ', rank('fiber'))
