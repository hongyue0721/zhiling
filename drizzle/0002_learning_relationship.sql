CREATE TABLE "learning_relationship" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"version_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "learning_relationship_user_version_unique" UNIQUE("user_id","version_id")
);
--> statement-breakpoint
ALTER TABLE "learning_relationship" ADD CONSTRAINT "learning_relationship_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_relationship" ADD CONSTRAINT "learning_relationship_version_id_learning_map_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."learning_map_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_relationship_version_id_idx" ON "learning_relationship" USING btree ("version_id");