import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getServerRuntime } from "@/bootstrap/server";
import { MyLearningPage } from "@/components/my-learning-page";

export const dynamic = "force-dynamic";

type LearningRouteProps = Readonly<{
  searchParams: Promise<{ page?: string }>;
}>;

function parsePage(value: string | undefined): number | null {
  if (value === undefined) return 1;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : null;
}

export default async function LearningPage({
  searchParams,
}: LearningRouteProps) {
  const { identity } = getServerRuntime();
  const current = await identity.resolve(new Headers(await headers()));
  if (!current) redirect("/auth?next=/learning");

  const query = await searchParams;
  const page = parsePage(query.page);
  if (page === null) redirect("/learning?page=1");

  return <MyLearningPage email={current.email} initialPage={page} />;
}
