-- Station ids move from a uuid[] to a JSON array so the same model works on the location hub's
-- SQLite database. Existing values are converted in place, not dropped.
ALTER TABLE "order_items" ALTER COLUMN "station_ids" DROP DEFAULT;
ALTER TABLE "order_items"
  ALTER COLUMN "station_ids" TYPE JSONB USING to_jsonb("station_ids");
UPDATE "order_items" SET "station_ids" = '[]' WHERE "station_ids" IS NULL;
ALTER TABLE "order_items" ALTER COLUMN "station_ids" SET DEFAULT '[]';
ALTER TABLE "order_items" ALTER COLUMN "station_ids" SET NOT NULL;
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_station_ids_is_array" CHECK (jsonb_typeof("station_ids") = 'array');
