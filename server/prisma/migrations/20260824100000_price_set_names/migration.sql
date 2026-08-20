-- poe.ninja's own name for each priced id, from the item endpoint.
--
-- Nullable with no backfill: there is nothing to backfill from, because the names were never
-- fetched before this. Existing rows keep answering with the alias table and the unslugged id,
-- which is what they did already, and the next price fetch fills the column in.
ALTER TABLE "PriceSet" ADD COLUMN "names" JSONB;
