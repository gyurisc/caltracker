---
name: cal-add-food
description: Use when adding a food, alias, or portion word to the caltrack parser — any request like "add pancake", "the bot refuses X", "log Y but it says not in the local table", or when working through the /cal-misses backlog. Covers the FOOD_TABLE row, the residual() strip list, tests, and the bot restart.
---

# Adding a food to the parser

The parser refuses a whole message when any word in a chunk is unrecognized. That is
deliberate — a silent undercount that looks like success is the worst failure this app
has. So growing the vocabulary is the normal way to fix a refusal, and it must be done
in full or new words start refusing valid messages.

Work through these in order. Do not skip the test or the restart.

## 1. Find what actually refused

Run `npx tsx src/misses.ts` (or `/cal-misses`). Every refusal is already recorded as a
`parse_miss` event with the exact phrase. Use it rather than guessing — the tally shows
which foods are worth adding first.

## 2. Choose the basis

- **`each`** — countable things nobody weighs: eggs, bananas, pancakes, a cup of coffee,
  a scoop of whey. Set `unitGrams` (the weight of one) and optionally `unitNoun`.
  Macros are **per unit**, not per 100 g.
- **`per100g`** — anything weighed or served by volume: meat, rice, yogurt, oil. Set
  `defaultGrams` for a typical serving. Macros are **per 100 g**.

Getting this wrong is silent: an `each` row with per-100g macros logs ~2.5× the calories.

## 3. Never write kcal

Supply `proteinG`, `carbsG`, `fatG` only. `deriveKcal()` applies 4/4/9. The single
exception is trace calories no macro accounts for — brewed coffee is 2 kcal where 4/4/9
gives 1 — and that is the only row in the table carrying an explicit `kcal`. If a source
disagrees with 4/4/9, trust the macros, not the source.

## 4. Raw vs cooked

Set `defaultState` to whichever the user usually means. Give `cooked` macros whenever
cooking concentrates them (meat loses water; 100 g raw chicken is not 100 g cooked). If
the food is never cooked, `raw` alone is enough. `eggs` carries identical blocks — that
is fine when weight does not change.

## 5. Add the row

In `SEED_FOODS` (`src/foods.ts`), near similar foods. The live vocabulary is the
`vocab` table in SQLite; `src/foods.ts` only seeds a fresh database, so after editing
it run **`pnpm vocab:sync`** to upsert the change into the running table. Skipping the
sync is the new silent failure: tests pass, the bot still refuses. List aliases **plural first**
where both exist — `ALIAS_INDEX` sorts longest-first, so `pancakes` must be able to win
over `pancake`. Add a one-line comment naming the source or portion assumption.

Only add aliases the user actually wants. An alias for a food they will not type is
vocabulary that can collide with a future row.

## 6. Decide whether `residual()` needs anything

**A plain food name needs no change here** — `findMatches()` consumes matched aliases
before `residual()` runs. Verify rather than assume.

The strip list matters only for **new modifier words**:

- a new portion noun (`tub`, `glug`) → `GENERIC_PORTIONS` or the entry's own `portions`,
  and `PORTION_WORDS` if it is not a key in the generic table
- a new adjective → `NOISE_WORDS`, **but only if it changes no row's macros**

`fat free`, `skimmed`, and `low fat` are deliberately absent from `NOISE_WORDS` so they
refuse instead of logging against the wrong row. Never silence such a refusal with a
noise word — add a table row instead.

## 7. Test

Add cases to `src/parse.test.ts`:

- the singular, the plural, and a count (`3 pancakes` → 3 × `unitGrams`)
- the derived kcal, as a number
- a **refusal test** for any variant deliberately left out, so the exclusion is
  documented behavior rather than an accident

Then run both — `pnpm test` does not typecheck:

```
pnpm test && pnpm typecheck
```

## 8. Smoke-test the real parser

```
npx tsx -e "
import { parseMessage } from './src/parse.ts'
for (const m of ['pancake','2 pancakes','pancake and 2 eggs']) {
  const r = parseMessage(m, new Date())
  console.log(m, r.ok ? r.items.map(i=>\`\${i.name} \${i.grams}g \${i.kcal}kcal\`) : 'REFUSED')
}"
```

Check a **combination** with an existing food, not just the new word alone. Two real bugs
came from a new food stealing a neighbour's weight.

## 9. Restart only if you changed code

The vocabulary lives in SQLite and the cache is invalidated on write, so a row added
through `saveFood()` is live on the next message — **no restart**. A restart is only
needed when you changed `.ts` files, including `src/foods.ts`:

```
pnpm serve:restart
```

Never `pnpm restart` — npm owns that name and runs stop → restart → start, which starts
a second server on top of the first.

## 10. Commit

Straight to `main` — this project does not use feature branches.
