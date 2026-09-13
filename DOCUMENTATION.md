7. Calls `sendToken(...)` to create a JWT and response cookie.

# E-commerce Backend Documentation

This document explains the current Node.js and Express backend step by step. It describes what each file does, how a request moves through the application, how the PostgreSQL tables are related, how to run the project, and which parts still need implementation.

For a beginner-friendly, function-by-function explanation of the authentication, product, and admin controllers, see [CONTROLLERS_DOCUMENTATION.md](CONTROLLERS_DOCUMENTATION.md). It includes route connections, middleware flow, database queries, Cloudinary uploads, AI search, response shapes, and current implementation notes.

## 1. What This Project Uses

- **Node.js**: runs JavaScript on the server.
- **Express**: creates the HTTP API and manages middleware and routes.
- **PostgreSQL**: stores users, products, orders, reviews, shipping, and payment data.
- **`pg`**: connects Node.js to PostgreSQL.
- **`bcrypt`**: hashes passwords before they are stored.
- **`jsonwebtoken`**: creates login tokens.
- **`cookie-parser`**: reads cookies from requests.
- **`cors`**: allows the configured frontend applications to call the API.
- **`express-fileupload`**: accepts uploaded files through HTTP requests.
- **Cloudinary**: is configured for media storage in `server.js`.
- **Stripe and Nodemailer**: are listed as dependencies and configured in the environment file, but are not used by the current source code yet.

## 2. Project Structure

```text
server/
├── app.js                         Express application and middleware
├── server.js                      Application entry point
├── package.json                   Dependencies and npm scripts
├── config/config.env              Local environment configuration
├── controllers/authController.js  Authentication business logic
├── database/db.js                 PostgreSQL connection pool
├── middlewares/
│   ├── catchAsyncError.js         Sends async errors to Express
│   └── errorMiddleware.js         Sends consistent error responses
├── models/                       SQL table creation functions
├── router/authRouters.js          Authentication endpoint definitions
└── utils/
    ├── createTables.js            Creates all tables at startup
    └── jwtTocken.js               Creates a JWT and auth cookie
```

## 3. How To Run The Backend

### Prerequisites

Install:

1. Node.js and npm.
2. PostgreSQL.
3. A PostgreSQL database named in `DB_NAME`.

The `users` table uses `gen_random_uuid()`, so PostgreSQL must have the `pgcrypto` extension enabled:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### Install dependencies

Open a terminal in the `server` directory:

```powershell
cd "C:\Users\ASUS\Documents\E-commerce\server"
npm install
```

### Configure environment variables

Edit [config/config.env](config/config.env). It contains the port, frontend origins, database settings, JWT settings, and third-party service settings.

Never commit real passwords, JWT secrets, API keys, SMTP passwords, or Cloudinary secrets. Replace exposed credentials and keep this file out of version control. Use a safe example file such as `config.env.example` for shared documentation.

### Start the server

Development mode automatically restarts after file changes:

```powershell
npm run dev
```

Production-style start:

```powershell
npm start
```

Run these commands from `server`, because that is where [package.json](package.json) exists. A successful startup currently prints messages for the database connection, port `4000`, and all seven tables.

## 4. Startup Flow

### Step 1: `server.js` imports the Express app

[server.js](server.js) imports the configured app and Cloudinary. Cloudinary receives its values from `process.env`:

```js
import app from "./app.js";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLIENT_NAME,
  api_key: process.env.CLOUDINARY_CLIENT_API,
  api_secret: process.env.CLOUDINARY_CLIENT_SECRET,
});
```

The final step starts the HTTP server:

```js
app.listen(process.env.PORT, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});
```

### Step 2: `app.js` creates and configures Express

[app.js](app.js) creates the Express instance, loads `config/config.env`, and registers middleware.

Middleware runs before route handlers:

