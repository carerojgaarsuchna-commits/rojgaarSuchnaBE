import express from "express";
import cors from "cors";
import morgan from "morgan";
import router from "./routes/index.js";

const app = express();

// Log request size BEFORE body parsing
app.use((req, res, next) => {
    console.log("Content-Length:", req.headers["content-length"]);
    next();
});

// Parse request body
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

export default app;
