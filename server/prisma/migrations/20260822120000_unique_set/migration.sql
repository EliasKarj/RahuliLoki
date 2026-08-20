-- The uniques a poll last saw, for the Kingsmarch view.
--
-- One row per league, overwritten each poll: the question is "what is in my stash now", and an
-- answer from three days ago is not one. Stored rather than kept in memory so the tab has
-- something to show the moment the app opens.
-- CreateTable
CREATE TABLE "UniqueSet" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "league" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "holdings" JSONB NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "UniqueSet_league_key" ON "UniqueSet"("league");
