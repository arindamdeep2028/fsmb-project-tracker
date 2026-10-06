import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/auth/redirects";

/**
 * Sign out: POST only, and only from this site (the user menu's form). A link, an image or another site's form
 * cannot end someone's session. Deactivated accounts are signed out by the middleware, not through here.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ message: "Sign out from the app's menu." }, { status: 403 });
  }
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}

/** A GET changes nothing: it only leads back into the app. */
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
