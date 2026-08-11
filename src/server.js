import "dotenv/config";
import { connectDB } from "./config/db.js";
import app from "./app.js";
import "./workers/webhook.worker.js";
import "./workers/pipeline-match.worker.js";
import "./workers/pipeline-pdf.worker.js";
import "./workers/pipeline-text.worker.js";
import "./workers/pipeline-ai.worker.js";
import "./workers/pipeline-validate.worker.js";
import "./workers/pipeline-publish.worker.js";
const PORT = process.env.PORT || 5000;

connectDB();
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
