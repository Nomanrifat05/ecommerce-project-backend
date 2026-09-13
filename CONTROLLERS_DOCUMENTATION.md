# Controller Documentation

This guide explains the three main controller files in this project:

1. `controllers/authController.js`
2. `controllers/productController.js`
3. `controllers/adminController.js`

It is written for beginners. A controller is the part of an Express application that receives a request, performs business logic, talks to the database or another service, and sends a response.

## 1. The Request Path

A request normally travels through the project in this order:

```text
Frontend/Postman
  -> app.js middleware
  -> router file
  -> authentication/authorization middleware (when required)
  -> controller function
  -> PostgreSQL / Cloudinary / Gemini
  -> JSON response
```

### 1.1 The three router prefixes

`app.js` mounts the routers:

```js
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/product", productRouter);
app.use("/api/v1/admin", adminRouter);
```

The router path and this prefix are combined. For example:

```js
router.post("/register", register);
```

becomes:

```text
POST /api/v1/auth/register
```

### 1.2 Common controller parameters

Every controller receives three Express objects:

```js
(req, res, next)
```

- `req` means request. It contains `req.body`, `req.params`, `req.query`, `req.cookies`, `req.files`, and `req.user`.
- `res` means response. It sends status codes, cookies, and JSON back to the client.
- `next` passes control to the next middleware. `next(error)` sends an error to `errorMiddleware`.

### 1.3 `catchAsyncErrors`

All controllers are wrapped like this:

```js
export const login = catchAsyncErrors(async (req, res, next) => {
  // controller code
});
```

The wrapper catches rejected promises from database calls, Cloudinary calls, or other asynchronous work. Without it, an unhandled asynchronous error might not reach Express's error middleware.

### 1.4 Database queries

The controllers use:

```js
await database.query(sql, values);
```

A query such as this:

```js
await database.query("SELECT * FROM users WHERE email = $1", [email]);
```

uses `$1` as a parameter placeholder. The value is supplied separately in the array. This is safer than inserting user input directly into the SQL string.

A PostgreSQL query result normally looks like this:

```js
{
  rows: [...],
  rowCount: 1
}
```

The controllers usually read returned records from `result.rows`.

---

# 2. `authController.js`

This controller manages registration, login, logout, current-user information, password recovery, password changes, and profile updates.

## 2.1 Imports

```js
import ErrorHandler from "../middlewares/errorMiddleware.js";
```

Imports the project's custom error class. Controllers create errors with a message and HTTP status, for example:

```js
next(new ErrorHandler("User not found", 404));
```

The error middleware later converts this into a JSON error response.

```js
import { catchAsyncErrors } from "../middlewares/catchAsyncError.js";
```

Imports the async error wrapper described above.

```js
import database from "../database/db.js";
```

Imports the PostgreSQL connection pool.

```js
import bcrypt from "bcrypt";
```

`bcrypt` compares passwords and creates one-way password hashes. The original password is not stored in the database.

```js
import { sendToken } from "../utils/jwtTocken.js";
```

After registration, login, or password reset, this utility creates a JWT and places it in the `token` cookie.

```js
import { generateResetPasswordToken } from "../utils/generateResetPasswordToken.js";
import { generateEmailTemplate } from "../utils/generateForgotPasswordEmailTemplate.js";
import { sendEmail } from "../utils/sendEmail.js";
```

These utilities support the forgot-password flow: generate a token, build the email body, and send the email.

```js
import crypto from "crypto";
```

Used to hash the reset token received from the URL before comparing it with the hashed token stored in PostgreSQL.

```js
import { v2 as cloudinary } from "cloudinary";
```

Used to delete an old avatar and upload a new avatar when a user updates their profile.

## 2.2 `register`

Route:

```text
POST /api/v1/auth/register
```

Expected JSON body:

```json
{
  "name": "Alex",
  "email": "alex@example.com",
  "password": "password123"
}
```

Code flow:

```js
export const register = catchAsyncErrors(async (req, res, next) => {
```

Creates and exports the `register` controller. It is asynchronous and wrapped so rejected promises reach the error middleware.

```js
const { name, email, password } = req.body;
```

Reads the three registration fields from the JSON request body.

```js
if (!name || !email || !password) {
  return next(new ErrorHandler("Please provide all required fields", 400));
}
```

Rejects a request if any required value is missing. Status `400` means the client sent invalid input.

```js
if (password.length < 8 || password.length > 16) {
  return next(
    new ErrorHandler("Password must be between 8 and 16 characters.", 400),
  );
}
```

Only allows passwords from 8 through 16 characters.

```js
const isAlreadyRegistered = await database.query(
  `SELECT * FROM users WHERE email = $1`,
  [email],
);
```

Searches the `users` table for the submitted email. The query is parameterized with `$1`.