1. `cors(...)` allows requests from `FRONTEND_URL` and `DASHBOARD_URL` and allows cookies.
2. `cookieParser()` makes incoming cookies available through `req.cookies`.
3. `express.json()` parses JSON request bodies into `req.body`.
4. `express.urlencoded(...)` parses form-style request bodies.
5. `fileUpload(...)` provides temporary file uploads.

### Step 3: The router is mounted

```js
app.use("/api/v1/auth", authRouter);
```

This prefix is combined with each path in [router/authRouters.js](router/authRouters.js). For example, `router.post("/register", register)` becomes:

```text
POST /api/v1/auth/register
```

### Step 4: Tables are created

`createTables()` calls each table function in dependency order. It creates users first, then products and reviews, followed by orders, order items, shipping, and payments.

### Step 5: Errors are handled last

`errorMiddleware` is registered after the routes. Controllers call `next(error)` and [middlewares/errorMiddleware.js](middlewares/errorMiddleware.js) converts the error into JSON:

```json
{
  "success": false,
  "message": "A useful error message"
}
```

## 5. Database Connection

[database/db.js](database/db.js) creates a PostgreSQL `Pool`:

```js
const database = new Pool({
  user: "postgres",
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: "12345678",
  port: process.env.DB_PORT,
});
```

Controllers and model functions use `database.query(sql, values)` to execute parameterized SQL. Parameters such as `$1`, `$2`, and `$3` are important because they prevent user input from being inserted directly into SQL strings.

### Important configuration improvement

The database module is imported through static imports before the body of `app.js` calls `config(...)`. This can make environment loading order fragile. A robust future structure is to load environment variables in the entry point before importing modules that create the database pool, for example with a dedicated bootstrap file or the `dotenv/config` preload option.

Also move the database password from source code into `DB_PASSWORD` in the environment file.

## 6. Database Tables

Table creation functions are in the [models](models) directory. Every table uses a UUID primary key generated by PostgreSQL.

### `users`

Created by [models/userTable.js](models/userTable.js).

- `id`: UUID primary key.
- `name`: required, at least two characters.
- `email`: required and unique.
- `password`: required hashed password.
- `role`: `User` or `Admin`, default `User`.
- `avatar`: optional JSON data.
- Password reset token and expiry fields.
- Creation and update timestamps.

### `products`

Created by [models/productsTable.js](models/productsTable.js).

- Product name, description, category, price, stock, ratings, and images.
- `created_by` references `users(id)`.
- Deleting the owning user cascades to their products.

### `reviews`

Created by [models/productReviewsTable.js](models/productReviewsTable.js).

- `product_id` references `products(id)`.
- `user_id` references `users(id)`.
- Rating must be between `0` and `5`.
- Deleting the product or user deletes related reviews.

### `orders`

Created by [models/ordersTable.js](models/ordersTable.js).

- `buyer_id` references `users(id)`.
- Stores total, tax, shipping, status, and payment time.
- Status is `Processing`, `Shipped`, `Delivered`, or `Cancelled`.

### `order_items`

Created by [models/orderItemsTable.js](models/orderItemsTable.js).

- Connects an order to products.
- Stores quantity and a snapshot of the product price, image, and title.
- Both `order_id` and `product_id` are foreign keys.

### `shipping_info`

Created by [models/shippingInfoTable.js](models/shippingInfoTable.js).

- Stores the delivery name, address, location, pincode, and phone.
- `order_id` is unique, so each order has at most one shipping record.

### `payments`

Created by [models/paymentsTable.js](models/paymentsTable.js).

- `order_id` is unique, so each order has at most one payment record.
- Payment type is currently restricted to `Online`.
- Status is `Paid`, `Pending`, or `Failed`.
- `payment_intent_id` is optional and unique.

## 7. Authentication Request Flow

### Register a user

Endpoint: `POST /api/v1/auth/register`

Example request:

```json
{
  "name": "Muhammad",
  "email": "user@example.com",
  "password": "a-strong-password"
}
```

