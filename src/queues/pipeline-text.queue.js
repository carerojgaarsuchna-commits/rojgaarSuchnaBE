import { Queue } from "bullmq";
import connection from "../utils/redisClient.js";

const pipelineTextQueue = new Queue("pipeline-text", {
  connection,
});

export default pipelineTextQueue;
