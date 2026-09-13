import express from "express";
import { config } from "dotenv"; //is used to load environment variables from my  .env file into my Node.js application.
import cors from "cors"; //is a middleware that allows cross-origin requests. It enables my server to accept requests from different domains or origins, which is useful for APIs and web applications that need to communicate with each other.
import fileUpload from "express-fileupload";
import cookieParser from "cookie-parser"; //is a middleware that parses cookies attached to the client request object. It allows me to access and manipulate cookies sent by the client in my server-side code.
import { createTables } from "./utils/createTables.js";
import { errorMiddleware } from "./middlewares/errorMiddleware.js"; // Import the errorMiddleware function from the errorMiddleware.js file located in the middlewares directory. This middleware is responsible for handling errors that occur during request processing and sending appropriate responses to the client.
import authRouter from "./router/authRouters.js";
import productRouter from "./router/productRoutes.js"; // Import the productRouter from the productRoutes.js file located in the router directory. This router handles routes related to product operations, such as creating, updating, and deleting products.
import adminRouter from "./router/adminRoutes.js"; // Import the adminRouter from the adminRoutes.js file located in the router directory. This router handles routes related to administrative operations, such as managing users and fetching dashboard statistics.
import Stripe from "stripe"; // Import the Stripe library, which is used for handling payments and interacting with the Stripe API. This library provides methods for creating payment intents, managing subscriptions, and handling webhooks related to payment events.
import orderRouter from "./router/orderRoutes.js"; // Import the orderRouter from the orderRoutes.js file located in the router directory. This router handles routes related to order operations, such as placing new orders, fetching order details, and managing order statuses.
const app = express(); // Create an instance of the Express application. instance means that we are creating a new object of the Express application. This object will be used to define routes, middleware, and other configurations for our web server.

config({ path: "./config/config.env" }); // Load environment variables from the .env file into process.env. This allows us to access environment variables defined in the .env file throughout our application.

app.use(
  cors({
    origin: [process.env.FRONTEND_URL, process.env.DASHBOARD_URL], // Allow requests from the specified frontend URL defined in the environment variables.
    methods: ["GET", "POST", "PUT", "DELETE"], // Allow only the specified HTTP methods for cross-origin requests.
    credentials: true, // Allow cookies and credentials to be included in cross-origin requests. This is useful for authentication and session management when making requests from the frontend to the backend.
  }),
);
app.post(
  "/api/v1/payment/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;
    try {
      event = Stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (error) {
      return res.status(400).send(`Webhook Error: ${error.message || error}`);
    }

    // Handling the Event

    if (event.type === "payment_intent.succeeded") {
      const paymentIntent_client_secret = event.data.object.client_secret;
      try {
        // FINDING AND UPDATED PAYMENT
        const updatedPaymentStatus = "Paid";
        const paymentTableUpdateResult = await database.query(
          `UPDATE payments SET payment_status = $1 WHERE payment_intent_id = $2 RETURNING *`,
          [updatedPaymentStatus, paymentIntent_client_secret],
        );
        await database.query(
          `UPDATE orders SET paid_at = NOW() WHERE id = $1 RETURNING *`,
          [paymentTableUpdateResult.rows[0].order_id],
        );

        // Reduce Stock For Each Product
        const orderId = paymentTableUpdateResult.rows[0].order_id;

        const { rows: orderedItems } = await database.query(
          `
            SELECT product_id, quantity FROM order_items WHERE order_id = $1
          `,
          [orderId],
        );

        // For each ordered item, reduce the product stock
        for (const item of orderedItems) {
          await database.query(
            `UPDATE products SET stock = stock - $1 WHERE id = $2`,
            [item.quantity, item.product_id],
          );
        }
      } catch (error) {
        return res
          .status(500)
          .send(`Error updating paid_at timestamp in orders table.`);
      }
    }
    res.status(200).send({ received: true });
  },
);

app.use(cookieParser()); // Parse cookies from incoming requests. This middleware allows us to access cookies sent by the client in our request handlers.
app.use(express.json()); // its work is : to allow Express to read and parse JSON data sent from the client
app.use(express.urlencoded({ extended: true })); // its work is : to allow Express to read and parse URL-encoded data sent from the client. This is useful for handling form submissions and other types of data sent in the request body like ( formet like string array or object ) . The extended: true option allows for rich objects and arrays to be encoded into the URL-encoded format, which can be useful for complex data structures.

app.use(
  fileUpload({
    // Enable file upload functionality.
    tempFileDir: "./uploads", // Specify the temporary directory where uploaded files will be stored before processing. This is useful for handling file uploads in a temporary location before moving them to their final destination.
    useTempFiles: true, // Enable the use of temporary files for file uploads. When set to true, uploaded files will be stored in the specified temporary directory before being processed or moved to their final destination.
  }),
);

app.use("/api/v1/auth", authRouter); // Mount the authRouter on the /api/v1 path. This means that any routes defined in the authRouter will be prefixed with /api/v1. For example, if the authRouter has a route for /login, it will be accessible at /api/v1/login.
app.use("/api/v1/product", productRouter);
app.use("/api/v1/admin", adminRouter);
app.use("/api/v1/order", orderRouter);

createTables();
app.use(errorMiddleware);
export default app; // Export the Express application instance so that it can be imported and used in other parts of the application, such as the server entry point (e.g., server.js) where the server is started and listens for incoming requests.