The handler in [controllers/authController.js](controllers/authController.js) performs these steps:

1. Reads `name`, `email`, and `password` from `req.body`.
2. Rejects the request if any required value is missing.
3. Searches for an existing user using a parameterized query.
4. Rejects duplicate email addresses.
5. Hashes the password with `bcrypt.hash(password, 10)`.
6. Inserts the user into PostgreSQL.
7. Calls `sendTocken(...)` to create a JWT and response cookie.

Successful response shape:

```json
{
  "success": true,
  "user": {},
  "message": "User registered successfully",
  "token": "..."
}
```

The password should not be returned in the `user` object. The current query uses `RETURNING *`, so the response currently risks exposing the hashed password. A production implementation should explicitly select safe columns or remove `password` before responding.

### Login, current-user, and logout

The router defines these endpoints:

| Method | Endpoint              | Current status            |
| ------ | --------------------- | ------------------------- |
| `POST` | `/api/v1/auth/login`  | Implemented               |
| `GET`  | `/api/v1/auth/me`     | Implemented and protected |
| `GET`  | `/api/v1/auth/logout` | Implemented and protected |

The `me` and `logout` endpoints use authentication middleware. The middleware reads the cookie, verifies the token with `JWT_SECRET_KEY`, loads the user from PostgreSQL, and places the user on `req.user`.
The helper is named `sendToken`. The filename `jwtTocken.js` contains the older spelling, but the exported function and its imports use the correct `sendToken` spelling.

These handlers need to be implemented before the full authentication workflow works. They also need an authentication middleware that reads the token, verifies it with `JWT_SECRET_KEY`, and places the user identity on the request.

## 8. JWT Cookie Helper

[utils/jwtTocken.js](utils/jwtTocken.js) signs a token containing the user ID:

```js
const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET_KEY, {
  expiresIn: process.env.JWT_EXPIRES_IN,
});
```

It sends the token both as JSON and as an HTTP-only cookie. HTTP-only prevents browser JavaScript from reading the cookie, which reduces exposure to token theft through client-side scripts.

Recommended production cookie options include `secure: true` over HTTPS and an appropriate `sameSite` value. The helper name is currently spelled `sendTocken`; renaming it to `sendToken` would improve clarity, but all imports and usages must be updated together.

## 9. Async Error Handling

[middlewares/catchAsyncError.js](middlewares/catchAsyncError.js) wraps an async controller:

```js
export const catchAsyncErrors = (theFunc) => {
  return (req, res, next) => {
    Promise.resolve(theFunc(req, res, next)).catch(next);
  };
};
```

Without this wrapper, a rejected promise could bypass normal Express error handling. With it, the rejected error is passed to `errorMiddleware`.

## 10. Testing The Current Endpoint

After starting the server, test registration with PowerShell:

```powershell
$body = @{
  name = "Test User"
  email = "test@example.com"
  password = "strong-password"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:4000/api/v1/auth/register" `
  -ContentType "application/json" `
  -Body $body
```

Expected behavior:

- A new email creates a user and returns status `201`.
- Missing fields return status `400`.
- A duplicate email returns status `400`.

## 11. Recommended Next Steps

1. Implement `login`, `getUser`, and `logout`.
2. Add authentication middleware for protected endpoints.
3. Remove the password from registration responses.
4. Move the database password into `config.env` and rotate any exposed credentials.
5. Load environment variables before database initialization.
6. Add request validation for email format, password strength, prices, quantities, and IDs.
7. Add indexes for frequently queried foreign keys and email.
8. Add automated tests and replace the placeholder `npm test` script.
9. Add product, review, order, payment, and shipping controllers and routers.
10. Use migrations for schema changes instead of relying only on `CREATE TABLE IF NOT EXISTS` at application startup.

## 12. Summary

