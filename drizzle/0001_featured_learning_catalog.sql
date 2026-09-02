CREATE TYPE "public"."learning_map_version_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."learning_viewpoint_kind" AS ENUM('consensus', 'disagreement', 'practical_experience', 'supplementary');--> statement-breakpoint
CREATE TABLE "featured_learning_map" (
	"map_id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"position" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "featured_learning_map_position_unique" UNIQUE("position")
);
--> statement-breakpoint
CREATE TABLE "knowledge_source" (
	"version_id" text NOT NULL,
	"source_id" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text NOT NULL,
	"url" text NOT NULL,
	"author_name" text NOT NULL,
	CONSTRAINT "knowledge_source_version_id_source_id_pk" PRIMARY KEY("version_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "learning_map" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_map_node" (
	"version_id" text NOT NULL,
	"node_id" text NOT NULL,
	"title" text NOT NULL,
	"learning_objective" text NOT NULL,
	CONSTRAINT "learning_map_node_version_id_node_id_pk" PRIMARY KEY("version_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "learning_map_node_source" (
	"version_id" text NOT NULL,
	"node_id" text NOT NULL,
	"source_id" text NOT NULL,
	CONSTRAINT "learning_map_node_source_version_id_node_id_source_id_pk" PRIMARY KEY("version_id","node_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "learning_map_prerequisite" (
	"version_id" text NOT NULL,
	"node_id" text NOT NULL,
	"prerequisite_node_id" text NOT NULL,
	CONSTRAINT "learning_map_prerequisite_version_id_node_id_prerequisite_node_id_pk" PRIMARY KEY("version_id","node_id","prerequisite_node_id"),
	CONSTRAINT "learning_map_prerequisite_no_self_check" CHECK ("learning_map_prerequisite"."node_id" <> "learning_map_prerequisite"."prerequisite_node_id")
);
--> statement-breakpoint
CREATE TABLE "learning_map_version" (
	"id" text PRIMARY KEY NOT NULL,
	"map_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"status" "learning_map_version_status" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp,
	CONSTRAINT "learning_map_version_id_map_id_unique" UNIQUE("id","map_id"),
	CONSTRAINT "learning_map_version_publication_time_check" CHECK (("learning_map_version"."status" = 'draft' AND "learning_map_version"."published_at" IS NULL) OR ("learning_map_version"."status" = 'published' AND "learning_map_version"."published_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "learning_viewpoint" (
	"version_id" text NOT NULL,
	"node_id" text NOT NULL,
	"viewpoint_id" text NOT NULL,
	"kind" "learning_viewpoint_kind" NOT NULL,
	"statement" text NOT NULL,
	"conditions" text,
	CONSTRAINT "learning_viewpoint_version_id_node_id_viewpoint_id_pk" PRIMARY KEY("version_id","node_id","viewpoint_id"),
	CONSTRAINT "learning_viewpoint_disagreement_conditions_check" CHECK ("learning_viewpoint"."kind" <> 'disagreement' OR ("learning_viewpoint"."conditions" IS NOT NULL AND length(trim("learning_viewpoint"."conditions")) > 0))
);
--> statement-breakpoint
CREATE TABLE "learning_viewpoint_source" (
	"version_id" text NOT NULL,
	"node_id" text NOT NULL,
	"viewpoint_id" text NOT NULL,
	"source_id" text NOT NULL,
	CONSTRAINT "learning_viewpoint_source_version_id_node_id_viewpoint_id_source_id_pk" PRIMARY KEY("version_id","node_id","viewpoint_id","source_id")
);
--> statement-breakpoint
ALTER TABLE "featured_learning_map" ADD CONSTRAINT "featured_learning_map_map_id_learning_map_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."learning_map"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "featured_learning_map" ADD CONSTRAINT "featured_learning_map_published_version_fk" FOREIGN KEY ("version_id","map_id") REFERENCES "public"."learning_map_version"("id","map_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD CONSTRAINT "knowledge_source_version_id_learning_map_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."learning_map_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_map_node" ADD CONSTRAINT "learning_map_node_version_id_learning_map_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."learning_map_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_map_node_source" ADD CONSTRAINT "learning_map_node_source_node_fk" FOREIGN KEY ("version_id","node_id") REFERENCES "public"."learning_map_node"("version_id","node_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_map_node_source" ADD CONSTRAINT "learning_map_node_source_source_fk" FOREIGN KEY ("version_id","source_id") REFERENCES "public"."knowledge_source"("version_id","source_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_map_prerequisite" ADD CONSTRAINT "learning_map_prerequisite_node_fk" FOREIGN KEY ("version_id","node_id") REFERENCES "public"."learning_map_node"("version_id","node_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_map_prerequisite" ADD CONSTRAINT "learning_map_prerequisite_required_node_fk" FOREIGN KEY ("version_id","prerequisite_node_id") REFERENCES "public"."learning_map_node"("version_id","node_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_map_version" ADD CONSTRAINT "learning_map_version_map_id_learning_map_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."learning_map"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_viewpoint" ADD CONSTRAINT "learning_viewpoint_node_fk" FOREIGN KEY ("version_id","node_id") REFERENCES "public"."learning_map_node"("version_id","node_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_viewpoint_source" ADD CONSTRAINT "learning_viewpoint_source_viewpoint_fk" FOREIGN KEY ("version_id","node_id","viewpoint_id") REFERENCES "public"."learning_viewpoint"("version_id","node_id","viewpoint_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_viewpoint_source" ADD CONSTRAINT "learning_viewpoint_source_node_source_fk" FOREIGN KEY ("version_id","node_id","source_id") REFERENCES "public"."learning_map_node_source"("version_id","node_id","source_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_map_version_map_id_idx" ON "learning_map_version" USING btree ("map_id");
--> statement-breakpoint
CREATE FUNCTION require_published_featured_learning_map() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM learning_map_version
		WHERE id = NEW.version_id
			AND map_id = NEW.map_id
			AND status = 'published'
	) THEN
		RAISE EXCEPTION 'featured learning map must reference a published version';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER featured_learning_map_requires_published_version
BEFORE INSERT OR UPDATE ON featured_learning_map
FOR EACH ROW EXECUTE FUNCTION require_published_featured_learning_map();
--> statement-breakpoint
CREATE FUNCTION reject_published_learning_map_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	version_to_check text;
BEGIN
	IF TG_TABLE_NAME = 'learning_map_version' THEN
		IF OLD.status = 'published' THEN
			RAISE EXCEPTION 'published learning map versions are immutable';
		END IF;
		RETURN NEW;
	END IF;

	version_to_check := CASE
		WHEN TG_OP = 'DELETE' THEN OLD.version_id
		ELSE NEW.version_id
	END;
	IF EXISTS (
		SELECT 1 FROM learning_map_version
		WHERE id = version_to_check AND status = 'published'
	) THEN
		RAISE EXCEPTION 'published learning map versions are immutable';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER learning_map_version_immutable
BEFORE UPDATE ON learning_map_version
FOR EACH ROW EXECUTE FUNCTION reject_published_learning_map_mutation();
--> statement-breakpoint
CREATE TRIGGER learning_map_node_immutable
BEFORE INSERT OR UPDATE OR DELETE ON learning_map_node
FOR EACH ROW EXECUTE FUNCTION reject_published_learning_map_mutation();
--> statement-breakpoint
CREATE TRIGGER learning_map_prerequisite_immutable
BEFORE INSERT OR UPDATE OR DELETE ON learning_map_prerequisite
FOR EACH ROW EXECUTE FUNCTION reject_published_learning_map_mutation();
--> statement-breakpoint
CREATE TRIGGER knowledge_source_immutable
BEFORE INSERT OR UPDATE OR DELETE ON knowledge_source
FOR EACH ROW EXECUTE FUNCTION reject_published_learning_map_mutation();
--> statement-breakpoint
CREATE TRIGGER learning_map_node_source_immutable
BEFORE INSERT OR UPDATE OR DELETE ON learning_map_node_source
FOR EACH ROW EXECUTE FUNCTION reject_published_learning_map_mutation();
--> statement-breakpoint
CREATE TRIGGER learning_viewpoint_immutable
BEFORE INSERT OR UPDATE OR DELETE ON learning_viewpoint
FOR EACH ROW EXECUTE FUNCTION reject_published_learning_map_mutation();
--> statement-breakpoint
CREATE TRIGGER learning_viewpoint_source_immutable
BEFORE INSERT OR UPDATE OR DELETE ON learning_viewpoint_source
FOR EACH ROW EXECUTE FUNCTION reject_published_learning_map_mutation();