/* HardMode — Hillclimb: what a walk across the day's world adds up to.
 *
 * Kept apart from the page because it is the only part of the game with rules
 * rather than pixels, and because it has to give the same answer twice: once
 * while the run is live, and again when the run is read back out of storage
 * the next time the page is opened.
 *
 * Nothing is stored but where the walk has been. Everything below is derived
 * from that and the world, so a restored run and a live one cannot drift
 * apart. */
import { H, LIVE, MOVES, TOUCH, idx, rowOf, colOf, wrapC, ladderValue } from "./hillclimb-world.ts";
import type { World } from "./hillclimb-world.ts";

export interface Run {
  path: number[];        // every square stopped on, starting at the drop
  stopped: boolean;      // the run is over and the whole map is shown
  seed: string;          // which drop on the day's planet this walk started from
}

export const newRun = (world: World, seed = ''): Run => ({ path: [world.spawn], stopped: false, seed });

/** Standing on a landmark, or within a couple of squares of it. See TOUCH:
 *  the tolerance is what makes every landmark landable-beside at this stride. */
export function touching(cells: Set<number>, stop: number): boolean {
  const r = rowOf(stop), c = colOf(stop);
  for (let dr = -TOUCH; dr <= TOUCH; dr++) {
    const rr = r + dr;
    if (rr < 0 || rr >= H) continue;
    for (let dc = -TOUCH; dc <= TOUCH; dc++) if (cells.has(idx(rr, wrapC(c + dc)))) return true;
  }
  return false;
}

/** The landmarks on offer right now: the first two of the day's pool that have
 *  not been collected. Reaching one lets the next take its place, so the choice
 *  is always between exactly two — and never between everything at once. */
export function livePair(world: World, had: Set<number>): number[] {
  const out: number[] = [];
  for (let g = 0; g < world.goals.length && out.length < LIVE; g++) if (!had.has(g)) out.push(g);
  return out;
}

/** Which landmarks the walk has collected, in the order it reached them.
 *  Only ones that were on offer at the time count — wandering across a
 *  landmark that has not come up yet is scenery, not a find. One stop standing
 *  where both live ones meet takes both, and the pair refills behind it. */
export function touchedOrder(world: World, path: number[]): number[] {
  const order: number[] = [];
  const had = new Set<number>();
  for (const stop of path) {
    for (;;) {
      const g = livePair(world, had).find(i => touching(world.goals[i].cells, stop));
      if (g === undefined) break;
      had.add(g);
      order.push(g);
    }
    if (had.size === world.goals.length) break;
  }
  return order;
}

/* What the bonuses are worth. The nth landmark reached pays n times the first,
   so four of them are worth forty and one is worth four: chasing the chain is
   the part of a day you actually choose, and it should pay like it. A biome is
   a flat point, picked up by going somewhere rather than by aiming at it. */
export const LANDMARK_POINT = 4;
export const BIOME_POINT = 1;

export interface RunState {
  found: number[];       // landmarks collected, in the order reached
  live: number[];        // the two now on offer
  complete: boolean;     // nothing left to find
  movesLeft: number;
  best: number;          // highest ground stood on, in metres
  peakShare: number;     // …as a fraction of the planet's true summit
  biomes: number[];      // checklist entries actually set foot in
  climb: number;         // 0–100: the day, as a percentage of the true summit
  landmarkBonus: number; // added on top
  biomeBonus: number;    // added on top
  score: number;         // climb + both bonuses
  grade: string;
}

export function runState(world: World, run: Run): RunState {
  const found = touchedOrder(world, run.path);
  const live = livePair(world, new Set(found));

  const best = run.path.reduce((high, i) => Math.max(high, world.metres[i]), 0);
  const peakShare = world.summitM > 0 ? best / world.summitM : 0;
  const walked = new Set(run.path.filter(i => world.land[i]).map(i => world.biome[i]));
  const biomes = world.checklist.filter(b => walked.has(b));

  /* The climb is the score: how high you stood, as a percentage of the true
     summit. The landmarks and the field notes are added on top of it — what
     you picked up on the way — so the arithmetic can be read off the card
     rather than being three weights nobody can see.

     Landmarks count out of what the budget was built to allow, not the whole
     pool: the pool runs deeper only so the pair on offer never thins to one,
     and a player who routes well enough to beat it simply tops that part out. */
  const climb = Math.round(100 * peakShare);
  const landmarkBonus = LANDMARK_POINT * ladderValue(Math.min(found.length, world.rungs));
  const biomeBonus = BIOME_POINT * biomes.length;
  const score = climb + landmarkBonus + biomeBonus;

  return {
    found, live,
    complete: live.length === 0,
    movesLeft: MOVES - (run.path.length - 1),
    best, peakShare, biomes,
    climb, landmarkBonus, biomeBonus, score,
    /* On a scale that runs past 100, because the summit and the landmarks are
       two different achievements and one day can hold both. S is for the day
       that does: it takes a real climb and most of the chain, and the budget
       will not stretch to both unless the route was very good indeed. */
    grade: score >= 115 ? "S" : score >= 90 ? "A" : score >= 55 ? "B" : score >= 30 ? "C" : "D",
  };
}
