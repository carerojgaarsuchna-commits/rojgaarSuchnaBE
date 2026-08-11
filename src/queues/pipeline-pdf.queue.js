import { Queue } from "bullmq";
import connection from "../utils/redisClient.js";

const pipelinePdfQueue = new Queue("pipeline-pdf", {
  connection,
});

export default pipelinePdfQueue;
