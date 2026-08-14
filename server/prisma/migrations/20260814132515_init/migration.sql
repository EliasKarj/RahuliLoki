-- CreateTable
CREATE TABLE "Snapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "takenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "league" TEXT NOT NULL,
    "totalChaos" REAL NOT NULL,
    "totalDivine" REAL NOT NULL,
    "divineRate" REAL NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "priceSetAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PriceSet" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "league" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prices" JSONB NOT NULL
);

-- CreateIndex
CREATE INDEX "Snapshot_league_takenAt_idx" ON "Snapshot"("league", "takenAt");

-- CreateIndex
CREATE INDEX "PriceSet_league_fetchedAt_idx" ON "PriceSet"("league", "fetchedAt");
