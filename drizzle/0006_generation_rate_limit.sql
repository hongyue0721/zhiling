CREATE TABLE IF NOT EXISTS "generation_rate_limit" (
  "user_id" text PRIMARY KEY NOT NULL,
  "window_started_at" timestamp NOT NULL,
  "request_count" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "generation_rate_limit_request_count_check" CHECK ("generation_rate_limit"."request_count" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generation_rate_limit" ADD CONSTRAINT "generation_rate_limit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