The backend currently has a working Express startup, PostgreSQL connection, automatic table creation, and authentication controllers for registration, login, current-user lookup, logout, forgot password, and reset password. The authentication router is mounted at `/api/v1/auth`, and the database schema already models the main e-commerce entities.

## 13. Complete Source-Code Walkthrough

This section explains the code in the order Node.js loads it and Express executes it. In JavaScript, `import` loads another module, `export` makes a value available to another module, `async` allows `await`, and `await` pauses the current function until a promise finishes.

### 13.1 `package.json`

```json
"type": "module"
```

This enables ES module syntax, so the project uses `import` and `export`.

```json
"start": "node server.js",
"dev": "nodemon server.js"
```

`npm start` runs the server once. `npm run dev` runs it with automatic restarting after file changes. The dependencies provide Express, PostgreSQL, bcrypt, JWT, cookies, email, uploads, CORS, Cloudinary, and Stripe.

### 13.2 `server.js`: starting the application

```js
import app from "./app.js";
```

This imports the Express application. While `app.js` is loading, Node.js also loads its router, controllers, database, middleware, and table modules.

```js
import { v2 as cloudinary } from "cloudinary";
```

This imports Cloudinary version two and gives it the local name `cloudinary`.

```js
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLIENT_NAME,
  api_key: process.env.CLOUDINARY_CLIENT_API,
  api_secret: process.env.CLOUDINARY_CLIENT_SECRET,
});
```

This configures Cloudinary with values from environment variables. Keeping configuration outside source code makes it possible to use different credentials in development and production.

```js
app.listen(process.env.PORT, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});
```

This starts the HTTP server. The callback runs after Node.js begins listening. `server.js` starts the application; route definitions live in the router files.

### 13.3 `app.js`: configuring Express

```js
import express from "express";
const app = express();
```

`express` is imported, then called to create the application object. The object stores middleware and routes.

```js
config({ path: "./config/config.env" });
```

Dotenv reads the configuration file and places its values into `process.env`.

```js
app.use(cors({ ... }));
```

This runs CORS before routes. It permits the configured frontend and dashboard origins, permits the listed HTTP methods, and allows cookies with `credentials: true`.

```js
app.use(cookieParser());
```

This parses the incoming `Cookie` header. Authentication can then read `req.cookies.token`.

```js
app.use(express.json());
```

This parses JSON request bodies. A Postman JSON body becomes available as `req.body`.

```js
app.use(express.urlencoded({ extended: true }));
```

This parses form-style URL-encoded bodies. `extended: true` supports nested objects and arrays.

```js
app.use(
  fileUpload({
    tempFileDir: "./uploads",
    useTempFiles: true,
  }),
);
```

This enables multipart file uploads and stores temporary files in `./uploads`. The current authentication endpoints do not use files yet.

```js
app.use("/api/v1/auth", authRouter);
```

This mounts the router under a prefix. A router path `/register` therefore becomes the complete URL `/api/v1/auth/register`.

```js
createTables();
```

This begins table creation. The function is asynchronous, but this call is not awaited, so the server can begin listening while table creation continues.

```js
app.use(errorMiddleware);
```

This is registered after the routes so errors passed to `next(error)` are handled by one central function.

### 13.4 `database/db.js`: connecting to PostgreSQL

```js
import pkg from "pg";
const { Pool } = pkg;
```

The PostgreSQL package is imported and its `Pool` constructor is extracted.

```js
const database = new Pool({ ... });
```

The pool manages reusable database connections. Controllers and models share this exported object.

```js
await database.connect();
```

This verifies the database connection during startup. A failure is logged and `process.exit(1)` stops the application. Later code executes SQL with `database.query(sql, values)`.

