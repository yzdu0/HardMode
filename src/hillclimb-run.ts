/* HardMode — Hillclimb: what a walk across the day's world adds up to.
 *
 * Kept apart from the page because it is the only part of the game with rules
 * rather than pixels, and because it has to give the same answer twice: once
 * while the run is live, and again when the run is read back out of storage
 * the next time the page is opened.
 *
 * Only three things are ever stored — where the walk has been, whether the
 * player has banked, and how many times they have pressed on. Everything else
 * below is derived from those and the world, so a restored run and a live one
 * cannot drift apart. */
import { H, LIVE, MOVES, TOUCH, idx, rowOf, colOf, wrapC, ladderValue } from "./hillclimb-world.ts";
import type { World } from "./hillclimb-world.ts";

export interface Run {
  path: number[];        // every square stopped on, starting at the drop
  banked: boolean;       // no more landmarks wanted; what is reached is kept
  pressedOn: number;     // times the player took another one on
  stopped: boolean;      // the run is over and the whole map is shown
}

export const newRun = (world: World): Run => ({ path: [world.spawn], banked: false, pressedOn: 0, stopped: false });

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

export interface RunState {
  found: number[];       // landmark indices credited, in the order reached
  live: number[];        // the two now on offer
  reached: number;       // how many, capped at the number taken on
  kept: number;          // what survives the strike
  awaiting: boolean;     // a landmark is reached and the choice is unanswered
  struck: boolean;       // the run ended while still hunting one that was taken on
  complete: boolean;     // every landmark on the day's list
  movesLeft: number;
  best: number;          // highest ground stood on, in metres
  peakShare: number;     // …as a fraction of the planet's true summit
  biomes: number[];      // checklist entries actually set foot in
  score: number;         // 0–100
  grade: string;
}

export function runState(world: World, run: Run): RunState {
  // A landmark only counts if it was taken on: banking, or simply not pressing
  // on, closes the list at what is already in hand.
  const order = touchedOrder(world, run.path);
  const reached = Math.min(order.length, run.pressedOn + 1);
  const credited = order.slice(0, reached);
  const live = livePair(world, new Set(credited));
  const awaiting = !run.stopped && !run.banked && reached > run.pressedOn && live.length > 0;
  const struck = run.stopped && !run.banked && reached >= 1 && run.pressedOn === reached;
  const kept = reached - (struck ? 1 : 0);

  const best = run.path.reduce((high, i) => Math.max(high, world.metres[i]), 0);
  const peakShare = world.summitM > 0 ? best / world.summitM : 0;
  const walked = new Set(run.path.filter(i => world.land[i]).map(i => world.biome[i]));
  const biomes = world.checklist.filter(b => walked.has(b));

  // Out of what the budget was built to allow, not out of the whole pool — the
  // pool runs deeper only so the pair on offer never thins to one. A player
  // who routes well enough to beat the budget simply tops out at full marks.
  const score = Math.round(
    45 * peakShare +
    30 * Math.min(1, ladderValue(kept) / ladderValue(world.rungs)) +
    25 * (world.checklist.length ? biomes.length / world.checklist.length : 0));

  return {
    found: credited, live,
    reached, kept, awaiting, struck,
    complete: live.length === 0,
    movesLeft: MOVES - (run.path.length - 1),
    best, peakShare, biomes, score,
    grade: score >= 75 ? "A" : score >= 55 ? "B" : score >= 35 ? "C" : "D",
  };
}
