document.addEventListener("DOMContentLoaded", function () {
    const registerForm = document.getElementById("register-form");
    const registerMessage = document.getElementById("register-message");

    registerForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const username = document.getElementById("new-username").value.trim();
        const email = document.getElementById("new-email").value.trim();
        const password = document.getElementById("new-password").value;
        const confirmPassword = document.getElementById("confirm-password").value;


        if (!username || !email || !password || !confirmPassword) {
            registerMessage.style.color = "red";
            registerMessage.textContent = "Please fill in all fields.";
            return;
        }

        if (password !== confirmPassword) {
            registerMessage.style.color = "red";
            registerMessage.textContent = "Passwords do not match.";
            return;
        }

        if (!window.supabaseClient) {
            registerMessage.style.color = "red";
            registerMessage.textContent =
                "Supabase is unavailable. Check your internet connection and reload the page.";
            return;
        }

        try {
            const { data, error } = await window.supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    data: { username, app_role: "supplier" },
                    emailRedirectTo: `${window.location.origin}/login.html`
                }
            });

            if (error) {
                registerMessage.style.color = "red";
                registerMessage.textContent = error.message;
                return;
            }

            if (data.session) {
                const { error: signOutError } =
                    await window.supabaseClient.auth.signOut();

                if (signOutError) {
                    console.error("Could not end signup session:", signOutError);
                    registerMessage.style.color = "red";
                    registerMessage.textContent =
                        "Account created, but sign-out failed. Please sign out before sharing this device.";
                    return;
                }
            }

            registerMessage.style.color = "green";
            const assignedRole = email.toLowerCase() === "justinregaspi11@gmail.com"
                ? "admin after email confirmation"
                : "supplier";
            registerMessage.textContent = data.session
                ? `Account created as ${assignedRole}. You can now sign in with your email and password.`
                : `Account created as ${assignedRole}. Check your email for a confirmation link, then sign in.`;

            registerForm.reset();
        } catch (error) {
            console.error("Supabase signup failed:", error);
            registerMessage.style.color = "red";
            registerMessage.textContent =
                "Could not connect to Supabase. Check your internet connection and try again.";
        }
    });
});
