CREATE TYPE "public"."learning_assessment_question_set_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."learning_assessment_question_type" AS ENUM('single_choice', 'multiple_choice', 'matching', 'opinion_analysis');--> statement-breakpoint
CREATE TABLE "learning_assessment_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"learning_relationship_id" text NOT NULL,
	"question_set_id" text NOT NULL,
	"version_id" text NOT NULL,
	"node_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"answers" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"node_score" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "learning_assessment_attempt_relationship_question_set_key_unique" UNIQUE("learning_relationship_id","question_set_id","idempotency_key"),
	CONSTRAINT "learning_assessment_attempt_score_check" CHECK ("learning_assessment_attempt"."node_score" >= 0 AND "learning_assessment_attempt"."node_score" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "learning_assessment_question" (
	"question_set_id" text NOT NULL,
	"question_id" text NOT NULL,
	"version_id" text NOT NULL,
	"node_id" text NOT NULL,
	"position" integer NOT NULL,
	"type" "learning_assessment_question_type" NOT NULL,
	"prompt" text NOT NULL,
	"explanation" text NOT NULL,
	CONSTRAINT "learning_assessment_question_question_set_id_question_id_pk" PRIMARY KEY("question_set_id","question_id"),
	CONSTRAINT "learning_assessment_question_position_unique" UNIQUE("question_set_id","position")
);
--> statement-breakpoint
CREATE TABLE "learning_assessment_question_correct_option" (
	"question_set_id" text NOT NULL,
	"question_id" text NOT NULL,
	"option_id" text NOT NULL,
	CONSTRAINT "learning_assessment_question_correct_option_question_set_id_question_id_option_id_pk" PRIMARY KEY("question_set_id","question_id","option_id")
);
--> statement-breakpoint
CREATE TABLE "learning_assessment_question_matching_answer" (
	"question_set_id" text NOT NULL,
	"question_id" text NOT NULL,
	"left_option_id" text NOT NULL,
	"right_option_id" text NOT NULL,
	CONSTRAINT "learning_assessment_question_matching_answer_question_set_id_question_id_left_option_id_pk" PRIMARY KEY("question_set_id","question_id","left_option_id"),
	CONSTRAINT "learning_assessment_question_matching_right_option_unique" UNIQUE("question_set_id","question_id","right_option_id")
);
--> statement-breakpoint
CREATE TABLE "learning_assessment_question_option" (
	"question_set_id" text NOT NULL,
	"question_id" text NOT NULL,
	"option_id" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "learning_assessment_question_option_question_set_id_question_id_option_id_pk" PRIMARY KEY("question_set_id","question_id","option_id"),
	CONSTRAINT "learning_assessment_question_option_position_unique" UNIQUE("question_set_id","question_id","position")
);
--> statement-breakpoint
CREATE TABLE "learning_assessment_question_set" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"status" "learning_assessment_question_set_status" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp,
	CONSTRAINT "learning_assessment_question_set_version_unique" UNIQUE("version_id"),
	CONSTRAINT "learning_assessment_question_set_id_version_unique" UNIQUE("id","version_id"),
	CONSTRAINT "learning_assessment_question_set_publication_time_check" CHECK (("learning_assessment_question_set"."status" = 'draft' AND "learning_assessment_question_set"."published_at" IS NULL) OR ("learning_assessment_question_set"."status" = 'published' AND "learning_assessment_question_set"."published_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "learning_assessment_question_source" (
	"question_set_id" text NOT NULL,
	"question_id" text NOT NULL,
	"version_id" text NOT NULL,
	"node_id" text NOT NULL,
	"source_id" text NOT NULL,
	CONSTRAINT "learning_assessment_question_source_question_set_id_question_id_source_id_pk" PRIMARY KEY("question_set_id","question_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "learning_progress_node" (
	"learning_relationship_id" text NOT NULL,
	"question_set_id" text NOT NULL,
	"version_id" text NOT NULL,
	"node_id" text NOT NULL,
	"best_score" integer DEFAULT 0 NOT NULL,
	"best_attempt_id" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "learning_progress_node_learning_relationship_id_node_id_pk" PRIMARY KEY("learning_relationship_id","node_id"),
	CONSTRAINT "learning_progress_node_best_score_check" CHECK ("learning_progress_node"."best_score" >= 0 AND "learning_progress_node"."best_score" <= 10000),
	CONSTRAINT "learning_progress_node_completion_check" CHECK (("learning_progress_node"."completed_at" IS NULL AND "learning_progress_node"."best_score" < 8000) OR ("learning_progress_node"."completed_at" IS NOT NULL AND "learning_progress_node"."best_score" >= 8000))
);
--> statement-breakpoint
ALTER TABLE "learning_relationship" ADD COLUMN "question_set_id" text;--> statement-breakpoint
ALTER TABLE "learning_assessment_attempt" ADD CONSTRAINT "learning_assessment_attempt_learning_relationship_id_learning_relationship_id_fk" FOREIGN KEY ("learning_relationship_id") REFERENCES "public"."learning_relationship"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_assessment_attempt" ADD CONSTRAINT "learning_assessment_attempt_question_set_id_learning_assessment_question_set_id_fk" FOREIGN KEY ("question_set_id") REFERENCES "public"."learning_assessment_question_set"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_assessment_attempt" ADD CONSTRAINT "learning_assessment_attempt_version_id_learning_map_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."learning_map_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_assessment_attempt" ADD CONSTRAINT "learning_assessment_attempt_question_set_version_fk" FOREIGN KEY ("question_set_id","version_id") REFERENCES "public"."learning_assessment_question_set"("id","version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_assessment_attempt" ADD CONSTRAINT "learning_assessment_attempt_node_fk" FOREIGN KEY ("version_id","node_id") REFERENCES "public"."learning_map_node"("version_id","node_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_assessment_question" ADD CONSTRAINT "learning_assessment_question_set_fk" FOREIGN KEY ("question_set_id") REFERENCES "public"."learning_assessment_question_set"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_assessment_question" ADD CONSTRAINT "learning_assessment_question_set_version_fk" FOREIGN KEY ("question_set_id","version_id") REFERENCES "public"."learning_assessment_question_set"("id","version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_assessment_question" ADD CONSTRAINT "learning_assessment_question_node_fk" FOREIGN KEY ("version_id","node_id") REFERENCES "public"."learning_map_node"("version_id","node_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_assessment_question_correct_option" ADD CONSTRAINT "learning_assessment_question_correct_option_fk" FOREIGN KEY ("question_set_id","question_id","option_id") REFERENCES "public"."learning_assessment_question_option"("question_set_id","question_id","option_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_assessment_question_matching_answer" ADD CONSTRAINT "learning_assessment_question_matching_question_fk" FOREIGN KEY ("question_set_id","question_id") REFERENCES "public"."learning_assessment_question"("question_set_id","question_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_assessment_question_matching_answer" ADD CONSTRAINT "learning_assessment_question_matching_left_option_fk" FOREIGN KEY ("question_set_id","question_id","left_option_id") REFERENCES "public"."learning_assessment_question_option"("question_set_id","question_id","option_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_assessment_question_matching_answer" ADD CONSTRAINT "learning_assessment_question_matching_right_option_fk" FOREIGN KEY ("question_set_id","question_id","right_option_id") REFERENCES "public"."learning_assessment_question_option"("question_set_id","question_id","option_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_assessment_question_option" ADD CONSTRAINT "learning_assessment_question_option_question_fk" FOREIGN KEY ("question_set_id","question_id") REFERENCES "public"."learning_assessment_question"("question_set_id","question_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_assessment_question_set" ADD CONSTRAINT "learning_assessment_question_set_version_id_learning_map_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."learning_map_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_assessment_question_source" ADD CONSTRAINT "learning_assessment_question_source_question_fk" FOREIGN KEY ("question_set_id","question_id") REFERENCES "public"."learning_assessment_question"("question_set_id","question_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_assessment_question_source" ADD CONSTRAINT "learning_assessment_question_source_node_source_fk" FOREIGN KEY ("version_id","node_id","source_id") REFERENCES "public"."learning_map_node_source"("version_id","node_id","source_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_progress_node" ADD CONSTRAINT "learning_progress_node_relationship_fk" FOREIGN KEY ("learning_relationship_id") REFERENCES "public"."learning_relationship"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_progress_node" ADD CONSTRAINT "learning_progress_node_question_set_fk" FOREIGN KEY ("question_set_id") REFERENCES "public"."learning_assessment_question_set"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_progress_node" ADD CONSTRAINT "learning_progress_node_version_fk" FOREIGN KEY ("version_id") REFERENCES "public"."learning_map_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_progress_node" ADD CONSTRAINT "learning_progress_node_question_set_version_fk" FOREIGN KEY ("question_set_id","version_id") REFERENCES "public"."learning_assessment_question_set"("id","version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_progress_node" ADD CONSTRAINT "learning_progress_node_node_fk" FOREIGN KEY ("version_id","node_id") REFERENCES "public"."learning_map_node"("version_id","node_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_assessment_attempt_relationship_idx" ON "learning_assessment_attempt" USING btree ("learning_relationship_id","created_at");--> statement-breakpoint
CREATE INDEX "learning_assessment_question_node_idx" ON "learning_assessment_question" USING btree ("question_set_id","node_id");--> statement-breakpoint
CREATE INDEX "learning_assessment_question_set_version_id_idx" ON "learning_assessment_question_set" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "learning_progress_node_question_set_idx" ON "learning_progress_node" USING btree ("question_set_id");
--> statement-breakpoint
ALTER TABLE "learning_relationship" ADD CONSTRAINT "learning_relationship_question_set_version_fk" FOREIGN KEY ("question_set_id","version_id") REFERENCES "public"."learning_assessment_question_set"("id","version_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION reject_published_learning_assessment_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	question_set_to_check text;
BEGIN
	IF TG_TABLE_NAME = 'learning_assessment_question_set' THEN
		question_set_to_check := OLD.id;
	ELSIF TG_OP = 'DELETE' THEN
		question_set_to_check := OLD.question_set_id;
	ELSE
		question_set_to_check := NEW.question_set_id;
	END IF;
	IF EXISTS (
		SELECT 1 FROM learning_assessment_question_set
		WHERE id = question_set_to_check AND status = 'published'
	) THEN
		RAISE EXCEPTION 'published learning assessment content is immutable';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER learning_assessment_question_set_immutable
BEFORE UPDATE OR DELETE ON learning_assessment_question_set
FOR EACH ROW EXECUTE FUNCTION reject_published_learning_assessment_mutation();
--> statement-breakpoint
CREATE TRIGGER learning_assessment_question_immutable
BEFORE INSERT OR UPDATE OR DELETE ON learning_assessment_question
FOR EACH ROW EXECUTE FUNCTION reject_published_learning_assessment_mutation();
--> statement-breakpoint
CREATE TRIGGER learning_assessment_question_option_immutable
BEFORE INSERT OR UPDATE OR DELETE ON learning_assessment_question_option
FOR EACH ROW EXECUTE FUNCTION reject_published_learning_assessment_mutation();
--> statement-breakpoint
CREATE TRIGGER learning_assessment_question_correct_option_immutable
BEFORE INSERT OR UPDATE OR DELETE ON learning_assessment_question_correct_option
FOR EACH ROW EXECUTE FUNCTION reject_published_learning_assessment_mutation();
--> statement-breakpoint
CREATE TRIGGER learning_assessment_question_matching_answer_immutable
BEFORE INSERT OR UPDATE OR DELETE ON learning_assessment_question_matching_answer
FOR EACH ROW EXECUTE FUNCTION reject_published_learning_assessment_mutation();
--> statement-breakpoint
CREATE TRIGGER learning_assessment_question_source_immutable
BEFORE INSERT OR UPDATE OR DELETE ON learning_assessment_question_source
FOR EACH ROW EXECUTE FUNCTION reject_published_learning_assessment_mutation();