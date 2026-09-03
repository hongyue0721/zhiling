import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { GenerationPage } from "@/components/generation-page";
import { identity } from "@/bootstrap/server";

export const dynamic = "force-dynamic";

type GenerationRouteProps = Readonly<{
  searchParams: Promise<{
    topic?: string;
  }>;
}>;

export default async function GeneratePage({
  searchParams,
}: GenerationRouteProps) {
  const current = await identity.resolve(new Headers(await headers()));
  if (!current) {
    redirect(`/auth?next=${encodeURIComponent("/generate")}`);
  }

  const { topic } = await searchParams;
  const initialTopic =
    topic && topic.trim().length <= 200 ? topic.trim() : undefined;
  return <GenerationPage email={current.email} initialTopic={initialTopic} />;
}
