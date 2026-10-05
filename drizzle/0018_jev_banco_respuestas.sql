CREATE TABLE "reply_variant" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"text" text NOT NULL,
	"source" text DEFAULT 'owner' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turn_decision" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"plan" text NOT NULL,
	"detail" text,
	"answers" jsonb NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"model" text NOT NULL,
	"applied" boolean DEFAULT false NOT NULL,
	"llm_action" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "jev_mode" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "reply_variant" ADD CONSTRAINT "reply_variant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_decision" ADD CONSTRAINT "turn_decision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reply_variant_org_key_idx" ON "reply_variant" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "turn_decision_org_idx" ON "turn_decision" USING btree ("organization_id","created_at");