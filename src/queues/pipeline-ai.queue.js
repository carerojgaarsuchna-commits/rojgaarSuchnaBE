import { Queue } from "bullmq";
import connection from "../utils/redisClient.js";

const pipelineAiQueue = new Queue("pipeline-ai", {
  connection,
});

export default pipelineAiQueue;
