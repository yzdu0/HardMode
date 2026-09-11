import { colOf, dxWrap, rowOf } from './HillClimb-world.ts';
import { gradeSquares, highestNear, livePair, touchedOrder, touching } from './HillClimb-run.ts';
import type { World } from './HillClimb-world.ts';
import type { Run, RunState } from './HillClimb-run.ts';

export function recapFor(world: World, run: Run) {
  const heights = run.path.map(stop => highestNear(world, stop));
  const best = Math.max(...heights);
  const bestMove = heights.indexOf(best);
  const gains = heights.map((height, i) => i ? height - heights[i - 1] : 0);
  const biggestGain = Math.max(...gains);
  const gainMove = gains.indexOf(biggestGain);
  const closest = Math.min(...run.path.map(stop => Math.max(
    dxWrap(colOf(stop), colOf(world.summit)),
    Math.abs(rowOf(stop) - rowOf(world.summit)),
  )));
  // Replay the same unlock rules so each moment names only challenges that
  // were actually collected at that stop, including newly unlocked ones.
  let found = 0;
  const moments = run.path.map((_, move) => {
    const reached = touchedOrder(world, run.path.slice(0, move + 1));
    const added = reached.slice(found);
    found = reached.length;
    return added.map(g => world.goals[g].name);
  });
  const missed = livePair(world, new Set(touchedOrder(world, run.path))).map(g => {
    const goal = world.goals[g];
    const regions = goal.regions?.length ? goal.regions : [goal.cells];
    return new Set(regions
      .filter(region => !run.path.some(stop => touching(region, stop)))
      .flatMap(region => [...region]));
  });
  const insight = best === world.summitM && best > 0
    ? 'You reached the highest ground on the planet.'
    : closest <= 8
      ? `You came within ${closest} ${closest === 1 ? 'square' : 'squares'} of the summit.`
      : biggestGain > 0
        ? `Your biggest climb was ${biggestGain.toLocaleString('en-GB')} m on move ${gainMove}.`
        : `You came within ${closest} squares of the summit.`;
  return { heights, bestMove, closest, moments, insight, missed };
}

/** Relative to this run only: no world height, coordinates or biome clues. */
export function climbSparkline(heights: number[]): string {
  const bars = '▁▂▃▄▅▆▇█';
  const high = Math.max(1, ...heights);
  return heights.map(height => bars[Math.round(Math.max(0, height) / high * 7)]).join('');
}

export function dailyLink(day: string): string {
  return 'https://nphard.app/HillClimb/?date=' + encodeURIComponent(day);
}

export function shareResult(world: World, run: Run, state: RunState): string {
  const heights = run.path.map(stop => highestNear(world, stop));
  return [
    `HillClimb ${world.day}`,
    `${state.score} ${gradeSquares(state.grade)}`,
    `My climb ${climbSparkline(heights)}`,
    `${state.best.toLocaleString('en-GB')} m climbed, ${run.path.length - 1} moves`,
    `🧭 ${state.found.length}/${world.goals.length} challenges`,
    '',
    `Can you beat my ${state.score}?`,
    dailyLink(world.day),
  ].join('\n');
}

/** Reject malformed dates and unavailable links instead of changing the seed. */
export function linkedDay(value: string | null, oldest: string, today: string): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < oldest || value > today) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
