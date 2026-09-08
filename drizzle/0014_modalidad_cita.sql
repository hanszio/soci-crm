ALTER TABLE "calendar_settings" ALTER COLUMN "timezone" SET DEFAULT 'America/Lima';--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "modality" text;--> statement-breakpoint
ALTER TABLE "calendar_settings" ADD COLUMN "modalities" jsonb DEFAULT '["presencial","llamada"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_settings" ADD COLUMN "address" text;