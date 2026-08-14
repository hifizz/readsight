CREATE TABLE "relata"."analysis_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_id" text NOT NULL,
	"requested_by_capture_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"extraction_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_runs_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "analysis_runs_status_check" CHECK ("relata"."analysis_runs"."status" in ('queued','running','completed','failed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "relata"."messages" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"source_analysis_id" text,
	"project_insight_id" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "messages_role_check" CHECK ("relata"."messages"."role" in ('user','assistant','system','tool'))
);
--> statement-breakpoint
CREATE TABLE "relata"."project_insights" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_id" text NOT NULL,
	"source_analysis_id" text NOT NULL,
	"version" integer NOT NULL,
	"why_it_matters" text NOT NULL,
	"implications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_insights_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "project_insights_version_unique" UNIQUE("project_id","source_id","version")
);
--> statement-breakpoint
CREATE TABLE "relata"."source_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_id" text NOT NULL,
	"analysis_run_id" text NOT NULL,
	"version" integer NOT NULL,
	"summary" text NOT NULL,
	"key_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_type" text,
	"intent_interpretations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_analyses_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "source_analyses_source_version_unique" UNIQUE("source_id","version")
);
--> statement-breakpoint
CREATE TABLE "relata"."threads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_id" text,
	"project_id" text,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "threads_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "threads_context_check" CHECK ("relata"."threads"."source_id" is not null or "relata"."threads"."project_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "relata"."analysis_runs" ADD CONSTRAINT "analysis_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "relata"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."analysis_runs" ADD CONSTRAINT "analysis_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "relata"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."analysis_runs" ADD CONSTRAINT "analysis_runs_requested_by_capture_id_captures_id_fk" FOREIGN KEY ("requested_by_capture_id") REFERENCES "relata"."captures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."analysis_runs" ADD CONSTRAINT "analysis_runs_source_same_user_fk" FOREIGN KEY ("user_id","source_id") REFERENCES "relata"."sources"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."analysis_runs" ADD CONSTRAINT "analysis_runs_capture_same_user_fk" FOREIGN KEY ("user_id","requested_by_capture_id") REFERENCES "relata"."captures"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."messages" ADD CONSTRAINT "messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "relata"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "relata"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."messages" ADD CONSTRAINT "messages_source_analysis_id_source_analyses_id_fk" FOREIGN KEY ("source_analysis_id") REFERENCES "relata"."source_analyses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."messages" ADD CONSTRAINT "messages_project_insight_id_project_insights_id_fk" FOREIGN KEY ("project_insight_id") REFERENCES "relata"."project_insights"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."messages" ADD CONSTRAINT "messages_thread_same_user_fk" FOREIGN KEY ("user_id","thread_id") REFERENCES "relata"."threads"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."messages" ADD CONSTRAINT "messages_analysis_same_user_fk" FOREIGN KEY ("user_id","source_analysis_id") REFERENCES "relata"."source_analyses"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."messages" ADD CONSTRAINT "messages_insight_same_user_fk" FOREIGN KEY ("user_id","project_insight_id") REFERENCES "relata"."project_insights"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."project_insights" ADD CONSTRAINT "project_insights_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "relata"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."project_insights" ADD CONSTRAINT "project_insights_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "relata"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."project_insights" ADD CONSTRAINT "project_insights_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "relata"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."project_insights" ADD CONSTRAINT "project_insights_source_analysis_id_source_analyses_id_fk" FOREIGN KEY ("source_analysis_id") REFERENCES "relata"."source_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."project_insights" ADD CONSTRAINT "project_insights_project_same_user_fk" FOREIGN KEY ("user_id","project_id") REFERENCES "relata"."projects"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."project_insights" ADD CONSTRAINT "project_insights_source_same_user_fk" FOREIGN KEY ("user_id","source_id") REFERENCES "relata"."sources"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."project_insights" ADD CONSTRAINT "project_insights_analysis_same_user_fk" FOREIGN KEY ("user_id","source_analysis_id") REFERENCES "relata"."source_analyses"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."source_analyses" ADD CONSTRAINT "source_analyses_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "relata"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."source_analyses" ADD CONSTRAINT "source_analyses_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "relata"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."source_analyses" ADD CONSTRAINT "source_analyses_analysis_run_id_analysis_runs_id_fk" FOREIGN KEY ("analysis_run_id") REFERENCES "relata"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."source_analyses" ADD CONSTRAINT "source_analyses_source_same_user_fk" FOREIGN KEY ("user_id","source_id") REFERENCES "relata"."sources"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."source_analyses" ADD CONSTRAINT "source_analyses_run_same_user_fk" FOREIGN KEY ("user_id","analysis_run_id") REFERENCES "relata"."analysis_runs"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."threads" ADD CONSTRAINT "threads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "relata"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."threads" ADD CONSTRAINT "threads_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "relata"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."threads" ADD CONSTRAINT "threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "relata"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."threads" ADD CONSTRAINT "threads_source_same_user_fk" FOREIGN KEY ("user_id","source_id") REFERENCES "relata"."sources"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relata"."threads" ADD CONSTRAINT "threads_project_same_user_fk" FOREIGN KEY ("user_id","project_id") REFERENCES "relata"."projects"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_runs_source_created_idx" ON "relata"."analysis_runs" USING btree ("user_id","source_id","created_at");--> statement-breakpoint
CREATE INDEX "analysis_runs_status_idx" ON "relata"."analysis_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "messages_thread_created_idx" ON "relata"."messages" USING btree ("user_id","thread_id","created_at");--> statement-breakpoint
CREATE INDEX "project_insights_current_idx" ON "relata"."project_insights" USING btree ("user_id","project_id","source_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "source_analyses_run_unique" ON "relata"."source_analyses" USING btree ("analysis_run_id");--> statement-breakpoint
CREATE INDEX "source_analyses_current_idx" ON "relata"."source_analyses" USING btree ("user_id","source_id","version");--> statement-breakpoint
CREATE INDEX "threads_context_idx" ON "relata"."threads" USING btree ("user_id","source_id","project_id","updated_at");