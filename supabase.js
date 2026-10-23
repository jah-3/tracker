const SUPABASE_URL = "https://pyxbhfnmzogsmsykoekd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_T6sQY3GIwNz32HB5_Zc5_w_-rwZKbFg";

if (!window.supabase) {
    throw new Error("Supabase SDK failed to load.");
}

window.supabaseClient = window.supabaseClient || window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);
