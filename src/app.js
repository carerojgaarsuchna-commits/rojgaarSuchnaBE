import express from "express";
import cors from "cors";
import morgan from "morgan";
// import { errorHandler } from "./middlewares/errorHandler.js";
import router from "./routes/index.js";

const app = express();

// Middleware

app.use(express.json({
    limit: "5mb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "5mb"
}));


app.use(cors());
if (process.env.NODE_ENV === "development") app.use(morgan("dev"));

// Routes
app.use("/api", router);

// Error Handling
// app.use(errorHandler);

export default app;
