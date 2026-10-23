document.addEventListener("DOMContentLoaded", async function () {
    const supabaseClient = window.supabaseClient;
    if (!supabaseClient) {
        window.location.replace("login.html");
        return;
    }

    const { data: sessionData, error: sessionError } =
        await supabaseClient.auth.getSession();
    if (sessionError || !sessionData.session) {
        console.error("Admin session check failed:", sessionError);
        sessionStorage.removeItem("isLoggedIn");
        window.location.replace("login.html");
        return;
    }

    const { data: roleData, error: roleError } = await supabaseClient
        .from("user_roles")
        .select("role")
        .eq("user_id", sessionData.session.user.id)
        .maybeSingle();

    if (roleError) {
        console.error("Admin role check failed:", roleError);
        window.alert("Could not verify your account role. Please sign in again.");
        await supabaseClient.auth.signOut();
        sessionStorage.removeItem("isLoggedIn");
        window.location.replace("login.html");
        return;
    }

    const rolePages = {
        driver: "driver-dashboard.html",
        supplier: "supplier-dashboard.html"
    };
    if (rolePages[roleData?.role]) {
        window.location.replace(rolePages[roleData.role]);
        return;
    }

    if (roleData?.role !== "admin") {
        window.alert("This account has no valid role. Contact your administrator.");
        await supabaseClient.auth.signOut();
        sessionStorage.removeItem("isLoggedIn");
        window.location.replace("login.html");
    }
});
