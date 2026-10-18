# kitchen-vocabulary

The join between Masroufi (what food costs) and Zaytoun (what food does to you).
A file, not a service: both apps vendor a copy of `vocabulary.json`. The README
explains why, and what each field means.

Check it against both apps before every pull request:

```bash
ZAYTOUN=../zaytoun MASROUFI=../masroufi node validate.mjs   # must exit 0
ZAYTOUN=../zaytoun MASROUFI=../masroufi node reconcile.mjs
```

## Who owns what

| repo | owns |
|---|---|
| [masroufi](https://github.com/wafaa-alhayek/masroufi) | item and dish slugs, units, shelf life, purchase steps, prices |
| **kitchen-vocabulary** (this one) | the join and the yield factors |
| [Zaytoun](https://github.com/wafaa-alhayek/Zaytoun) | as-eaten nutrient panels and portions |

- Never invent a slug here. If Masroufi does not have it yet, it goes into
  Masroufi first.
- A failing `strict` check means the yield factor is wrong. Fix the factor; do
  not downgrade the check to make it pass.
- Say where a panel comes from in its `note` when it is not obvious, and label
  an estimate as one.

## When `vocabulary.json` changes

Both apps hold a byte-for-byte copy, and their CI diffs it against `main` here.
After a change merges, refresh both copies in their own pull requests:

- Masroufi: `app/kitchen/vocabulary.json`
- Zaytoun: `src/data/vocabulary.json`

A slug rename merges in this order: Masroufi, then this repo, then the two
copies. The other way round, the validator fails in between.

## Working alongside other Claude sessions

More than one session works on these repos at once, so:

- Start every task from a fresh `origin/main`, on a new branch.
- Never push to a branch you did not create, and never commit straight to `main`.
- One change per pull request. Its description names anything it depends on and
  the order to merge in.
- Do not merge pull requests. The owner reviews and merges.
- If `main` moved under you and conflicts, keep what is on `main` unless it is
  plainly wrong, and say what you dropped.

CI needs a `CROSS_REPO_TOKEN` secret with read access to the private Zaytoun repo.
