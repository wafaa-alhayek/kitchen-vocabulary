# kitchen-vocabulary

The shared vocabulary between **Masroufi** (what food costs and when to buy it)
and **Zaytoun** (what food does to you nutritionally).

It is a file, not a service. Neither app imports the other, neither can call
the other at runtime, and neither owns this repository. Both vendor a copy.

That constraint isn't philosophical — it's physical. Masroufi is a server-side
Python app with a database. Zaytoun is an offline-first browser PWA whose whole
premise is working with no signal. There is no moment you can rely on one
reaching the other, so the coupling has to be compile-time.

---

## What it owns, and what it doesn't

| | owner |
|---|---|
| item slugs, units, purchase steps, shelf life, prices | **Masroufi** |
| as-eaten nutrient panels, targets, portions | **Zaytoun** |
| the join between them, and the yield factors | **this file** |

`vocabulary.json` deliberately does not duplicate names, Arabic labels,
purchase steps or shelf lives. Duplicated data drifts.

---

## The problem it exists to solve

Masroufi items are **raw purchases**. Zaytoun foods are **as-eaten states**.
Thirteen slugs already match by accident, and every one of them lies:

| slug | Masroufi means | Zaytoun means | factor |
|---|---|---|---|
| `rice` | dry, 365 kcal/100g | cooked, 130 | **2.8x** |
| `lentils` | dry, 352 | cooked, 116 | **3.0x** |
| `chickpeas` | dry, 378 | cooked, 164 | **2.3x** |
| `chicken` | raw, bone-in | roast, edible | **0.49x** |

`lentils` matches exactly *and* means a three-times-different quantity. A
shared slug with no state qualifier is worse than no shared slug at all,
because it fails silently and in the expensive direction.

So every item carries `state`, `edible_fraction` and `cooked_yield`, and the
panel is expressed **per 100 g of the thing you buy**, with bone, shell and
peel already discounted — because that is the number you divide a per-kilo
price by.

    zaytoun_per_100g  ~=  per_100g_as_purchased / (edible_fraction * cooked_yield)

`check` says how hard that invariant is enforced:

- **`strict`** (±8%) — grains and pulses, where only water moves and nutrients
  are genuinely conserved.
- **`loose`** (±25%, protein only) — meat and fish, where fat renders out and
  energy is not a reliable tracer.
- **`none`** — the two apps are describing different things, or one has no
  counterpart. Stated, not hidden.

---

## Dish scope — the trap

Masroufi dishes are whole **meals** and carry the rice or bread served
alongside. Zaytoun dishes are the named dish **alone**, with accompaniments
logged separately.

Compare them without correcting for that and Masroufi looks 100–270% higher for
the same food. It isn't; it's counting the rice. `serves_with` lists the
accompaniment ingredients so a consumer can subtract them.

---

## Using it

```bash
npm --version                 # anything with Node 16+
node validate.mjs             # checks the join against both repos
node reconcile.mjs            # compares the two dish libraries
```

Both take `ZAYTOUN` and `MASROUFI` env vars pointing at the two checkouts;
they default to `../zaytoun` and `../masroufi`.

`validate.mjs` checks three things in order of how badly they'd hurt:

1. **coverage** — every Masroufi item has a mapping. A missing slug means a
   shopping list silently loses a nutrient.
2. **references** — every `zaytoun_food_id` exists. A typo points the optimiser
   at nothing.
3. **the invariant** — catches a wrong yield factor, which is the error that
   makes a plan buy three times too much.

Run it in both repos' CI. A vocabulary that isn't checked is a vocabulary that
has already drifted.

---

## What it found on first run

Two bugs in its own data, caught by the validator and fixed:

- `fava_beans → foul` failed at 26%. Zaytoun's `foul` is the *dressed* dish
  with oil and lemon, which dilutes protein per 100 g. Downgraded to `none`
  rather than widening the tolerance to hide it.
- Two spices tripped the energy sanity check because a flat Atwater 4-4-9
  overstates energy for high-fibre foods. Fibre sits inside the carbohydrate
  figure but yields ~2 kcal/g. The check now accounts for it.

And one finding in Masroufi worth acting on:

> After correcting for dish scope, **Masroufi's per-adult quantities read ~52%
> higher than Zaytoun's portions, on all eight comparable dishes, without a
> single exception.**

A one-directional bias across every dish is not two datasets disagreeing at
random. `dishes.py` predicts it in its own docstring: the quantities were "set
by a developer, not a cook", and an overstated one "becomes money wasted".

Also: Masroufi's `bamia_vegetarian` contained no okra. It was lentils, rice,
carrot and potato, and has since been renamed `lentil_vegetable_stew`.

---

## Adding an item

1. Add it to Masroufi first — Masroufi owns item slugs. That is either the
   hand-written `CATALOGUE` in `app/kitchen/catalogue.py` or a row in one of the
   researched `data/raw/*_items.csv` files.
2. Add an entry here with `state`, `edible_fraction`, `cooked_yield` and a
   waste-discounted panel.
3. If Zaytoun has an as-eaten counterpart, set `zaytoun_food_id` and pick a
   `check` you can defend. If it doesn't, leave it `null` and say so in `note`.
4. Run `validate.mjs`. If a `strict` check fails, the yield factor is wrong —
   fix the factor, don't downgrade the check.

### Panels: where the numbers come from

Zaytoun's single-ingredient foods track USDA FoodData Central and the FAO/WHO
West Asia tables, so the panels here do too. Where an entry is derived from
Zaytoun's own panel, scaled by the edible or drained fraction, the invariant
holds by construction: its job there is to catch a later edit to either side,
not to prove the first number. Sumac is in no table, so its panel is an
estimate and says so.

### The researched catalogue is the backlog

Masroufi now seeds 321 more items from `data/raw/`. None has an entry here yet.
`validate.mjs` reports that as one warning rather than 321 failures, so CI stays
a signal about regressions; the hand-written catalogue must still be covered in
full. Work through it group by group, staples first.

### Known gaps worth filling

`carrot`, `pepper`, `parsley`, `mint`, `lemon`, `garlic` and `tomato_paste`
have no Zaytoun counterpart. Carrot and parsley matter most: carrot is the
cheapest vitamin A here, and parsley alongside pulses measurably improves iron
absorption — which, given anaemia prevalence, is the highest-value thing in
this catalogue that currently has no nutrition entry at all.

Nothing here gels in water. Chia, basil seed (حب الريحان) and psyllium
(قاطونة) are all absent, and are the cheapest satiety per calorie available.

## License

MIT. See [LICENSE](LICENSE).
