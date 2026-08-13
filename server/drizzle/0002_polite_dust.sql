CREATE TABLE "readsight"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readsight"."daily_usage" (
	"user_id" text NOT NULL,
	"usage_date" date NOT NULL,
	"metric" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_usage_user_id_usage_date_metric_pk" PRIMARY KEY("user_id","usage_date","metric")
);
--> statement-breakpoint
CREATE TABLE "readsight"."rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "readsight"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "readsight"."user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "readsight"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "readsight"."chat_messages_thread_id_idx";--> statement-breakpoint
DROP INDEX "readsight"."encounter_events_item_key_idx";--> statement-breakpoint
DROP INDEX "readsight"."encounter_events_ts_idx";--> statement-breakpoint
ALTER TABLE "readsight"."chat_messages" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "readsight"."encounter_events" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "readsight"."selection_contexts" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "readsight"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "readsight"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readsight"."daily_usage" ADD CONSTRAINT "daily_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "readsight"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readsight"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "readsight"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "readsight"."account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "readsight"."session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "readsight"."verification" USING btree ("identifier");--> statement-breakpoint
ALTER TABLE "readsight"."chat_messages" ADD CONSTRAINT "chat_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "readsight"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readsight"."encounter_events" ADD CONSTRAINT "encounter_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "readsight"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readsight"."selection_contexts" ADD CONSTRAINT "selection_contexts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "readsight"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_user_thread_idx" ON "readsight"."chat_messages" USING btree ("user_id","thread_id","created_at");--> statement-breakpoint
CREATE INDEX "encounter_events_user_item_key_idx" ON "readsight"."encounter_events" USING btree ("user_id","item_key");--> statement-breakpoint
CREATE INDEX "encounter_events_user_ts_idx" ON "readsight"."encounter_events" USING btree ("user_id","ts");--> statement-breakpoint
CREATE INDEX "selection_contexts_user_captured_idx" ON "readsight"."selection_contexts" USING btree ("user_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "selection_contexts_id_user_idx" ON "readsight"."selection_contexts" USING btree ("id","user_id");