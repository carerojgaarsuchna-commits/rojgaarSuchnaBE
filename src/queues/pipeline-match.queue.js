import { Queue } from "bullmq";
import connection from "../utils/redisClient.js";

const pipelineMatchQueue = new Queue("pipeline-match", {
  connection,
});

export default pipelineMatchQueue;
