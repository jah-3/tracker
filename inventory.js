
document.addEventListener("DOMContentLoaded", function () {
    const currentPage = window.location.pathname.split("/").pop();
    if (currentPage !== "inventory.html") return;

    let products = [];
    const supabaseClient = window.supabaseClient;

    const searchInput = document.getElementById("search-input");
    const filterSelect = document.getElementById("stock-filter");

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    async function requireSession() {
        if (!supabaseClient) {
            throw new Error("Supabase is unavailable. Reload the page and try again.");
        }

        const { data: sessionData, error: sessionError } =
            await supabaseClient.auth.getSession();

        if (sessionError) {
            throw new Error("Could not verify your sign-in. Please sign in again.");
        }

        const accessToken = sessionData.session?.access_token;
        if (!accessToken) {
            sessionStorage.removeItem("isLoggedIn");
            window.location.replace("login.html");
            throw new Error("Please sign in to access inventory.");
        }

        return sessionData.session;
    }

    // Load products from Supabase
    async function loadProducts() {
        try {
            await requireSession();
            const { data, error } = await supabaseClient
                .from("products")
                .select("id, name, sku, category, stock, min_stock, warehouse, price")
                .order("id", { ascending: false });

            if (error) throw error;
            products = data;

            renderInventory();
            filterInventory();
        } catch (error) {
            console.error("Load products error:", error);
            alert("Could not load products: " + error.message);
        }
    }

    // Inventory summary
    function renderInventory() {
        const lowStock = products.filter(
            product => Number(product.stock) > 0 &&
                Number(product.stock) <= Number(product.min_stock ?? 5)
        ).length;

        const outOfStock = products.filter(
            product => Number(product.stock) <= 0
        ).length;

        const inStock = products.filter(
            product => Number(product.stock) > Number(product.min_stock ?? 5)
        ).length;

        setText("total-products", products.length);
        setText("in-stock", inStock);
        setText("low-stock", lowStock);
        setText("out-of-stock", outOfStock);
    }

    // Render inventory table
    function renderTable(items) {
        const tableBody = document.getElementById("inventory-table");
        if (!tableBody) return;

        tableBody.innerHTML = "";

        if (items.length === 0) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 7;
            cell.textContent = "No inventory records yet.";
            row.appendChild(cell);
            tableBody.appendChild(row);
            return;
        }

        items.forEach(product => {
            const row = document.createElement("tr");
            const stock = Number(product.stock) || 0;
            const minimum = Number(product.min_stock ?? 5);

            const status = stock <= 0
                ? "Out of Stock"
                : stock <= minimum
                    ? "Low Stock"
                    : "In Stock";

            [
                product.id,
                product.name,
                product.sku,
                product.category || "General",
                stock,
                status
            ].forEach(value => {
                const cell = document.createElement("td");
                cell.textContent = value ?? "";
                row.appendChild(cell);
            });

            const actions = document.createElement("td");

            function makeButton(label, callback, color = "") {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = label;
                button.style.margin = "3px";
                button.style.padding = "6px 9px";
                button.style.cursor = "pointer";

                if (color) {
                    button.style.backgroundColor = color;
                    button.style.color = "white";
                    button.style.border = "none";
                    button.style.borderRadius = "4px";
                }

                button.addEventListener("click", callback);
                actions.appendChild(button);
            }

            makeButton("Stock In", () => adjustStock(product.id, "in"));
            makeButton("Stock Out", () => adjustStock(product.id, "out"));
            makeButton("Edit", () => editProduct(product.id));
            makeButton("Delete", () => deleteProduct(product.id), "#dc2626");

            row.appendChild(actions);
            tableBody.appendChild(row);
        });
    }

    // Search and filter products
    function filterInventory() {
        const searchTerm = searchInput
            ? searchInput.value.trim().toLowerCase()
            : "";

        const selectedFilter = filterSelect
            ? filterSelect.value
            : "all";

        const filteredProducts = products.filter(product => {
            const matchesSearch =
                String(product.name || "").toLowerCase().includes(searchTerm) ||
                String(product.sku || "").toLowerCase().includes(searchTerm) ||
                String(product.warehouse || "").toLowerCase().includes(searchTerm);

            const stock = Number(product.stock) || 0;
            const minimum = Number(product.min_stock ?? 5);

            const matchesFilter =
                selectedFilter === "all" ||
                (selectedFilter === "in-stock" && stock > minimum) ||
                (selectedFilter === "low-stock" && stock > 0 && stock <= minimum) ||
                (selectedFilter === "out-of-stock" && stock <= 0);

            return matchesSearch && matchesFilter;
        });

        renderTable(filteredProducts);
    }

    document
  .getElementById("add-product-button")
  ?.addEventListener("click", addProduct);

    // Add product
    async function addProduct() {
        while (true) {
            const name = prompt("Product name:");
            if (name === null || !name.trim()) return;

            const sku = prompt("SKU / Product code:");
            if (sku === null || !sku.trim()) return;

            const category = prompt("Category:", "General");
            if (category === null) return;

            const stockInput = prompt("Starting stock quantity:", "0");
            if (stockInput === null || stockInput.trim() === "") return;

            const stock = Number(stockInput);
            if (!Number.isSafeInteger(stock) || stock < 0) {
                alert("Enter a whole number of 0 or higher.");
                return;
            }

            const minimumInput = prompt("Minimum stock:", "5");
            if (minimumInput === null || minimumInput.trim() === "") return;

            const min_stock = Number(minimumInput);
            if (!Number.isSafeInteger(min_stock) || min_stock < 0) {
                alert("Enter a valid minimum stock.");
                return;
            }

            const warehouse = prompt("Warehouse name:", "Warehouse A");
            if (warehouse === null) return;

            const priceInput = prompt("Unit price:", "0");
            if (priceInput === null || priceInput.trim() === "") return;

            const price = Number(priceInput);
            if (!Number.isFinite(price) || price < 0) {
                alert("Enter a valid price.");
                return;
            }

            try {
                await requireSession();
                const { error } = await supabaseClient
                    .from("products")
                    .insert({
                        name: name.trim(),
                        sku: sku.trim(),
                        category: category.trim() || "General",
                        stock,
                        min_stock,
                        warehouse: warehouse.trim(),
                        price
                    });

                if (error) throw error;

                alert("Product added successfully!");
                await loadProducts();
            } catch (error) {
                console.error(error);
                alert("Could not add product: " + error.message);
                return;
            }
        }
    }

    // Stock In / Stock Out
    async function adjustStock(id, type) {
        const product = products.find(
            item => Number(item.id) === Number(id)
        );

        if (!product) {
            alert("Product not found.");
            return;
        }

        const quantityInput = prompt(
            type === "in" ? "Enter quantity to add:" : "Enter quantity to remove:"
        );

        if (quantityInput === null) return;

        const quantity = Number(quantityInput);

        if (
            quantityInput.trim() === "" ||
            !Number.isSafeInteger(quantity) ||
            quantity <= 0
        ) {
            alert("Enter a positive whole number.");
            return;
        }

        try {
            await requireSession();
            const { data, error } = await supabaseClient.rpc(
                "adjust_product_stock",
                {
                    p_product_id: id,
                    p_type: type,
                    p_quantity: quantity
                }
            );
            if (error) throw error;
            const result = Array.isArray(data) ? data[0] : data;

            alert(
                "Stock updated successfully!\n" +
                "Previous stock: " + (result?.previous_stock ?? "N/A") + "\n" +
                "New stock: " + (result?.new_stock ?? "N/A")
            );

            await loadProducts();
        } catch (error) {
            alert("Could not update stock: " + error.message);
        }
    }

    // Edit product
    async function editProduct(id) {
        const product = products.find(
            item => Number(item.id) === Number(id)
        );

        if (!product) return;

        const name = prompt("Product name:", product.name);
        if (name === null || !name.trim()) return;

        const sku = prompt("SKU:", product.sku);
        if (sku === null || !sku.trim()) return;

        const category = prompt("Category:", product.category || "General");
        if (category === null) return;

        const minimumInput = prompt(
            "Minimum stock:",
            product.min_stock ?? 5
        );

        if (minimumInput === null || minimumInput.trim() === "") return;

        const min_stock = Number(minimumInput);
        if (!Number.isSafeInteger(min_stock) || min_stock < 0) {
            alert("Enter a valid minimum stock.");
            return;
        }

        const warehouse = prompt("Warehouse:", product.warehouse || "");
        if (warehouse === null) return;

        const priceInput = prompt("Unit price:", product.price ?? 0);
        if (priceInput === null || priceInput.trim() === "") return;

        const price = Number(priceInput);
        if (!Number.isFinite(price) || price < 0) {
            alert("Enter a valid price.");
            return;
        }

        try {
            await requireSession();
            const { error } = await supabaseClient
                .from("products")
                .update({
                    name: name.trim(),
                    sku: sku.trim(),
                    category: category.trim() || "General",
                    min_stock,
                    warehouse: warehouse.trim(),
                    price
                })
                .eq("id", id);

            if (error) throw error;

            alert("Product details updated!");
            await loadProducts();
        } catch (error) {
            alert("Could not update product: " + error.message);
        }
    }

    // Delete product
    async function deleteProduct(id) {
        const product = products.find(
            item => Number(item.id) === Number(id)
        );

        if (!product) return;
        if (!confirm("Delete " + product.name + "?")) return;

        try {
            await requireSession();
            const { error } = await supabaseClient
                .from("products")
                .delete()
                .eq("id", id);

            if (error) throw error;
            alert("Product deleted.");
            await loadProducts();
        } catch (error) {
            alert("Could not delete product: " + error.message);
        }
    }

    // Create Add Product button
    function setupAddButton() {
        const container = document.querySelector(".content-card .section-header");

        if (!container) {
            console.error("Inventory section header not found.");
            return;
        }

        if (document.getElementById("add-product-button")) return;

        const button = document.createElement("button");
        button.id = "add-product-button";
        button.type = "button";
        button.textContent = "+ Add Product";

        button.style.cssText =
            "background:#2563eb;color:white;border:0;border-radius:8px;" +
            "padding:12px 18px;cursor:pointer;font-weight:bold;";

        button.addEventListener("click", addProduct);
        container.appendChild(button);
    }

    if (searchInput) {
        searchInput.addEventListener("input", filterInventory);
    }

    if (filterSelect) {
        filterSelect.addEventListener("change", filterInventory);
    }

    setupAddButton();
    loadProducts();
});
