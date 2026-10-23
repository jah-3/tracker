document.addEventListener("DOMContentLoaded", function () {
    const loginForm = document.getElementById("login-form");
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const rememberCheckbox = document.getElementById("remember");
    const loginMessage = document.getElementById("login-message");
    const resendConfirmationButton = document.getElementById(
        "resend-confirmation-button"
    );

    const savedUsername = localStorage.getItem("rememberUsername");

    if (savedUsername && usernameInput && rememberCheckbox) {
        usernameInput.value = savedUsername;
        rememberCheckbox.checked = true;
    }

    if (loginForm) {
        if (resendConfirmationButton) {
            resendConfirmationButton.addEventListener("click", async function () {
                const email = usernameInput.value.trim();

                if (!email || !email.includes("@")) {
                    loginMessage.textContent =
                        "Enter the email address you used to sign up.";
                    loginMessage.style.color = "red";
                    return;
                }

                resendConfirmationButton.disabled = true;
                loginMessage.textContent = "Sending confirmation email...";
                loginMessage.style.color = "";

                try {
                    const { error } = await window.supabaseClient.auth.resend({
                        type: "signup",
                        email,
                        options: {
                            emailRedirectTo: `${window.location.origin}/login.html`
                        }
                    });

                    if (error) {
                        throw error;
                    }

                    loginMessage.textContent =
                        "If the account can receive a confirmation email, Supabase has sent one. Check your inbox and spam folder.";
                    loginMessage.style.color = "green";
                } catch (error) {
                    console.error("Could not resend confirmation email:", error);
                    loginMessage.textContent =
                        error.message || "Could not resend the confirmation email.";
                    loginMessage.style.color = "red";
                } finally {
                    resendConfirmationButton.disabled = false;
                }
            });
        }

        loginForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            if (resendConfirmationButton) {
                resendConfirmationButton.hidden = true;
            }

            const username = usernameInput.value.trim();
            const password = passwordInput.value;

            if (!window.supabaseClient) {
                loginMessage.textContent =
                    "Supabase is unavailable. Check your internet connection and reload the page.";
                loginMessage.style.color = "red";
                return;
            }

            try {
                const { data, error } = await window.supabaseClient.auth.signInWithPassword({
                    email: username,
                    password
                });

                if (!error) {
                    const { data: roleData, error: roleError } =
                        await window.supabaseClient
                            .from("user_roles")
                            .select("role")
                            .eq("user_id", data.user.id)
                            .maybeSingle();

                    if (roleError || !roleData) {
                        console.error("Could not load account role:", roleError);
                        await window.supabaseClient.auth.signOut();
                        loginMessage.textContent =
                            "No role was found for this account. Run the complete Supabase setup SQL in the app's configured project, then sign in again.";
                        loginMessage.style.color = "red";
                        return;
                    }

                    sessionStorage.setItem("isLoggedIn", "true");

                    if (rememberCheckbox.checked) {
                        localStorage.setItem("rememberUsername", username);
                    } else {
                        localStorage.removeItem("rememberUsername");
                    }

                    const rolePages = {
                        admin: "index.html",
                        driver: "driver-dashboard.html",
                        supplier: "supplier-dashboard.html"
                    };
                    window.location.href = rolePages[roleData.role] || "login.html";
                    return;
                }

                loginMessage.textContent = error.message;
                loginMessage.style.color = "red";
                if (
                    resendConfirmationButton &&
                    (error.code === "email_not_confirmed" ||
                        error.message.toLowerCase().includes("email not confirmed"))
                ) {
                    resendConfirmationButton.hidden = false;
                }
            } catch (error) {
                console.error("Supabase sign-in failed:", error);
                loginMessage.textContent =
                    "Could not connect to Supabase. Check your internet connection and try again.";
                loginMessage.style.color = "red";
            }
        });
    }
});
