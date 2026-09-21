CREATE SCHEMA "relata";
--> statement-breakpoint
CREATE TABLE "relata"."account" (
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
CREATE TABLE "relata"."captures" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_id" text NOT NULL,
	"client_request_id" text NOT NULL,
	"capture_method" text NOT NULL,
	"captured_url" text,
	"captured_title" text,
	"captured_favicon_url" text,
	"selection" jsonb,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "captures_id_user_id_unique" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "relata"."daily_usage" (
	"user_id" text NOT NULL,
	"usage_date" date NOT NULL,
	"metric" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_usage_user_id_usage_date_metric_pk" PRIMARY KEY("user_id","usage_date","metric")
);
--> statement-breakpoint
CREATE TABLE "relata"."intents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"capture_id" text NOT NULL,
	"raw_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relata"."project_sources" (
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_id" text NOT NULL,
	"linked_via_capture_id" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sort_order" integer,
	CONSTRAINT "project_sources_project_id_source_id_pk" PRIMARY KEY("project_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "relata"."projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "projects_id_user_id_unique" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "relata"."rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "relata"."session" (
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
CREATE TABLE "relata"."sources" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"canonical_url" text NOT NULL,
	"original_url" text NOT NULL,
	"title" text NOT NULL,
	"favicon_url" text,
	"source_type" text DEFAULT 'web' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_id_user_id_unique" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "relata"."user" (
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
CREATE TABLE "relata"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "relata"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "relata"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."captures" ADD CONSTRAINT "captures_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "relata"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."captures" ADD CONSTRAINT "captures_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "relata"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."captures" ADD CONSTRAINT "captures_source_same_user_fk" FOREIGN KEY ("user_id","source_id") REFERENCES "relata"."sources"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."daily_usage" ADD CONSTRAINT "daily_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "relata"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."intents" ADD CONSTRAINT "intents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "relata"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."intents" ADD CONSTRAINT "intents_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "relata"."captures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."intents" ADD CONSTRAINT "intents_capture_same_user_fk" FOREIGN KEY ("user_id","capture_id") REFERENCES "relata"."captures"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."project_sources" ADD CONSTRAINT "project_sources_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "relata"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."project_sources" ADD CONSTRAINT "project_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "relata"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."project_sources" ADD CONSTRAINT "project_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "relata"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."project_sources" ADD CONSTRAINT "project_sources_linked_via_capture_id_captures_id_fk" FOREIGN KEY ("linked_via_capture_id") REFERENCES "relata"."captures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."project_sources" ADD CONSTRAINT "project_sources_project_same_user_fk" FOREIGN KEY ("user_id","project_id") REFERENCES "relata"."projects"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."project_sources" ADD CONSTRAINT "project_sources_source_same_user_fk" FOREIGN KEY ("user_id","source_id") REFERENCES "relata"."sources"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."project_sources" ADD CONSTRAINT "project_sources_capture_same_user_fk" FOREIGN KEY ("user_id","linked_via_capture_id") REFERENCES "relata"."captures"("user_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."projects" ADD CONSTRAINT "projects_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "relata"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "relata"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."sources" ADD CONSTRAINT "sources_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "relata"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "relata"."account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "captures_user_client_request_unique" ON "relata"."captures" USING btree ("user_id","client_request_id");--> statement-breakpoint
CREATE INDEX "captures_source_captured_at_idx" ON "relata"."captures" USING btree ("source_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "intents_capture_unique" ON "relata"."intents" USING btree ("capture_id");--> statement-breakpoint
CREATE INDEX "intents_user_capture_idx" ON "relata"."intents" USING btree ("user_id","capture_id");--> statement-breakpoint
CREATE INDEX "project_sources_user_source_idx" ON "relata"."project_sources" USING btree ("user_id","source_id");--> statement-breakpoint
CREATE INDEX "project_sources_user_project_idx" ON "relata"."project_sources" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE INDEX "projects_user_active_idx" ON "relata"."projects" USING btree ("user_id","archived_at","updated_at");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "relata"."session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_user_canonical_url_unique" ON "relata"."sources" USING btree ("user_id","canonical_url");--> statement-breakpoint
CREATE INDEX "sources_user_last_captured_idx" ON "relata"."sources" USING btree ("user_id","last_captured_at");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "relata"."verification" USING btree ("identifier");