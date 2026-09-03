import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { HomePage } from "@/components/home-page";
import { getServerRuntime } from "@/bootstrap/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { identity, generationRequestsEnabled } = getServerRuntime();
  const current = await identity.resolve(new Headers(await headers()));
  if (!current) {
    redirect("/auth?next=/");
  }

  return (
    <HomePage
      email={current.email}
      generationRequestsEnabled={generationRequestsEnabled}
    />
  );
}
