import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { LearningWorkspace } from "@/components/learning-workspace";
import { getServerRuntime } from "@/bootstrap/server";

export const dynamic = "force-dynamic";

type LearningWorkspaceRouteProps = Readonly<{
  params: Promise<{ learningRelationshipId: string }>;
  searchParams: Promise<{ node?: string }>;
}>;

export default async function LearningWorkspaceRoute({
  params,
  searchParams,
}: LearningWorkspaceRouteProps) {
  const { identity } = getServerRuntime();
  const current = await identity.resolve(new Headers(await headers()));
  const { learningRelationshipId } = await params;
  if (!current) {
    redirect(
      `/auth?next=${encodeURIComponent(`/learn/${learningRelationshipId}`)}`,
    );
  }
  if (!learningRelationshipId) {
    redirect("/");
  }

  const { node } = await searchParams;
  return (
    <LearningWorkspace
      relationshipId={learningRelationshipId}
      email={current.email}
      initialNodeId={node}
    />
  );
}