```js
if (isAlreadyRegistered.rows.length > 0) {
  return next(
    new ErrorHandler("User already registered with this email", 400),
  );
}
```

Stops registration when the email already exists.

```js
const hashedPassword = await bcrypt.hash(password, 10);
```

Creates a bcrypt hash. The `10` is the salt-round cost. The plain password is not inserted into the database.

```js
const user = await database.query(
  "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING *",
  [name, email, hashedPassword],
);
```

Creates the user. PostgreSQL returns the inserted row because of `RETURNING *`. The database supplies the default role `User`.

```js
sendToken(user.rows[0], 201, "User registered successfully", res);
```

Sends status `201` (created), the new user, a success message, and a JWT cookie through `sendToken`.

Connected pieces:

- Router: `router/authRouters.js`
- Table: `models/userTable.js`
- Authentication utility: `utils/jwtTocken.js`
- Error response: `middlewares/errorMiddleware.js`

## 2.3 `login`

Route:

```text
POST /api/v1/auth/login
```

Expected body:

```json
{
  "email": "alex@example.com",
  "password": "password123"
}
```

```js
const { email, password } = req.body;
```

Reads login credentials.

```js
if (!email || !password) {
  return next(new ErrorHandler("Please provide email and password", 400));
}
```

Rejects missing credentials.

```js
const user = await database.query("SELECT * FROM users WHERE email = $1", [
  email,
]);
```

Finds the user by email.

```js
if (user.rows.length === 0) {
  return next(new ErrorHandler("Invalid email or password", 401));
}
```

Returns `401 Unauthorized` when the email does not exist. The same generic message is used for a wrong password so the API does not reveal which emails are registered.

```js
const isPasswordMatch = await bcrypt.compare(password, user.rows[0].password);
```

Compares the submitted plain password with the stored bcrypt hash.

```js
if (!isPasswordMatch) {
  return next(new ErrorHandler("Invalid email or password", 401));
}
```

Stops the request when the password is incorrect.

```js
sendToken(user.rows[0], 200, "User logged in successfully", res);
```

Creates the JWT cookie and returns the authenticated user with status `200`.

## 2.4 `getUser`

Route:

```text
GET /api/v1/auth/me
```

The route is protected by `isAuthenticated` before this controller runs.

```js
const user = req.user;
```

Reads the user that `authMiddleware.js` found from the JWT cookie.

```js
res.status(200).json({
  success: true,
  user,
});
```

Returns the current authenticated user.

## 2.5 `logout`

Route:

```text
GET /api/v1/auth/logout
```

```js
res
  .status(200)
  .cookie("token", "", {
    expires: new Date(Date.now()),
    httpOnly: true,
  })
```

Replaces the token cookie with an empty cookie that expires immediately. The browser removes it. `httpOnly` means browser JavaScript cannot read the cookie.

```js
.json({
  success: true,
  message: "Logged out successfully",
});
```

Sends the logout confirmation.

## 2.6 `forgotPassword`

Route:

```text
POST /api/v1/auth/password/forgot?frontendUrl=https://example.com
```

Body:

```json
{
  "email": "alex@example.com"
}
```

```js
const { email } = req.body;
const { frontendUrl } = req.query;
```

Reads the account email from the body and the frontend base URL from the query string.

```js
let userResult = await database.query(
  "SELECT * FROM users WHERE email = $1",
  [email],
);
```

Looks up the account.

```js
if (userResult.rows.length === 0) {
  return next(new ErrorHandler("User not found with this email", 404));
}
```

Stops if the account does not exist.

```js
const { hashedToken, resetPasswordExpireTime, resetToken } =
  generateResetPasswordToken();
```

Creates three related values: the plain token for the email URL, its hashed version for the database, and an expiration time.

```js
await database.query(
  `UPDATE users SET reset_password_token = $1, reset_password_expire = to_timestamp($2) WHERE email = $3`,
  [hashedToken, resetPasswordExpireTime / 1000, email],
);
```

Stores only the hashed token and its expiry in the user record. Dividing by `1000` converts JavaScript milliseconds to PostgreSQL timestamp seconds.

```js
const resetPasswordUrl = `${frontendUrl}/password/reset/${resetToken}`;
const message = generateEmailTemplate(resetPasswordUrl);
```

Builds a frontend reset URL and creates the email content. The plain token is sent to the user, but only its hash is stored.

```js
try {
  await sendEmail({
    email: user.email,
    subject: "Ecommerce Password Recovery",
    message,
  });
```

Attempts to send the email.

```js
res.status(200).json({
  success: true,
  message: `Email sent to ${user.email} successfully.`,
});
```

Confirms that the email was sent.

```js
} catch (error) {
  await database.query(
    `UPDATE users SET reset_password_token = NULL, reset_password_expire = NULL WHERE email = $1`,
    [email],
  );
  return next(new ErrorHandler("Email could not be sent.", 500));
}
```

