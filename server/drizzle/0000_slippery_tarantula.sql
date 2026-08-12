CREATE SCHEMA IF NOT EXISTS "readsight";--> statement-breakpoint
CREATE TYPE "readsight"."chat_role" AS ENUM('system', 'user', 'assistant', 'tool');--> statement-breakpoint
CREATE TYPE "readsight"."encounter_event_type" AS ENUM('lookup', 'quick', 'deepchat', 'passive_reencounter');--> statement-breakpoint
CREATE TYPE "readsight"."encounter_outcome" AS ENUM('understood', 'still_unsure');--> statement-breakpoint
CREATE TYPE "readsight"."selection_type" AS ENUM('word', 'phrase', 'sentence', 'multi');--> statement-breakpoint
CREATE TABLE "readsight"."chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"selection_context_id" text,
	"role" "readsight"."chat_role" NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readsight"."dictionary_entries" (
	"lemma" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"source" text NOT NULL,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readsight"."encounter_events" (
	"id" text PRIMARY KEY NOT NULL,
	"item_key" text NOT NULL,
	"surface_form" text NOT NULL,
	"context_ref" text,
	"event_type" "readsight"."encounter_event_type" NOT NULL,
	"outcome" "readsight"."encounter_outcome",
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readsight"."selection_contexts" (
	"id" text PRIMARY KEY NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"site_id" text NOT NULL,
	"heading" text,
	"selection_text" text NOT NULL,
	"selection_type" "readsight"."selection_type" NOT NULL,
	"range_start" integer NOT NULL,
	"range_end" integer NOT NULL,
	"sentence" text NOT NULL,
	"paragraph" text NOT NULL,
	"anchor" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readsight"."translations" (
	"hash" text PRIMARY KEY NOT NULL,
	"original_text" text NOT NULL,
	"zh" text NOT NULL,
	"target_lang" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readsight"."tts_cache" (
	"hash" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"voice" text NOT NULL,
	"model" text NOT NULL,
	"audio_hex" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "readsight"."chat_messages" ADD CONSTRAINT "chat_messages_selection_context_id_selection_contexts_id_fk" FOREIGN KEY ("selection_context_id") REFERENCES "readsight"."selection_contexts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readsight"."encounter_events" ADD CONSTRAINT "encounter_events_context_ref_selection_contexts_id_fk" FOREIGN KEY ("context_ref") REFERENCES "readsight"."selection_contexts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_thread_id_idx" ON "readsight"."chat_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "encounter_events_item_key_idx" ON "readsight"."encounter_events" USING btree ("item_key");--> statement-breakpoint
CREATE INDEX "encounter_events_ts_idx" ON "readsight"."encounter_events" USING btree ("ts");
