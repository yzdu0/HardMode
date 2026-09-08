-- Reference only: the worker creates this table itself on first use, so
-- attaching a database is the whole setup. Kept here so the shape is
-- readable without digging through the worker, and for local experiments:
--   npx wrangler d1 execute hardmode-stats --local --file=./worker/schema.sql

-- One row per player per game per day. The primary key is the whole point: a
-- second submission for the same day is rejected, so the histogram is built
-- from first results only and replaying a puzzle cannot move the numbers.
CREATE TABLE IF NOT EXISTS results (
  day    TEXT NOT NULL,
  game   TEXT NOT NULL,
  player TEXT NOT NULL,
  bucket TEXT NOT NULL,
  PRIMARY KEY (day, game, player)
);
CREATE INDEX IF NOT EXISTS results_by_day ON results (day, game, bucket);
