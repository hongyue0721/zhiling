ALTER TABLE "learning_assessment_question_option" ADD COLUMN "side" text;--> statement-breakpoint
ALTER TABLE "learning_assessment_question_option" DISABLE TRIGGER "learning_assessment_question_option_immutable";--> statement-breakpoint
UPDATE "learning_assessment_question_option" AS option_row
SET "side" = CASE
	WHEN EXISTS (
		SELECT 1
		FROM "learning_assessment_question_matching_answer" AS matching_left
		WHERE matching_left."question_set_id" = option_row."question_set_id"
			AND matching_left."question_id" = option_row."question_id"
			AND matching_left."left_option_id" = option_row."option_id"
	)
		AND NOT EXISTS (
			SELECT 1
			FROM "learning_assessment_question_matching_answer" AS matching_right
			WHERE matching_right."question_set_id" = option_row."question_set_id"
				AND matching_right."question_id" = option_row."question_id"
				AND matching_right."right_option_id" = option_row."option_id"
		)
		THEN 'left'
	WHEN EXISTS (
		SELECT 1
		FROM "learning_assessment_question_matching_answer" AS matching_right
		WHERE matching_right."question_set_id" = option_row."question_set_id"
			AND matching_right."question_id" = option_row."question_id"
			AND matching_right."right_option_id" = option_row."option_id"
	)
		AND NOT EXISTS (
			SELECT 1
			FROM "learning_assessment_question_matching_answer" AS matching_left
			WHERE matching_left."question_set_id" = option_row."question_set_id"
				AND matching_left."question_id" = option_row."question_id"
				AND matching_left."left_option_id" = option_row."option_id"
		)
		THEN 'right'
	ELSE NULL
END
WHERE EXISTS (
	SELECT 1
	FROM "learning_assessment_question_matching_answer" AS matching_answer
	WHERE matching_answer."question_set_id" = option_row."question_set_id"
		AND matching_answer."question_id" = option_row."question_id"
		AND (
			matching_answer."left_option_id" = option_row."option_id"
			OR matching_answer."right_option_id" = option_row."option_id"
		)
);--> statement-breakpoint
ALTER TABLE "learning_assessment_question_option" ENABLE TRIGGER "learning_assessment_question_option_immutable";--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "learning_assessment_question_option" AS option_row
		INNER JOIN "learning_assessment_question" AS question_row
			ON question_row."question_set_id" = option_row."question_set_id"
			AND question_row."question_id" = option_row."question_id"
		WHERE question_row."type" = 'matching'
			AND option_row."side" IS NULL
	) THEN
		RAISE EXCEPTION 'existing matching assessment option has no unique side';
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "learning_assessment_question_option"	ADD CONSTRAINT "learning_assessment_question_option_side_check"	CHECK ("side" IS NULL OR "side" IN ('left', 'right'));--> statement-breakpoint
ALTER TABLE "learning_assessment_attempt" DROP CONSTRAINT "learning_assessment_attempt_relationship_question_set_key_unique";--> statement-breakpoint
ALTER TABLE "learning_assessment_attempt"	ADD CONSTRAINT "learning_assessment_attempt_relationship_question_set_node_key_unique"	UNIQUE("learning_relationship_id", "question_set_id", "node_id", "idempotency_key");