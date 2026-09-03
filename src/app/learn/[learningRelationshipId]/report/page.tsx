import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { LearningReportPage } from "@/components/learning-report-page";
import { identity } from "@/bootstrap/server";

export const dynamic = "force-dynamic";

type LearningReportRouteProps = Readonly<{
  params: Promise<{ learningRelationshipId: string }>;
}>;

export default async function LearningReportRoute({
  params,
}: LearningReportRouteProps) {
  const current = await identity.resolve(new Headers(await headers()));
  const { learningRelationshipId } = await params;
  if (!current) {
    redirect(
      `/auth?next=${encodeURIComponent(`/learn/${learningRelationshipId}/report`)}`,
    );
  }
  if (!learningRelationshipId) {
    redirect("/");
  }

  return (
    <LearningReportPage
      relationshipId={learningRelationshipId}
      email={current.email}
    />
  );
}