If email sending fails, removes the reset token so a failed email cannot leave an active reset link in the database.

## 2.7 `resetPassword`

Route:

```text
PUT /api/v1/auth/password/reset/:token
```

Body:

```json
{
  "password": "newpassword123",
  "confirmPassword": "newpassword123"
}
```

```js
const { token } = req.params;
```

Reads the plain reset token from the URL.

```js
const resetPasswordToken = crypto
  .createHash("sha256")
  .update(token)
  .digest("hex");
```

Hashes the URL token with SHA-256 so it can be compared to the hashed database value.

```js
const user = await database.query(
  "SELECT * FROM users WHERE reset_password_token = $1 AND reset_password_expire > NOW()",
  [resetPasswordToken],
);
```

Finds a user only when the token matches and has not expired.

```js
if (user.rows.length === 0) {
  return next(new ErrorHandler("Invalid or expired reset token.", 400));
}
```

Rejects an invalid or expired reset link.

```js
if (req.body.password !== req.body.confirmPassword) {
  return next(new ErrorHandler("Passwords do not match.", 400));
}
```

Ensures the two new-password fields are equal.

```js
if (
  req.body.password?.length < 8 ||
  req.body.password?.length > 16 ||
  req.body.confirmPassword?.length < 8 ||
  req.body.confirmPassword?.length > 16
) {
```

Checks the password length. Optional chaining prevents a crash if one value is undefined.

```js
const hashedPassword = await bcrypt.hash(req.body.password, 10);
```

Hashes the new password.

```js
const updatedUser = await database.query(
  `UPDATE users SET password = $1, reset_password_token = NULL, reset_password_expire = NULL WHERE id = $2 RETURNING *`,
  [hashedPassword, user.rows[0].id],
);
```

Changes the password and clears the reset fields so the token cannot be reused.

```js
sendToken(updatedUser.rows[0], 200, "Password reset successfully", res);
```

Logs the user in immediately by creating a new JWT cookie.

## 2.8 `updatePassword`

Route:

```text
PUT /api/v1/auth/password/update
```

Requires authentication. Body:

```json
{
  "currentPassword": "oldpassword",
  "newPassword": "newpassword123",
  "confirmNewPassword": "newpassword123"
}
```

The controller reads all three fields, verifies the current password using `bcrypt.compare`, checks that the new passwords match and have 8-16 characters, hashes the new password, and updates the row using `req.user.id`.

The final response is:

```json
{
  "success": true,
  "message": "Password updated successfully"
}
```

Important connection: `isAuthenticated` must run first because this controller reads `req.user.password` and `req.user.id`.

## 2.9 `updateProfile`

Route:

```text
PUT /api/v1/auth/profile/update
```

Requires authentication. It accepts `name`, `email`, and optionally an uploaded `avatar` file.

```js
const { name, email } = req.body;
```

Reads the text fields.

```js
if (!name || !email) { ... }
if (name.trim().length === 0 || email.trim().length === 0) { ... }
```

Rejects missing or whitespace-only values.

```js
let avatarData = {};
```

Starts with no avatar update. An empty object means the existing avatar should remain unchanged.

```js
if (req.files && req.files.avatar) {
```

Checks whether `express-fileupload` placed an avatar in `req.files`.

```js
if (req.user?.avatar?.public_id) {
  await cloudinary.uploader.destroy(req.user.avatar.public_id);
}
```

Deletes the previous Cloudinary image when one exists.

```js
const newProfileImage = await cloudinary.uploader.upload(
  avatar.tempFilePath,
  {
    folder: "Ecommerce_Avatars",
    width: 150,
    crop: "scale",
  },
);
```

Uploads the temporary file created by `fileUpload` to Cloudinary and scales it to width `150`.

```js
avatarData = {
  public_id: newProfileImage.public_id,
  url: newProfileImage.secure_url,
};
```

Keeps the Cloudinary identifier and secure URL for future display or deletion.

```js
if (Object.keys(avatarData).length === 0) {
```

Chooses an SQL update that changes only name and email when there is no new avatar.

```js
user = await database.query(
  "UPDATE users SET name = $1, email = $2 WHERE id = $3 RETURNING *",
  [name, email, req.user.id],
);
```

Updates the text profile fields.

```js
user = await database.query(
  "UPDATE users SET name = $1, email = $2, avatar = $3 WHERE id = $4 RETURNING *",
  [name, email, avatarData, req.user.id],
);
```

Updates the text fields and avatar when a new image was uploaded.

```js
res.status(200).json({
  success: true,
  message: "Profile updated successfully.",
  user: user.rows[0],
});
```

Returns the updated user.

---

# 3. `productController.js`

This controller creates, reads, updates, and deletes products. It also handles product reviews and AI-assisted product filtering.

