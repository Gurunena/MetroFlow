
document.addEventListener("DOMContentLoaded", async function () {
    const navbar = document.getElementById("navbar");

    if (navbar) {
        try {
            const response = await fetch("partials/navbar.html");

            if (!response.ok) {
                throw new Error("Navbar could not be loaded");
            }

            navbar.innerHTML = await response.text();
        } catch (error) {
            console.error("Navbar loading error:", error);
        }
    }
});
