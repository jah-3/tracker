document.addEventListener("DOMContentLoaded", async function () {
    const client = window.supabaseClient;
    const message = document.getElementById("driver-auth-message");
    const loginForm = document.getElementById("driver-login-form");
    const signupForm = document.getElementById("driver-signup-form");
    const loginButton = document.getElementById("driver-login-button");
    const signupButton = document.getElementById("driver-signup-button");

    function showMessage(text) {
        message.textContent = text;
    }

    async function routeByRole(user) {
        const { data, error } = await client
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .maybeSingle();
        if (error) throw new Error("Could not verify account role: " + error.message);

        const pages = {
            admin: "index.html",
            driver: "driver-dashboard.html",
            supplier: "supplier-dashboard.html"
        };
        const destination = pages[data?.role];
        if (!destination) {
            await client.auth.signOut();
            throw new Error("No role is assigned to this account. Run the Supabase setup SQL, then sign in again.");
        }
        window.location.replace(destination);
    }

    if (!client) {
        showMessage("Supabase is unavailable. Check supabase.js and reload.");
        return;
    }

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) {
        showMessage("Could not check sign-in: " + sessionError.message);
        return;
    }
    if (sessionData.session) {
        try {
            await routeByRole(sessionData.session.user);
        } catch (error) {
            console.error("Driver portal routing error:", error);
            showMessage(error.message);
        }
        return;
    }

    loginForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        loginButton.disabled = true;
        showMessage("Signing in...");
        const { data, error } = await client.auth.signInWithPassword({
            email: document.getElementById("driver-login-email").value.trim(),
            password: document.getElementById("driver-login-password").value
        });
        loginButton.disabled = false;
        if (error) {
            showMessage("Could not sign in: " + error.message);
            return;
        }
        try {
            await routeByRole(data.user);
        } catch (roleError) {
            console.error("Driver sign-in role error:", roleError);
            showMessage(roleError.message);
            await client.auth.signOut();
        }
    });

    signupForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        signupButton.disabled = true;
        showMessage("Creating driver account...");
        const { data, error } = await client.auth.signUp({
            email: document.getElementById("driver-signup-email").value.trim(),
            password: document.getElementById("driver-signup-password").value,
            options: {
                data: { app_role: "driver" },
                emailRedirectTo: `${window.location.origin}/driver.html`
            }
        });
        signupButton.disabled = false;
        if (error) {
            showMessage("Could not create driver account: " + error.message);
            return;
        }

        signupForm.reset();
        if (data.session && data.user) {
            try {
                await routeByRole(data.user);
            } catch (roleError) {
                console.error("Driver signup role error:", roleError);
                showMessage(roleError.message);
                await client.auth.signOut();
            }
        } else {
            showMessage("Account created. Confirm your email, then sign in to open your driver dashboard.");
        }
    });
});