## 3.1 Imports

```js
import { catchAsyncErrors } from "../middlewares/catchAsyncError.js";
import ErrorHandler from "../middlewares/errorMiddleware.js";
import { v2 as cloudinary } from "cloudinary";
import database from "../database/db.js";
import { getAIRecommendation } from "../utils/getAIRecommendation.js";
```

The controller uses the async wrapper, custom errors, Cloudinary for product images, PostgreSQL for product data, and the Gemini helper for AI filtering.

## 3.2 `createProduct`

Route:

```text
POST /api/v1/product/admin/create
```

Middleware order:

```text
isAuthenticated -> authorizedRoles("Admin") -> createProduct
```

Body fields are `name`, `description`, `price`, `category`, and `stock`. Product images are uploaded under the `images` field.

```js
const { name, description, price, category, stock } = req.body;
const created_by = req.user.id;
```

Reads product fields and records which authenticated user created the product.

```js
if (!name || !description || !price || !category || !stock) {
  return next(new ErrorHandler("Please provide all required fields", 400));
}
```

Rejects incomplete product data. Because this uses `!`, a numeric value of `0` is treated as missing.

```js
let uploadedImages = [];
```

Creates an array to store Cloudinary URLs and public IDs.

```js
if (req.files && req.files.images) {
  const images = Array.isArray(req.files.images)
    ? req.files.images
    : [req.files.images];
```

Supports both one uploaded file and multiple uploaded files by converting the value to an array.

```js
for (const image of images) {
  const result = await cloudinary.uploader.upload(image.tempFilePath, {
    folder: "Ecommerce_Product_Images",
    width: 1000,
    crop: "scale",
  });
```

Uploads each temporary file to Cloudinary and scales it to width `1000`.

```js
uploadedImages.push({
  url: result.secure_url,
  public_id: result.public_id,
});
```

Stores the public URL for the frontend and the public ID for later deletion.

```js
const product = await database.query(
  "INSERT INTO products (...) VALUES (...) RETURNING *",
  [name, description, price / 122, category, stock,
   JSON.stringify(uploadedImages), created_by],
);
```

Inserts the product into PostgreSQL. Images are stored as JSON. The current code divides the incoming price by `122` before storing it.

```js
res.status(201).json({
  success: true,
  message: "Product created successfully.",
  product: product.rows[0],
});
```

Returns the created product with status `201`.

## 3.3 `fetchAllProducts`

Route:

```text
GET /api/v1/product
```

Supported query parameters:

```text
?page=1&availability=in-stock&price=10-100&category=phone&ratings=4&search=apple
```

### Pagination setup

```js
const { availability, price, category, ratings, search } = req.query;
const page = parseInt(req.query.page) || 1;
const limit = 10;
const offset = (page - 1) * limit;
```

Reads filters, defaults to page `1`, returns `10` products per page, and calculates how many rows to skip.

```js
const conditions = [];
let values = [];
let index = 1;
let paginationPlaceholders = {};
```

`conditions` holds SQL filter expressions. `values` holds safe parameter values. `index` tracks PostgreSQL placeholders such as `$1` and `$2`.

### Availability filter

```js
if (availability === "in-stock") {
  conditions.push(`stock > 5`);
} else if (availability === "limited") {
  conditions.push(`stock > 0 AND stock <= 5`);
} else if (availability === "out-of-stock") {
  conditions.push(`stock = 0`);
}
```

Converts friendly frontend values into SQL stock rules.

### Price filter

```js
if (price) {
  const [minPrice, maxPrice] = price.split("-");
  if (minPrice && maxPrice) {
    conditions.push(`price BETWEEN $${index} AND $${index + 1}`);
    values.push(minPrice, maxPrice);
    index += 2;
  }
}
```

Splits a range such as `10-100` and adds a parameterized `BETWEEN` condition.

### Category and rating filters

```js
if (category) {
  conditions.push(`category ILIKE $${index}`);
  values.push(`%${category}%`);
  index++;
}

if (ratings) {
  conditions.push(`ratings >= $${index}`);
  values.push(ratings);
  index++;
}
```

`ILIKE` performs case-insensitive matching. The `%` characters allow partial category matches. Ratings are filtered from the requested minimum.

### Text search

```js
if (search) {
  conditions.push(
    `(p.name ILIKE $${index} OR p.description ILIKE $${index})`,
  );
  values.push(`%${search}%`);
  index++;
}
```

Searches product name or description.

```js
const whereClause = conditions.length
  ? `WHERE ${conditions.join(" AND ")}`
  : "";
```

Combines all active filters with `AND`. When no filter exists, the clause is empty.

### Count filtered products

```js
const totalProductsResult = await database.query(
  `SELECT COUNT(*) FROM products p ${whereClause}`,
  values,
);
const totalProducts = parseInt(totalProductsResult.rows[0].count);
```

