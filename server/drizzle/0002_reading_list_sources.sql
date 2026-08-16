DO $$ BEGIN
  RAISE NOTICE 'reading-list migration before: sources=%, captures=%, intents=%',
    (SELECT count(*) FROM relata.sources),
    (SELECT count(*) FROM relata.captures),
    (SELECT count(*) FROM relata.intents);
END $$;
--> statement-breakpoint
ALTER TABLE "relata"."sources" ADD COLUMN "url_key" text;
ALTER TABLE "relata"."sources" ADD COLUMN "memo" text;
ALTER TABLE "relata"."sources" ADD COLUMN "pinned_at" timestamp with time zone;
ALTER TABLE "relata"."sources" ADD COLUMN "added_at" timestamp with time zone;
--> statement-breakpoint
CREATE TEMP TABLE source_url_migration ON COMMIT DROP AS
SELECT
  c.user_id,
  c.source_id AS old_source_id,
  COALESCE(NULLIF(c.captured_url, ''), s.original_url) AS url_key,
  min(c.captured_at) AS added_at,
  (array_agg(COALESCE(NULLIF(c.captured_title, ''), s.title) ORDER BY c.captured_at DESC))[1] AS title,
  (array_agg(COALESCE(c.captured_favicon_url, s.favicon_url) ORDER BY c.captured_at DESC))[1] AS favicon_url,
  (array_agg(c.id ORDER BY c.captured_at))[1] AS representative_capture_id,
  row_number() OVER (PARTITION BY c.source_id ORDER BY min(c.captured_at), COALESCE(NULLIF(c.captured_url, ''), s.original_url)) AS key_number
FROM relata.captures c
JOIN relata.sources s ON s.id = c.source_id AND s.user_id = c.user_id
GROUP BY c.user_id, c.source_id, COALESCE(NULLIF(c.captured_url, ''), s.original_url);
--> statement-breakpoint
UPDATE relata.sources s
SET url_key = m.url_key,
    original_url = m.url_key,
    title = m.title,
    favicon_url = m.favicon_url,
    added_at = LEAST(s.first_captured_at, m.added_at)
FROM source_url_migration m
WHERE m.old_source_id = s.id AND m.key_number = 1;
--> statement-breakpoint
INSERT INTO relata.sources
  (id, user_id, canonical_url, original_url, title, favicon_url, source_type, metadata,
   first_captured_at, last_captured_at, created_at, updated_at, url_key, memo, pinned_at, added_at)
SELECT
  gen_random_uuid()::text, s.user_id, s.canonical_url, m.url_key, m.title, m.favicon_url,
  s.source_type, s.metadata, m.added_at, m.added_at, m.added_at, now(), m.url_key, NULL, NULL, m.added_at
FROM source_url_migration m
JOIN relata.sources s ON s.id = m.old_source_id
WHERE m.key_number > 1;
--> statement-breakpoint
CREATE TEMP TABLE source_url_targets ON COMMIT DROP AS
SELECT m.*, s.id AS new_source_id
FROM source_url_migration m
JOIN relata.sources s ON s.user_id = m.user_id AND s.url_key = m.url_key;
--> statement-breakpoint
UPDATE relata.sources s
SET memo = latest.raw_text
FROM (
  SELECT DISTINCT ON (t.new_source_id) t.new_source_id, NULLIF(btrim(i.raw_text), '') AS raw_text
  FROM source_url_targets t
  JOIN relata.captures c ON c.source_id = t.old_source_id
    AND COALESCE(NULLIF(c.captured_url, ''), t.url_key) = t.url_key
  JOIN relata.intents i ON i.capture_id = c.id AND i.user_id = c.user_id
  WHERE NULLIF(btrim(i.raw_text), '') IS NOT NULL
  ORDER BY t.new_source_id, i.updated_at DESC
) latest
WHERE s.id = latest.new_source_id;
--> statement-breakpoint
INSERT INTO relata.project_sources (user_id, project_id, source_id, linked_at, sort_order)
SELECT ps.user_id, ps.project_id, t.new_source_id, ps.linked_at, ps.sort_order
FROM relata.project_sources ps
JOIN relata.captures c ON c.id = ps.linked_via_capture_id AND c.user_id = ps.user_id
JOIN source_url_targets t ON t.old_source_id = c.source_id
  AND t.url_key = COALESCE(NULLIF(c.captured_url, ''), t.url_key)
WHERE t.new_source_id <> ps.source_id
ON CONFLICT (project_id, source_id) DO NOTHING;
--> statement-breakpoint
DO $$ BEGIN
  RAISE NOTICE 'reading-list migration audit: ambiguous memberships retained on representative key=%',
    (SELECT count(*) FROM relata.project_sources WHERE linked_via_capture_id IS NULL);
END $$;
--> statement-breakpoint
ALTER TABLE "relata"."project_sources" DROP CONSTRAINT IF EXISTS "project_sources_capture_same_user_fk";
ALTER TABLE "relata"."analysis_runs" DROP CONSTRAINT IF EXISTS "analysis_runs_capture_same_user_fk";
ALTER TABLE "relata"."project_sources" DROP COLUMN "linked_via_capture_id";
ALTER TABLE "relata"."analysis_runs" DROP COLUMN "requested_by_capture_id";
DROP TABLE "relata"."intents";
DROP TABLE "relata"."captures";
--> statement-breakpoint
UPDATE relata.sources SET url_key = original_url WHERE url_key IS NULL;
UPDATE relata.sources SET added_at = first_captured_at WHERE added_at IS NULL;
ALTER TABLE "relata"."sources" ALTER COLUMN "url_key" SET NOT NULL;
ALTER TABLE "relata"."sources" ALTER COLUMN "added_at" SET DEFAULT now();
ALTER TABLE "relata"."sources" ALTER COLUMN "added_at" SET NOT NULL;
DROP INDEX IF EXISTS "relata"."sources_user_canonical_url_unique";
DROP INDEX IF EXISTS "relata"."sources_user_last_captured_idx";
ALTER TABLE "relata"."sources" DROP COLUMN "canonical_url";
ALTER TABLE "relata"."sources" DROP COLUMN "first_captured_at";
ALTER TABLE "relata"."sources" DROP COLUMN "last_captured_at";
CREATE UNIQUE INDEX "sources_user_url_key_unique" ON "relata"."sources" ("user_id", "url_key");
CREATE INDEX "sources_user_added_idx" ON "relata"."sources" ("user_id", "added_at");
CREATE INDEX "sources_user_pinned_idx" ON "relata"."sources" ("user_id", "pinned_at");
--> statement-breakpoint
DO $$ BEGIN
  RAISE NOTICE 'reading-list migration after: sources=%', (SELECT count(*) FROM relata.sources);
END $$;
