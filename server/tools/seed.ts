/**
 * Fill the database with a plausible league's worth of snapshots.
 *
 * The charts are only really reviewable against data with the shape real data has: farming
 * sessions separated by sleep, a divine rate that drifts, the occasional sale that dwarfs
 * everything around it. Waiting three days of wall-clock time to find out that the tooltip
 * overlaps the axis is not a workflow.
 *
 *   pnpm --filter @whatremains/server seed -- --days 4 --league Settlers
 *
 * It refuses to touch a league that already has snapshots unless --force is passed, so it
 * cannot quietly bury real history under invented numbers.
 */

import { PrismaClient } from '../generated/prisma/index.js';
import type { Breakdown } from '../src/services/valuationService.ts';

interface Options {
  league: string;
  days: number;
  intervalMinutes: number;
  force: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { league: 'Settlers', days: 3, intervalMinutes: 10, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--league' && value) options.league = value;
    else if (flag === '--days' && value) options.days = Number(value);
    else if (flag === '--interval' && value) options.intervalMinutes = Number(value);
    else if (flag === '--force') options.force = true;
  }
  if (!Number.isFinite(options.days) || options.days <= 0) throw new Error('--days must be positive');
  return options;
}

/** Deterministic noise, so two runs of the seeder produce the same league. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const TABS = ['Currency', 'Dump', 'Fragments', 'Crafting'] as const;

/** Roughly: awake and farming 10:00–02:00, asleep otherwise. */
function isActive(date: Date): boolean {
  const hour = date.getUTCHours();
  return hour >= 10 || hour < 2;
}

function buildBreakdown(totals: Record<string, number>, divineRate: number): Breakdown {
  const breakdown: Breakdown = {};
  for (const [tab, total] of Object.entries(totals)) {
    if (tab === 'Currency') {
      const divines = Math.floor((total * 0.7) / divineRate);
      const chaos = Math.round(total - divines * divineRate);
      breakdown[tab] = {
        'Divine Orb': { qty: divines, chaosEach: divineRate, chaosTotal: Math.round(divines * divineRate) },
        'Chaos Orb': { qty: Math.max(0, chaos), chaosEach: 1, chaosTotal: Math.max(0, chaos) },
      };
    } else if (tab === 'Dump') {
      breakdown[tab] = {
        'The Doctor': { qty: Math.floor(total / 1450), chaosEach: 1450.5, chaosTotal: Math.floor(total / 1450) * 1450 },
        'Gilded Bestiary Scarab': {
          qty: Math.max(1, Math.floor((total % 1450) / 88)),
          chaosEach: 88.2,
          chaosTotal: Math.round(total % 1450),
        },
      };
    } else {
      breakdown[tab] = {
        'Sacrifice at Dusk': { qty: Math.max(1, Math.round(total / 3.4)), chaosEach: 3.4, chaosTotal: Math.round(total) },
      };
    }
  }
  return breakdown;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const existing = await prisma.snapshot.count({ where: { league: options.league } });
    if (existing > 0 && !options.force) {
      console.error(
        `League "${options.league}" already has ${existing} snapshots. Pass --force to add to them anyway.`,
      );
      process.exitCode = 1;
      return;
    }

    const random = makeRandom(20_260_101);
    const stepMs = options.intervalMinutes * 60_000;
    const steps = Math.round((options.days * 24 * 60) / options.intervalMinutes);
    const start = Date.now() - steps * stepMs;

    // Wealth accumulates per tab; the divine rate drifts up the way it does mid-league.
    const totals: Record<string, number> = { Currency: 1_800, Dump: 400, Fragments: 120, Crafting: 60 };
    let divineRate = 190;
    const rows: Array<{ takenAt: Date; totals: Record<string, number>; divineRate: number }> = [];

    for (let step = 0; step <= steps; step += 1) {
      const takenAt = new Date(start + step * stepMs);
      divineRate = Math.max(120, divineRate + (random() - 0.45) * 1.4);

      if (isActive(takenAt)) {
        for (const tab of TABS) {
          const base = tab === 'Currency' ? 55 : tab === 'Dump' ? 25 : 6;
          totals[tab] = (totals[tab] ?? 0) + base * random() * 2;
        }
        // Roughly one interval in eighty is a sale big enough to be worth annotating.
        if (random() < 0.0125) {
          totals.Dump = (totals.Dump ?? 0) + 900 + random() * 2_400;
        }
        // And occasionally the wealth goes the other way: a crafting bench eats a divine pile.
        if (random() < 0.006) {
          totals.Currency = Math.max(200, (totals.Currency ?? 0) - (600 + random() * 1_500));
        }
      }

      rows.push({
        takenAt,
        totals: Object.fromEntries(Object.entries(totals).map(([tab, value]) => [tab, Math.round(value)])),
        divineRate: Math.round(divineRate * 10) / 10,
      });
    }

    await prisma.snapshot.createMany({
      data: rows.map((row) => {
        const totalChaos = Object.values(row.totals).reduce((sum, value) => sum + value, 0);
        return {
          takenAt: row.takenAt,
          league: options.league,
          totalChaos,
          totalDivine: Math.round((totalChaos / row.divineRate) * 100) / 100,
          divineRate: row.divineRate,
          itemCount: Math.round(totalChaos / 4),
          breakdown: buildBreakdown(row.totals, row.divineRate) as object,
          priceSetAt: new Date(row.takenAt.getTime() - (row.takenAt.getTime() % 3_600_000)),
        };
      }),
    });

    console.log(
      `Seeded ${rows.length} snapshots across ${options.days} day(s) of "${options.league}". ` +
        'This is invented data — delete the database before pointing the poller at a real account.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