Counts the filtered records so the frontend can calculate pagination controls.

### Pagination placeholders

```js
paginationPlaceholders.limit = `$${index}`;
values.push(limit);
index++;
paginationPlaceholders.offset = `$${index}`;
values.push(offset);
index++;
```

Adds `LIMIT` and `OFFSET` as parameters after all filter parameters.

### Main product query

```sql
SELECT p.*, COUNT(r.id) AS review_count
FROM products p
LEFT JOIN reviews r ON p.id = r.product_id
WHERE ...
GROUP BY p.id
ORDER BY p.created_at DESC
LIMIT ... OFFSET ...
```

Returns products with review counts. `LEFT JOIN` keeps products that have no reviews. `GROUP BY` is required because `COUNT` is used. Newest products appear first.

### New and top-rated products

The controller also runs two independent queries:

- New products: created within the last 30 days, limited to 8.
- Top-rated products: rating at least `4.5`, ordered by rating and creation date, limited to 8.

The response is:

```json
{
  "success": true,
  "products": [],
  "totalProducts": 0,
  "newProducts": [],
  "topRatedProducts": []
}
```

## 3.4 `updateProduct`

Route:

```text
PUT /api/v1/product/admin/update/:productId
```

Requires an authenticated Admin.

```js
const { productId } = req.params;
const { name, description, price, category, stock } = req.body;
```

Reads the ID from the URL and the replacement fields from the body.

```js
if (!name || !description || !price || !category || !stock) { ... }
```

Rejects incomplete data.

```js
const product = await database.query("SELECT * FROM products WHERE id = $1", [
  productId,
]);
```

Checks whether the product exists.

```js
if (product.rows.length === 0) {
  return next(new ErrorHandler("Product not found.", 404));
}
```

Returns `404` when the ID does not match a product.

```js
const result = await database.query(
  `UPDATE products SET name = $1, description = $2, price = $3, category = $4, stock = $5 WHERE id = $6 RETURNING *`,
  [name, description, price / 283, category, stock, productId],
);
```

Updates the product and returns the updated row. The current code divides update prices by `283`, while creation divides by `122`. This is an important behavior to review because it can produce inconsistent prices.

```js
res.status(200).json({
  success: true,
  message: "Product updated successfully.",
  updatedProduct: result.rows[0],
});
```

Returns the updated product.

## 3.5 `deleteProduct`

Route:

```text
DELETE /api/v1/product/admin/delete/:productId
```

Requires an authenticated Admin.

The controller first selects the product, returns `404` if it does not exist, and saves its `images` array. It then deletes the PostgreSQL row with `RETURNING *`.

```js
if (deleteResult.rows.length === 0) {
  return next(new ErrorHandler("Failed to delete product.", 500));
}
```

Confirms that a row was actually deleted.

```js
if (images && images.length > 0) {
  for (const image of images) {
    await cloudinary.uploader.destroy(image.public_id);
  }
}
```

Deletes each corresponding Cloudinary image so database deletion does not leave unused cloud files.

The final response contains status `200` and a success message.

## 3.6 `fetchSingleProduct`

Route:

```text
GET /api/v1/product/singleProduct/:productId
```

```js
const { productId } = req.params;
```

Reads the product ID.

The SQL query joins `products`, `reviews`, and `users`. It uses `json_agg` and `json_build_object` to return reviews nested inside the product, including each reviewer's ID, name, and avatar.

```sql
COALESCE(json_agg(...) FILTER (WHERE r.id IS NOT NULL), '[]') AS reviews
```

Returns an empty array instead of `null` when the product has no reviews.

```js
res.status(200).json({
  success: true,
  message: "Product fetched successfully.",
  product: result.rows[0],
});
```

Returns the first matching row. The current controller does not explicitly check whether `result.rows[0]` exists, so a nonexistent ID may produce a successful response with an undefined product. A future improvement would return `404` when no row is found.

## 3.7 `postProductReview`

Route:

```text
PUT /api/v1/product/post-new/review/:productId
```

Requires login. Body:

```json
{
  "rating": 5,
  "comment": "Very good product"
}
```

```js
const { productId } = req.params;
const { rating, comment } = req.body;
```

Reads the product and review values.

```js
if (!rating || !comment) {
  return next(new ErrorHandler("Please provide rating and comment.", 400));
}
```

Rejects missing review fields.

The purchase-check query joins `order_items`, `orders`, and `payments`. It verifies that the logged-in user owns an order containing this product and that its payment status is `Paid`.

```js
if (rows.length === 0) {
  return res.status(403).json({
    success: false,
    message: "You can only review a product you've purchased.",
  });
}
```

Only verified purchasers may review. Status `403` means the user is authenticated but not allowed to perform this action.

