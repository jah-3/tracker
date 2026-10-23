document.querySelectorAll("[data-portal-switch]").forEach(link => {
    link.addEventListener("click", async function (event) {
        event.preventDefault();
        link.setAttribute("aria-disabled", "true");

        const client = window.supabaseClient;
        if (!client) {
            link.removeAttribute("aria-disabled");
            window.alert("Could not switch portals because Supabase is unavailable. Please try again.");
            return;
        }

        try {
            const { error } = await client.auth.signOut({ scope: "local" });
            if (error) throw error;

            sessionStorage.removeItem("isLoggedIn");
            window.location.assign(link.href);
        } catch (error) {
            console.error("Portal switch failed:", error);
            link.removeAttribute("aria-disabled");
            window.alert("Could not switch portals: " + error.message);
        }
    });
});
