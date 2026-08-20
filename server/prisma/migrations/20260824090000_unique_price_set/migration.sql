-- Unique prices move out of PriceSet and into a table of their own.
--
-- 1.3.0 put a name → chaos map in PriceSet.uniques, kept apart from the valuation because a
-- name-level price cannot tell a plain Bronn's Lithe from a six-linked one. poe.ninja's item
-- endpoint does publish `links`, so the variant index this project built years ago can finally
-- be filled from it — and once uniques are priced per variant they belong in the wealth total,
-- which is what this migration is in service of.
--
-- The index is 273 KB. On PriceSet it would be stored forty-eight times over at the default
-- retention — 12.8 MB of the same data — for something only ever read from the newest row, at
-- boot. So it gets one row per league, overwritten on every fetch, exactly like UniqueSet.
--
-- The dropped column loses nothing that is not refetched within the hour.
-- CreateTable
CREATE TABLE "UniquePriceSet" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "league" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lines" JSONB NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PriceSet" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "league" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prices" JSONB NOT NULL,
    "icons" JSONB,
    "categories" JSONB,
    "meta" JSONB
);
INSERT INTO "new_PriceSet" ("categories", "fetchedAt", "icons", "id", "league", "meta", "prices") SELECT "categories", "fetchedAt", "icons", "id", "league", "meta", "prices" FROM "PriceSet";
DROP TABLE "PriceSet";
ALTER TABLE "new_PriceSet" RENAME TO "PriceSet";
CREATE INDEX "PriceSet_league_fetchedAt_idx" ON "PriceSet"("league", "fetchedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "UniquePriceSet_league_key" ON "UniquePriceSet"("league");

