CREATE SCHEMA IF NOT EXISTS "readsight";--> statement-breakpoint
DO $$
DECLARE
  legacy_table_count integer;
BEGIN
  SELECT count(*)
    INTO legacy_table_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname IN (
       'chat_messages',
       'dictionary_entries',
       'encounter_events',
       'selection_contexts',
       'translations',
       'tts_cache'
     );

  -- 仅搬迁完整的旧版 Readsight 安装。新库会先由 0000 在 readsight 中建表，
  -- 因此不会误搬同库其他项目碰巧使用的 public 表。
  IF legacy_table_count = 6
     AND to_regclass('readsight.selection_contexts') IS NULL THEN
    IF to_regtype('public.chat_role') IS NOT NULL THEN ALTER TYPE "public"."chat_role" SET SCHEMA "readsight"; END IF;
    IF to_regtype('public.encounter_event_type') IS NOT NULL THEN ALTER TYPE "public"."encounter_event_type" SET SCHEMA "readsight"; END IF;
    IF to_regtype('public.encounter_outcome') IS NOT NULL THEN ALTER TYPE "public"."encounter_outcome" SET SCHEMA "readsight"; END IF;
    IF to_regtype('public.selection_type') IS NOT NULL THEN ALTER TYPE "public"."selection_type" SET SCHEMA "readsight"; END IF;

    ALTER TABLE "public"."chat_messages" SET SCHEMA "readsight";
    ALTER TABLE "public"."dictionary_entries" SET SCHEMA "readsight";
    ALTER TABLE "public"."encounter_events" SET SCHEMA "readsight";
    ALTER TABLE "public"."selection_contexts" SET SCHEMA "readsight";
    ALTER TABLE "public"."translations" SET SCHEMA "readsight";
    ALTER TABLE "public"."tts_cache" SET SCHEMA "readsight";
  END IF;
END $$;