The current source has a hard-coded database password and port. Move those values into `config.env`, preferably as `DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, and `DB_PORT`.

### 13.5 `createTables.js` and the model files

`createTables()` calls the table functions in dependency order:

1. `createUserTable()` creates `users`.
2. `createProductsTable()` creates `products`, which references users.
3. `createProductReviewsTable()` creates `reviews`, which references users and products.
4. `createOrdersTable()` creates `orders`, which references users.
5. `createOrderItemTable()` creates `order_items`, which references orders and products.
6. `createShippingInfoTable()` creates `shipping_info`, which references orders.
7. `createPaymentsTable()` creates `payments`, which references orders.

Every model follows this pattern:

```js
export async function createSomethingTable() {
  try {
    const query = `CREATE TABLE IF NOT EXISTS ...`;
    await database.query(query);
    console.log("Table created successfully");
  } catch (error) {
    console.error("Failed to create table", error);
    process.exit(1);
  }
}
```

The function is exported so `createTables.js` can call it. The SQL is stored in a template string. `IF NOT EXISTS` makes repeated startup safe. `await database.query` sends the SQL to PostgreSQL. `NOT NULL`, `CHECK`, `UNIQUE`, and foreign-key constraints enforce database rules. `ON DELETE CASCADE` removes child records when their parent is deleted.

### 13.6 `router/authRouters.js`: mapping URLs to controllers

```js
const router = express.Router();
```

This creates a route collection separate from the main app.

```js
router.post("/register", register);
router.post("/login", login);
router.get("/me", isAuthenticated, getUser);
router.get("/logout", isAuthenticated, logout);
router.post("/password/forgot", forgotPassword);
router.put("/password/reset/:token", resetPassword);
```

The first argument is the path suffix. The other arguments run from left to right. On `/me` and `/logout`, `isAuthenticated` must succeed before the controller runs. `:token` is stored in `req.params.token`.

### 13.7 `catchAsyncError.js`: forwarding async failures

```js
export const catchAsyncErrors = (theFunc) => {
  return (req, res, next) => {
    Promise.resolve(theFunc(req, res, next)).catch(next);
  };
};
```

The outer function accepts an async controller. It returns the function Express expects. If the controller rejects a promise, `.catch(next)` sends that error to `errorMiddleware`.

### 13.8 `authController.js`: request processing

Each controller receives `req`, `res`, and `next`. `req` contains request data, `res` sends the response, and `next` passes control or an error to the next middleware.

#### Registration: `POST /api/v1/auth/register`

1. Destructure `name`, `email`, and `password` from `req.body`.
2. Reject missing values with `new ErrorHandler(..., 400)`.
3. Reject passwords shorter than 8 or longer than 16 characters.
4. Query PostgreSQL for an existing email using `$1` and a values array.
5. Reject duplicate emails with status `400`.
6. Hash the password with `bcrypt.hash(password, 10)`.
7. Insert the name, email, and hash into `users`.
8. Call `sendToken(user.rows[0], 201, ..., res)`.

`$1` is a parameter placeholder. The value is supplied separately, so user input is not concatenated into SQL.

#### Login: `POST /api/v1/auth/login`

1. Read email and password from the JSON body.
2. Reject missing fields with status `400`.
3. Find the user by email.
4. Return generic status `401` if the email does not exist.
5. Compare the submitted password with the stored bcrypt hash.
6. Return status `401` if the comparison fails.
7. Call `sendToken` with status `200` when it succeeds.

#### Current user: `GET /api/v1/auth/me`

`isAuthenticated` first loads the authenticated user into `req.user`. `getUser` then returns that object with `success: true`.

#### Logout: `GET /api/v1/auth/logout`

After authentication succeeds, the controller sets the `token` cookie to an expiry date in the past. Browsers remove the cookie and the response says logout was successful.

### 13.9 `authMiddleware.js`: protecting routes

```js
const { token } = req.cookies;
```

This reads the cookie created by `sendToken`. If it does not exist, the middleware returns status `401`.

```js
const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
```

This checks the JWT signature and expiry. The payload contains the user ID.

```js
const user = await database.query("SELECT * FROM users WHERE id = $1 limit 1", [
  decoded.id,
]);
req.user = user.rows[0];
next();
```

The middleware loads the user, attaches it to the request, and calls `next()` so the protected controller can run. `authorizedRoles(...roles)` performs a second check against `req.user.role` and returns `403` when the role is not allowed.

### 13.10 Forgot and reset password

#### Forgot password: `POST /api/v1/auth/password/forgot`

1. Read `email` from `req.body` and `frontendUrl` from `req.query`.
2. Find the user by email.
3. Generate a random public token, its SHA-256 hash, and a fifteen-minute expiry.
4. Store only the hash and expiry in the database.
5. Build the frontend reset URL with the public token.
6. Generate the HTML email.
7. Send the email with Nodemailer.
8. If sending fails, clear the reset fields and return status `500`.

#### Reset password: `PUT /api/v1/auth/password/reset/:token`

For the Postman request, the token belongs in the URL and the body is:

```json
{
  "password": "00000000",
  "confirmPassword": "00000000"
}
```

1. Read the public token from `req.params.token`.
2. Hash it with SHA-256.
3. Find a user with the same stored hash and an expiry later than `NOW()`.
4. Reject an invalid or expired token with status `400`.
5. Compare the two submitted passwords.
6. Validate the password length.
7. Hash the new password with bcrypt.
8. Update the password and clear the reset token and expiry.
9. Call `sendToken` to create a new login token and return status `200`.

The previous `sendTocken is not defined` error was caused by a spelling mismatch. The current controller imports and calls `sendToken`, and `jwtTocken.js` exports `sendToken`, so these names now match. The filename still contains the old spelling, but that does not affect the exported function.

### 13.11 `generateResetPasswordToken.js`

```js
const resetToken = crypto.randomBytes(20).toString("hex");
```

This creates a random token that can be sent to the user.

```js
const hashedToken = crypto
  .createHash("sha256")
  .update(resetToken)
  .digest("hex");