The controller then checks that the product exists. It checks for an existing review by the same user:

- Existing review: `UPDATE` its rating and comment.
- No existing review: `INSERT` a new review.

```js
SELECT AVG(rating) AS avg_rating FROM reviews WHERE product_id = $1
```

Calculates the new average rating.

```js
UPDATE products SET ratings = $1 WHERE id = $2 RETURNING *
```

Stores that average on the product row.

The response returns the saved review and the updated product.

## 3.8 `deleteReview`

Route:

```text
DELETE /api/v1/product/delete/review/:productId
```

Requires login.

```js
const review = await database.query(
  "DELETE FROM reviews WHERE product_id = $1 AND user_id = $2 RETURNING *",
  [productId, req.user.id],
);
```

Deletes only the current user's review for that product.

```js
if (review.rows.length === 0) {
  return next(new ErrorHandler("Review not found.", 404));
}
```

Returns `404` if the user has no review for that product.

The controller recalculates the average rating and updates the product, just like `postProductReview`. Finally it returns the deleted review and updated product.

## 3.9 `fetchAIFilteredProducts`

Route:

```text
POST /api/v1/product/ai-search
```

Requires login. Body:

```json
{
  "userPrompt": "show me affordable black shoes"
}
```

### Validate the prompt

```js
const { userPrompt } = req.body;
if (!userPrompt) {
  return next(new ErrorHandler("Provide a valid prompt.", 400));
}
```

Requires a natural-language search prompt.

### Remove stop words

The nested `filterKeywords` function creates a `Set` of common words such as `the`, `and`, `with`, and punctuation. It then:

1. Converts the prompt to lowercase.
2. Removes punctuation.
3. Splits it into words.
4. Removes stop words.
5. Converts each remaining word into a pattern such as `%shoes%`.

### First search: PostgreSQL

```sql
SELECT * FROM products
WHERE name ILIKE ANY($1)
OR description ILIKE ANY($1)
OR category ILIKE ANY($1)
LIMIT 200
```

The database performs a broad keyword search and returns at most 200 candidate products.

If there are no candidates, the controller returns an empty product array and does not call the AI service.

### Second search: Gemini

```js
const { success, products } = await getAIRecommendation(
  req,
  res,
  userPrompt,
  filteredProducts,
);
```

The helper sends the candidates and the original prompt to Gemini. It expects the model to return JSON containing matching products.

```js
res.status(200).json({
  success: success,
  message: "AI filtered products.",
  products,
});
```

Returns the AI-filtered products.

Connected pieces:

- `utils/getAIRecommendation.js` requires `GEMINI_API_KEY`.
- `app.js` file-upload middleware supplies `req.files` for image controllers.
- `models/productsTable.js` defines product columns.
- Review logic connects `products`, `reviews`, `users`, `orders`, `order_items`, and `payments`.

---

# 4. `adminController.js`

This controller provides admin-only user management and dashboard statistics.

## 4.1 Imports

```js
import ErrorHandler from "../middlewares/errorMiddleware.js";
import { catchAsyncErrors } from "../middlewares/catchAsyncError.js";
import database from "../database/db.js";
import { v2 as cloudinary } from "cloudinary";
```

The controller uses custom errors, async error handling, PostgreSQL, and Cloudinary for deleting user avatars.

All admin routes use this middleware order:

```text
isAuthenticated -> authorizedRoles("Admin") -> admin controller
```

`isAuthenticated` creates `req.user`. `authorizedRoles("Admin")` checks `req.user.role` and blocks normal users with status `403`.

## 4.2 `getAllUsers`

Route:

```text
GET /api/v1/admin/getallusers?page=1
```

```js
const page = parseInt(req.query.page) || 1;
```

Reads the requested page and defaults to page `1`.

```js
const totalUsersResult = await database.query(
  "SELECT COUNT(*) FROM users WHERE role = $1",
  ["User"],
);
```

Counts normal customers. Admin accounts are excluded.

```js
const totalUsers = parseInt(totalUsersResult.rows[0].count);
const offset = (page - 1) * 10;
```

Converts the count to a number and calculates pagination offset. The page size is `10`.

```js
const users = await database.query(
  "SELECT * FROM users WHERE role = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
  ["User", 10, offset],
);
```

Fetches ten normal users, newest first.

```js
res.status(200).json({
  success: true,
  totalUsers,
  currentPage: page,
  users: users.rows,
});
```

Returns the pagination information and current page records.

## 4.3 `deleteUser`

Route:

```text
DELETE /api/v1/admin/delete/:id
```

```js
const { id } = req.params;
```

Reads the user ID from the URL.

```js
const deleteUser = await database.query(
  "DELETE FROM users WHERE id = $1 RETURNING *",
  [id],
);
```

Deletes the user and returns the deleted row so the controller can inspect its avatar.

