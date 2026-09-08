CREATE TABLE "agent_job" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"conversation_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_at" timestamp NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error" text,
	"locked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "delay_min_sec" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "delay_max_sec" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_job" ADD CONSTRAINT "agent_job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_job_due_idx" ON "agent_job" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_job_queued_uq" ON "agent_job" USING btree ("kind","conversation_id") WHERE "agent_job"."status" = 'queued';