```

This creates the database value. The server sends the original token but stores only its hash, so the original token is not stored in plaintext.

```js
const resetPasswordExpireTime = Date.now() + 15 * 60 * 1000;
```

This sets the expiry fifteen minutes into the future.

### 13.12 `jwtTocken.js`: creating the response token

```js
const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET_KEY, {
  expiresIn: process.env.JWT_EXPIRES_IN,
});
```

This signs a JWT containing the user ID. The secret signs it and `JWT_EXPIRES_IN` controls its lifetime.

```js
res.status(statusCode).cookie("token", token, { ... }).json({ ... });
```

This sets the HTTP status, sends an HTTP-only cookie, and returns JSON. HTTP-only prevents browser JavaScript from reading the cookie. The current response also includes the token and the complete database user row; remove the password before returning user data in production.

### 13.13 `errorMiddleware.js`: one error response format

`ErrorHandler` extends JavaScript's `Error` and adds `statusCode`. Controllers use it for expected client errors. `errorMiddleware` supplies default values, handles JWT errors, collects validation messages, and returns:

```json
{
  "success": false,
  "message": "..."
}
```

The four parameters `(err, req, res, next)` tell Express that this is error middleware.

## 14. Complete Request Timelines

### Registration

`Postman -> CORS -> JSON parser -> auth router -> register -> database SELECT -> bcrypt hash -> database INSERT -> sendToken -> response`

### Protected current user

`Postman cookie -> CORS -> cookie parser -> auth router -> isAuthenticated -> jwt.verify -> database SELECT -> getUser -> response`

### Failed request

`Request -> validation or rejected promise -> next(error) -> errorMiddleware -> JSON error response`

## 15. Security Notes

The configuration file contains credentials and service secrets. Rotate any real credentials that have been exposed, keep the file out of version control, and create a redacted `config.env.example`. Move the database password from `db.js` into environment variables. Also avoid returning `password` in registration, login, and reset responses by selecting safe columns or deleting that property before calling `sendToken`.