```js
if (deleteUser.rows.length === 0) {
  return next(new ErrorHandler("User not found", 404));
}
```

Returns `404` when no user matched the ID.

```js
const avatar = deleteUser.rows[0].avatar;
if (avatar?.public_id) {
  await cloudinary.uploader.destroy(avatar.public_id);
}
```

Reads the stored avatar object and deletes its Cloudinary image when a public ID exists.

```js
res.status(200).json({
  success: true,
  message: "User deleted successfully",
});
```

Confirms deletion.

Database relationship note: `users` is referenced by products, reviews, orders, and other tables. The model definitions use foreign-key rules, so deleting a user may also delete dependent records where `ON DELETE CASCADE` is configured.

## 4.4 `dashboardStats`

Route:

```text
GET /api/v1/admin/fetch/dashboard-stats
```

This function executes multiple aggregate queries and returns one dashboard response.

### Date preparation

```js
const today = new Date();
const todayDate = today.toISOString().split("T")[0];
```

Creates the current date and formats it as `YYYY-MM-DD`.

```js
const yesterday = new Date(today);
yesterday.setDate(today.getDate() - 1);
const yesterdayDate = yesterday.toISOString().split("T")[0];
```

Creates yesterday's date without changing the `today` object.

```js
const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
const currentMonthEnd = new Date(
  today.getFullYear(),
  today.getMonth() + 1,
  0,
);
```

Creates the first and last day of the current month.

```js
const previousMonthStart = new Date(
  today.getFullYear(),
  today.getMonth() - 1,
  1,
);
const previousMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
```

Creates the first and last day of the previous month.

### All-time revenue

```sql
SELECT SUM(total_price) FROM orders WHERE paid_at IS NOT NULL
```

Adds the total prices of paid orders. Unpaid orders are ignored.

```js
const totalRevenueAllTime =
  parseFloat(totalRevenueAllTimeQuery.rows[0].sum) || 0;
```

Converts PostgreSQL's aggregate value to a number. When there are no rows, `SUM` can be null, so the fallback is `0`.

### Total users

```sql
SELECT COUNT(*) FROM users WHERE role = 'User'
```

Counts customer accounts and excludes admins.

### Order status counts

```sql
SELECT order_status, COUNT(*)
FROM orders
WHERE paid_at IS NOT NULL
GROUP BY order_status
```

Counts paid orders by status.

```js
const orderStatusCounts = {
  Processing: 0,
  Shipped: 0,
  Delivered: 0,
  Cancelled: 0,
};
```

Initializes every expected status to zero so a missing status still appears in the response.

```js
orderStatusCountsQuery.rows.forEach((row) => {
  orderStatusCounts[row.order_status] = parseInt(row.count);
});
```

Replaces each status's zero with the database count.

### Today and yesterday revenue

Both queries sum paid orders whose `created_at::date` equals the selected date. The results are converted to numbers with a zero fallback.

### Monthly sales

```sql
SELECT
  TO_CHAR(created_at, 'Mon YYYY') AS month,
  DATE_TRUNC('month', created_at) as date,
  SUM(total_price) as totalsales
FROM orders
WHERE paid_at IS NOT NULL
GROUP BY month, date
ORDER BY date ASC
```

Groups paid revenue by month and sorts it chronologically. The mapping creates simple chart-friendly objects:

```js
{
  month: row.month,
  totalsales: parseFloat(row.totalsales) || 0,
}
```

### Top five products

The query joins `order_items`, `products`, and `orders`. It sums `oi.quantity`, keeps only paid orders, sorts by units sold, and returns the five best-selling products. It also reads the first product image from the JSONB `images` column.

### Current month sales

Uses `SUM(total_price)` with `created_at BETWEEN currentMonthStart AND currentMonthEnd`. Only paid orders are counted.

### Low-stock products

```sql
SELECT name, stock FROM products WHERE stock <= 5
```

Returns products that may need restocking.

### Revenue growth

The controller gets the previous month's revenue and starts with:

```js
let revenueGrowth = "0%";
```

When the previous month has revenue, it calculates:

```js
((currentMonthSales - lastMonthRevenue) / lastMonthRevenue) * 100
```

It formats positive growth with `+` and two decimal places, for example `+12.50%`. If last month's revenue is zero, it avoids division by zero and leaves the value at `0%`.

### New users this month

Counts users whose `created_at` is after the current month's start and whose role is `User`.

### Final response

The controller returns:

```json
{
  "success": true,
  "message": "Dashboard Stats Fetched Successfully",
  "totalRevenueAllTime": 0,
  "todayRevenue": 0,
  "yesterdayRevenue": 0,
  "totalUsersCount": 0,
  "orderStatusCounts": {},
  "monthlySales": [],
  "currentMonthSales": 0,
  "topSellingProducts": [],
  "lowStockProducts": [],
  "revenueGrowth": "0%",
  "newUsersThisMonth": 0
}
```

