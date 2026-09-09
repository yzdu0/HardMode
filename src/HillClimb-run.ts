/* HardMode — HillClimb: what a walk across the day's world adds up to.
 *
 * Kept apart from the page because it is the only part of the game with rules
 * rather than pixels, and because it has to give the same answer twice: once
 * while the run is live, and again when the run is read back out of storage
 * the next time the page is opened.
 *
 * Nothing is stored but where the walk has been. Everything below is derived
 * from that and the world, so a restored run and a live one cannot drift
 * apart. */
import { LIVE, MOVES, ladderValue, touching } from "./HillClimb-world.ts";
import type { World } from "./HillClimb-world.ts";

export interface Run {
  path: number[];        // every square stopped on, starting at the drop
  stopped: boolean;      // the run is over and the whole map is shown
  seed: string;          // which drop on the day's planet this walk started from
}

export const newRun = (world: World, seed = ''): Run => ({ path: [world.spawn], stopped: false, seed });

// Standing on a landmark, or within a couple of squares of it, lives beside
// the world: the generator has to reason about it too when it works out
// whether a day's chain can be walked at all.
export { touching };

/** The landmarks on offer right now: the first two of the day's pool that have
 *  not been collected. Reaching one lets the next take its place, so the choice
 *  is always between exactly two — and never between everything at once. */
export function livePair(world: World, had: Set<number>): number[] {
  const out: number[] = [];
  for (let g = 0; g < world.goals.length && out.length < LIVE; g++) if (!had.has(g)) out.push(g);
  return out;
}

/** Which landmarks the walk has collected, in the order they unlock.
 *  A landmark first counts only while it is on offer. Once it comes up, though,
 *  any earlier stop beside it counts immediately: the player has already done
 *  the exploring. One find can therefore refill the pair and instantly collect
 *  a newly unlocked landmark from the ground already covered. */
export function touchedOrder(world: World, path: number[]): number[] {
  const order: number[] = [];
  const had = new Set<number>();
  const visited: number[] = [];
  for (const stop of path) {
    visited.push(stop);
    for (;;) {
      const g = livePair(world, had).find(i => visited.some(at => touching(world.goals[i].cells, at)));
      if (g === undefined) break;
      had.add(g);
      order.push(g);
    }
    if (had.size === world.goals.length) break;
  }
  return order;
}

/* What the bonuses are worth. The nth landmark reached pays n times the first:
   chasing the chain is the part of a day you actually choose, and it should
   pay like it. */
export const LANDMARK_POINT = 3;

export interface RunState {
  found: number[];       // landmarks collected, in the order reached
  live: number[];        // the two now on offer
  complete: boolean;     // nothing left to find
  movesLeft: number;
  best: number;          // highest ground stood on, in metres
  peakShare: number;     // …as a fraction of the planet's true summit
  climb: number;         // 0–100: the day, as a percentage of the true summit
  landmarkBonus: number; // added on top
  score: number;         // climb + landmark bonus
  grade: string;
}

export function runState(world: World, run: Run): RunState {
  const found = touchedOrder(world, run.path);
  const live = livePair(world, new Set(found));

  const best = run.path.reduce((high, i) => Math.max(high, world.metres[i]), 0);
  const peakShare = world.summitM > 0 ? best / world.summitM : 0;
  /* The climb is the score: how high you stood, as a percentage of the true
     summit. The landmarks are added on top of it — what you picked up on the
     way — so the arithmetic can be read off the card.

     Every landmark in the day's pool counts. The pool runs past what the
     obvious route can reach, so an unusually efficient walk is rewarded rather
     than silently capped. */
  const climb = Math.round(100 * peakShare);
  const landmarkBonus = LANDMARK_POINT * ladderValue(found.length);
  const score = climb + landmarkBonus;

  return {
    found, live,
    complete: live.length === 0,
    movesLeft: MOVES - (run.path.length - 1),
    best, peakShare,
    climb, landmarkBonus, score,
    /* On a scale that runs past 100, because the summit and the landmarks are
       two different achievements and one day can hold both. S is for the day
       that does: it takes a real climb and most of the chain, and the budget
       will not stretch to both unless the route was very good indeed. */
    grade: score >= 115 ? "S" : score >= 90 ? "A" : score >= 55 ? "B" : score >= 30 ? "C" : "D",
  };
}
