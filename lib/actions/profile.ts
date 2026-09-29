"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fail } from "@/lib/errors";

export async function updateMyName(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const name = String(form.get("full_name") ?? "").trim();
  if (!name || name.length > 120) return { ok: false, message: "Enter your name (up to 120 characters)." };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("profiles").update({ full_name: name }).eq("id", auth.user!.id);
  if (error) return fail(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "Name saved" };
}
