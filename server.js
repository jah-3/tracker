
require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.use((req, res, next) => {
    const origin = req.get("Origin");
    const isLocalLiveServer =
        origin &&
        /^http:\/\/(localhost|127\.0\.0\.1):5502$/.test(origin);

    if (isLocalLiveServer) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        res.setHeader(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type"
        );

        if (req.method === "OPTIONS") {
            return res.sendStatus(204);
        }
    }

    next();
});

const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

async function requireSupabaseAuth(req, res, next) {
    const authorization = req.get("Authorization") || "";
    const token = authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : "";

    if (!token) {
        return res.status(401).json({ error: "Sign in to access products." });
    }

    if (!supabaseUrl || !supabasePublishableKey) {
        console.error("Supabase server authentication is not configured.");
        return res.status(503).json({
            error: "Authentication service is not configured."
        });
    }

    try {
        const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: {
                apikey: supabasePublishableKey,
                Authorization: `Bearer ${token}`
            }
        });

        if (response.status === 401 || response.status === 403) {
            return res.status(401).json({
                error: "Your session is invalid or expired. Please sign in again."
            });
        }

        if (!response.ok) {
            console.error(
                "Supabase token verification failed with status:",
                response.status
            );
            return res.status(503).json({
                error: "Could not verify your sign-in. Please try again."
            });
        }

        req.user = await response.json();
        next();
    } catch (error) {
        console.error("Supabase token verification error:", error);
        res.status(503).json({
            error: "Could not reach the authentication service."
        });
    }
}

const pool = mysql.createPool({
    host: process.env.DB_HOST || process.env.MYSQLHOST,
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT) || 3306,
    user: process.env.DB_USER || process.env.MYSQLUSER,
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD,
    database: process.env.DB_NAME || process.env.MYSQLDATABASE,
    waitForConnections: true,
    connectionLimit: 10
});


// Test the database connection.
app.get("/api/health", async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT DATABASE() AS databaseName"
        );

        res.json({
            success: true,
            message: "MySQL connected successfully!",
            database: rows[0].databaseName
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({
            success: false,
            message: "Database connection failed."
        });
    }
});

app.use("/api/products", requireSupabaseAuth);

app.get("/api/products", async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT id, name, sku, category, stock, min_stock, warehouse, price
            FROM products
            ORDER BY id DESC`
        );

        res.json(rows);
    } catch (error) {
        console.error("Load products error:", error);
        res.status(500).json({
            error: "Could not load products."
        });
    }
});

app.post("/api/products", async (req, res) => {
    try {
        const {
            name,
            sku,
            category,
            stock,
            min_stock,
            warehouse,
            price
        } = req.body;

        if (!name || !sku) {
            return res.status(400).json({
                error: "Product name and SKU are required."
            });
        }

        const [result] = await pool.execute(
            `INSERT INTO products
            (name, sku, category, stock, min_stock, warehouse, price)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                name.trim(),
                sku.trim(),
                category || "",
                Number(stock) || 0,
                Number(min_stock) || 0,
                warehouse || "",
                Number(price) || 0
            ]
        );

        res.status(201).json({
            success: true,
            message: "Product added successfully!",
            id: result.insertId
        });
    } catch (error) {
        console.error("Add product error:", error);

        res.status(500).json({
            error: error.code === "ER_DUP_ENTRY"
                ? "This SKU already exists."
                : error.message
        });
    }
});

app.put("/api/products/:id", async (req, res) => {
    const id = Number(req.params.id);
    const { name, sku, category, min_stock, warehouse, price } = req.body;

    if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({
            error: "A valid product ID is required."
        });
    }

    if (
        typeof name !== "string" ||
        !name.trim() ||
        typeof sku !== "string" ||
        !sku.trim()
    ) {
        return res.status(400).json({
            error: "Product name and SKU are required."
        });
    }

    const minimumStock = Number(min_stock);
    const unitPrice = Number(price);
    if (
        !Number.isSafeInteger(minimumStock) ||
        minimumStock < 0 ||
        !Number.isFinite(unitPrice) ||
        unitPrice < 0
    ) {
        return res.status(400).json({
            error: "Minimum stock and price must be valid non-negative numbers."
        });
    }

    try {
        const [result] = await pool.execute(
            `UPDATE products
            SET name = ?, sku = ?, category = ?, min_stock = ?, warehouse = ?, price = ?
            WHERE id = ?`,
            [
                name.trim(),
                sku.trim(),
                typeof category === "string" ? category.trim() : "",
                minimumStock,
                typeof warehouse === "string" ? warehouse.trim() : "",
                unitPrice,
                id
            ]
        );

        if (result.affectedRows === 0) {
            const [rows] = await pool.execute(
                "SELECT id FROM products WHERE id = ?",
                [id]
            );
            if (rows.length === 0) {
                return res.status(404).json({
                    error: "Product not found."
                });
            }
        }

        res.json({
            success: true,
            message: "Product updated successfully."
        });
    } catch (error) {
        console.error("Update product error:", error);
        res.status(500).json({
            error: error.code === "ER_DUP_ENTRY"
                ? "This SKU already exists."
                : "Could not update product."
        });
    }
});

app.post("/api/products/:id/stock", async (req, res) => {
    const id = Number(req.params.id);
    const { type, quantity } = req.body;

    if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({
            error: "A valid product ID is required."
        });
    }

    if (
        !["in", "out"].includes(type) ||
        !Number.isSafeInteger(quantity) ||
        quantity <= 0
    ) {
        return res.status(400).json({
            error: "Stock type must be 'in' or 'out', and quantity must be a positive whole number."
        });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [rows] = await connection.execute(
            "SELECT stock FROM products WHERE id = ? FOR UPDATE",
            [id]
        );

        if (rows.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                error: "Product not found."
            });
        }

        const previousStock = Number(rows[0].stock);
        const newStock = type === "in"
            ? previousStock + quantity
            : previousStock - quantity;

        if (type === "out" && newStock < 0) {
            await connection.rollback();
            return res.status(400).json({
                error: "Not enough stock available."
            });
        }

        if (!Number.isSafeInteger(newStock)) {
            await connection.rollback();
            return res.status(400).json({
                error: "The resulting stock quantity is invalid."
            });
        }

        await connection.execute(
            "UPDATE products SET stock = ? WHERE id = ?",
            [newStock, id]
        );
        await connection.commit();

        res.json({
            success: true,
            previousStock,
            newStock
        });
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Stock transaction rollback error:", rollbackError);
            }
        }
        console.error("Update stock error:", error);
        res.status(500).json({
            error: "Could not update product stock."
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

app.delete("/api/products/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({
            error: "A valid product ID is required."
        });
    }

    try {
        const [result] = await pool.execute(
            "DELETE FROM products WHERE id = ?",
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: "Product not found."
            });
        }

        res.json({
            success: true,
            message: "Product deleted successfully."
        });
    } catch (error) {
        console.error("Delete product error:", error);
        res.status(500).json({
            error: "Could not delete product."
        });
    }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}.`);
});
