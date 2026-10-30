import { redirect } from "next/navigation";
import { requirePageUser } from "@/server/auth/current";

export default async function Home() {
  await requirePageUser();
  redirect("/dashboard");
}