The frontend dashboard can use these fields for cards, charts, order-status summaries, best-selling products, stock warnings, and user-growth indicators.

---

# 5. Middleware and Utility Connections

## 5.1 `isAuthenticated`

Protected routes read the `token` cookie:

```js
const { token } = req.cookies;
```

If there is no token, the request ends with `401`. Otherwise, `jwt.verify` checks the signature using `JWT_SECRET_KEY`. The decoded user ID is used to query PostgreSQL, and the resulting user is assigned to:

```js
req.user = user.rows[0];
```

That is why controllers can use `req.user.id`, `req.user.role`, and `req.user.password`.

## 5.2 `authorizedRoles("Admin")`

This middleware is called after authentication. It checks whether `req.user.role` is included in the allowed roles. Admin product and admin routes use it to prevent normal users from changing products, deleting users, or reading dashboard statistics.

## 5.3 `sendToken`

`sendToken` signs a JWT containing only the user ID:

```js
jwt.sign({ id: user.id }, process.env.JWT_SECRET_KEY, {
  expiresIn: process.env.JWT_EXPIRES_IN,
});
```

It then sets the `token` cookie and sends the user and message in JSON. The cookie expiration is controlled by `COOKIE_EXPIRES_IN`.

## 5.4 `errorMiddleware`

Controllers do not usually build error JSON manually. They call:

```js
return next(new ErrorHandler("Message", statusCode));
```

The final error middleware formats the response. This keeps error handling consistent across all controllers.

---

# 6. Endpoint Quick Reference

| Method | Endpoint | Controller | Authentication |
|---|---|---|---|
| POST | `/api/v1/auth/register` | `register` | Public |
| POST | `/api/v1/auth/login` | `login` | Public |
| GET | `/api/v1/auth/me` | `getUser` | Login required |
| GET | `/api/v1/auth/logout` | `logout` | Login required |
| POST | `/api/v1/auth/password/forgot` | `forgotPassword` | Public |
| PUT | `/api/v1/auth/password/reset/:token` | `resetPassword` | Reset token |
| PUT | `/api/v1/auth/password/update` | `updatePassword` | Login required |
| PUT | `/api/v1/auth/profile/update` | `updateProfile` | Login required |
| POST | `/api/v1/product/admin/create` | `createProduct` | Admin |
| GET | `/api/v1/product` | `fetchAllProducts` | Public |
| GET | `/api/v1/product/singleProduct/:productId` | `fetchSingleProduct` | Public |
| PUT | `/api/v1/product/admin/update/:productId` | `updateProduct` | Admin |
| DELETE | `/api/v1/product/admin/delete/:productId` | `deleteProduct` | Admin |
| PUT | `/api/v1/product/post-new/review/:productId` | `postProductReview` | Login required |
| DELETE | `/api/v1/product/delete/review/:productId` | `deleteReview` | Login required |
| POST | `/api/v1/product/ai-search` | `fetchAIFilteredProducts` | Login required |
| GET | `/api/v1/admin/getallusers` | `getAllUsers` | Admin |
| DELETE | `/api/v1/admin/delete/:id` | `deleteUser` | Admin |
| GET | `/api/v1/admin/fetch/dashboard-stats` | `dashboardStats` | Admin |

# 7. Important Current-Code Notes

These are observations about the current implementation, not changes made by this documentation:

1. Product creation divides `price` by `122`, but product update divides it by `283`. Confirm the intended currency conversion and use one consistent rule.
2. Product creation and update treat `stock = 0` as missing because of `!stock`. This makes it impossible to create or update an out-of-stock product through those checks.
3. `fetchSingleProduct` does not explicitly return `404` when the product ID does not exist.
4. Password recovery depends on a valid `frontendUrl` query value and correct email configuration.
5. The AI search depends on `GEMINI_API_KEY` and on Gemini returning valid JSON. The helper sends an error response itself when Gemini fails.
6. Controllers return full user rows in several places. Check whether sensitive fields should be removed before sending user data to clients.
7. Admin dashboard date calculations use JavaScript `Date` values and PostgreSQL timestamps. Verify timezone behavior when the application is deployed in a different timezone.

# 8. Beginner Mental Model

When reading a controller, ask these questions in order:

1. Which route calls this function?
2. Does middleware add `req.user`, `req.files`, or another value first?
3. Where does input come from: `req.body`, `req.params`, or `req.query`?
4. What validation happens before database work?
5. Which tables or external services are used?
6. What happens when no row is found?
7. What status code and JSON shape are returned on success?
8. Which errors are passed to `next()`?

Using this checklist makes the controller flow predictable: read input, validate it, perform the business operation, update related data or services, and send one clear response.
