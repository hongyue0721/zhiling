import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getServerRuntime } from "@/bootstrap/server";
import { FeaturedMapsPage } from "@/components/featured-maps-page";

export const dynamic = "force-dynamic";

type FeaturedRouteProps = Readonly<{
  searchParams: Promise<{ page?: string }>;
}>;

function parsePage(value: string | undefined): number | null {
  if (value === undefined) return 1;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : null;
}

export default async function FeaturedPage({
  searchParams,
}: FeaturedRouteProps) {
  const { identity } = getServerRuntime();
  const current = await identity.resolve(new Headers(await headers()));
  if (!current) redirect("/auth?next=/featured");

  const query = await searchParams;
  const page = parsePage(query.page);
  if (page === null) redirect("/featured?page=1");

  return <FeaturedMapsPage email={current.email} initialPage={page} />;
}
