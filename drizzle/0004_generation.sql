CREATE TYPE "public"."generation_event_type" AS ENUM('snapshot', 'progress', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."generation_failure_category" AS ENUM('invalid_topic', 'source_unavailable', 'source_insufficient', 'model_unavailable', 'candidate_invalid', 'generation_timeout', 'internal_failure');--> statement-breakpoint
CREATE TYPE "public"."generation_stage" AS ENUM('queued', 'normalizing', 'cache_lookup', 'planning', 'searching', 'structuring', 'supplementing', 'extracting', 'assessing', 'validating', 'publishing');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('queued', 'normalizing', 'cache_lookup', 'planning', 'searching', 'structuring', 'supplementing', 'extracting', 'assessing', 'validating', 'publishing', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "generation_cache" (
	"normalized_topic" text NOT NULL,
	"pipeline_version" text NOT NULL,
	"source_adapter_version" text NOT NULL,
	"model_adapter_version" text NOT NULL,
	"task_id" text NOT NULL,
	"map_id" text NOT NULL,
	"version_id" text NOT NULL,
	"question_set_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "generation_cache_normalized_topic_pipeline_version_source_adapter_version_model_adapter_version_pk" PRIMARY KEY("normalized_topic","pipeline_version","source_adapter_version","model_adapter_version"),
	CONSTRAINT "generation_cache_task_unique" UNIQUE("task_id")
);
--> statement-breakpoint
CREATE TABLE "generation_checkpoint" (
	"task_id" text NOT NULL,
	"stage" "generation_stage" NOT NULL,
	"operation_key" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "generation_checkpoint_task_id_stage_operation_key_pk" PRIMARY KEY("task_id","stage","operation_key"),
	CONSTRAINT "generation_checkpoint_attempt_count_check" CHECK ("generation_checkpoint"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "generation_event" (
	"task_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"type" "generation_event_type" NOT NULL,
	"data" jsonb NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "generation_event_task_id_sequence_pk" PRIMARY KEY("task_id","sequence"),
	CONSTRAINT "generation_event_sequence_check" CHECK ("generation_event"."sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "generation_participant" (
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "generation_participant_task_id_user_id_pk" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "generation_task" (
	"id" text PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"normalized_topic" text NOT NULL,
	"pipeline_version" text NOT NULL,
	"source_adapter_version" text NOT NULL,
	"model_adapter_version" text NOT NULL,
	"status" "generation_status" NOT NULL,
	"stage" "generation_stage" NOT NULL,
	"sequence" bigint DEFAULT 0 NOT NULL,
	"deadline_at" timestamp NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp,
	"heartbeat_at" timestamp,
	"map_id" text,
	"version_id" text,
	"question_set_id" text,
	"failure_code" "generation_failure_category",
	"failure_retryable" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "generation_task_result_consistency_check" CHECK ((("generation_task"."status" = 'succeeded' AND "generation_task"."map_id" IS NOT NULL AND "generation_task"."version_id" IS NOT NULL AND "generation_task"."question_set_id" IS NOT NULL AND "generation_task"."completed_at" IS NOT NULL) OR ("generation_task"."status" = 'failed' AND "generation_task"."map_id" IS NULL AND "generation_task"."version_id" IS NULL AND "generation_task"."question_set_id" IS NULL AND "generation_task"."completed_at" IS NOT NULL) OR ("generation_task"."status" NOT IN ('succeeded', 'failed') AND "generation_task"."map_id" IS NULL AND "generation_task"."version_id" IS NULL AND "generation_task"."question_set_id" IS NULL AND "generation_task"."completed_at" IS NULL))),
	CONSTRAINT "generation_task_failure_consistency_check" CHECK (("generation_task"."status" = 'failed' AND "generation_task"."failure_code" IS NOT NULL AND "generation_task"."failure_retryable" IS NOT NULL) OR ("generation_task"."status" <> 'failed' AND "generation_task"."failure_code" IS NULL AND "generation_task"."failure_retryable" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD COLUMN "updated_at" bigint;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD COLUMN "authority_level" text;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD COLUMN "ranking_score" real;--> statement-breakpoint
ALTER TABLE "generation_cache" ADD CONSTRAINT "generation_cache_task_id_generation_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."generation_task"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_cache" ADD CONSTRAINT "generation_cache_version_id_learning_map_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."learning_map_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_cache" ADD CONSTRAINT "generation_cache_question_set_id_learning_assessment_question_set_id_fk" FOREIGN KEY ("question_set_id") REFERENCES "public"."learning_assessment_question_set"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_cache" ADD CONSTRAINT "generation_cache_question_set_version_fk" FOREIGN KEY ("question_set_id","version_id") REFERENCES "public"."learning_assessment_question_set"("id","version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_cache" ADD CONSTRAINT "generation_cache_version_map_fk" FOREIGN KEY ("version_id","map_id") REFERENCES "public"."learning_map_version"("id","map_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_checkpoint" ADD CONSTRAINT "generation_checkpoint_task_id_generation_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."generation_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_event" ADD CONSTRAINT "generation_event_task_id_generation_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."generation_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_participant" ADD CONSTRAINT "generation_participant_task_id_generation_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."generation_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_participant" ADD CONSTRAINT "generation_participant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_task" ADD CONSTRAINT "generation_task_version_id_learning_map_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."learning_map_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_task" ADD CONSTRAINT "generation_task_question_set_id_learning_assessment_question_set_id_fk" FOREIGN KEY ("question_set_id") REFERENCES "public"."learning_assessment_question_set"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_task" ADD CONSTRAINT "generation_task_question_set_version_fk" FOREIGN KEY ("question_set_id","version_id") REFERENCES "public"."learning_assessment_question_set"("id","version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_task" ADD CONSTRAINT "generation_task_version_map_fk" FOREIGN KEY ("version_id","map_id") REFERENCES "public"."learning_map_version"("id","map_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_cache_version_idx" ON "generation_cache" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "generation_checkpoint_task_idx" ON "generation_checkpoint" USING btree ("task_id","updated_at");--> statement-breakpoint
CREATE INDEX "generation_event_task_sequence_idx" ON "generation_event" USING btree ("task_id","sequence");--> statement-breakpoint
CREATE INDEX "generation_participant_user_idx" ON "generation_participant" USING btree ("user_id","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_task_active_identity_unique" ON "generation_task" USING btree ("normalized_topic","pipeline_version","source_adapter_version","model_adapter_version") WHERE "generation_task"."status" NOT IN ('succeeded', 'failed');--> statement-breakpoint
CREATE INDEX "generation_task_claim_idx" ON "generation_task" USING btree ("status","next_attempt_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "generation_task_deadline_idx" ON "generation_task" USING btree ("deadline_at");