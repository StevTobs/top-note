import { createClient } from "@supabase/supabase-js";

const url: string | undefined =
  import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const key: string | undefined =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && key);

// Placeholders keep module import safe when the env is missing (unit tests, first run);
// App shows a setup screen instead of calling the client in that case.
export const supabase = createClient(
  url || "http://127.0.0.1:54321",
  key || "missing-publishable-key",
  {
    auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true },
  },
);

export const ASSET_BUCKET = "note-assets";

export async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session)
    throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
  return data.session.user.id;
}

// Set by electron/preload.cjs when running inside the desktop app.
type Desktop = { callbackUrl: string; openExternal: (url: string) => void };
export const desktop: Desktop | undefined = (
  window as unknown as { topNoteDesktop?: Desktop }
).topNoteDesktop;

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: desktop ? desktop.callbackUrl : window.location.origin + "/",
      queryParams: { prompt: "select_account" },
      // Google refuses embedded webviews, so the desktop app signs in via the real browser.
      skipBrowserRedirect: !!desktop,
    },
  });
  if (!error && desktop && data.url) desktop.openExternal(data.url);
  return { error };
}

export function signOut() {
  return supabase.auth.signOut();
}

/** Turns a Supabase / PostgREST error into an Error with a Thai, user-facing message. */
export function fail(
  error: { message?: string; code?: string } | null,
  fallback: string,
): Error {
  const raw = error?.message || "";
  if (/Failed to fetch|NetworkError|Load failed/i.test(raw))
    return new Error(
      "เชื่อมต่อ Supabase ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่",
    );
  if (/JWT expired|not authenticated/i.test(raw) || error?.code === "PGRST301")
    return new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
  if (error?.code === "42501" || /row-level security/i.test(raw))
    return new Error(
      "ไม่มีสิทธิ์เข้าถึงข้อมูลนี้ (RLS) ตรวจสอบว่าได้รัน SQL migration แล้ว",
    );
  if (error?.code === "42P01" || error?.code === "PGRST205")
    return new Error(
      "ยังไม่พบตารางใน Supabase กรุณารัน supabase/migrations/0001_init.sql",
    );
  return new Error(raw ? `${fallback} (${raw})` : fallback);
}
