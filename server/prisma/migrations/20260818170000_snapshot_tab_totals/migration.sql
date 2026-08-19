-- Per-tab totals, alongside the breakdown they are derived from.
--
-- The dashboard reads these on every refresh. Computing them from the breakdown meant reading
-- and parsing every blob in the range: a hundred megabytes of JSON for a month of a nineteen-tab
-- stash, to produce a kilobyte of numbers.
ALTER TABLE "Snapshot" ADD COLUMN "tabs" JSONB;

-- Backfill what is already on disk, so the column is useful on the first launch after the update
-- rather than only for snapshots taken after it.
--
-- This is the slow path — SQLite's json_each over every blob — and it runs exactly once. A
-- league's worth of snapshots takes a couple of seconds; anything larger is still a one-off, and
-- the alternative is a read path that keeps the slow path forever for the sake of old rows.
UPDATE "Snapshot"
SET "tabs" = (
  SELECT json_group_object(t.tab, t.total)
  FROM (
    SELECT tab.key AS tab, SUM(json_extract(item.value, '$.chaosTotal')) AS total
    FROM json_each("Snapshot"."breakdown") tab, json_each(tab.value) item
    GROUP BY tab.key
  ) t
)
WHERE "tabs" IS NULL;
