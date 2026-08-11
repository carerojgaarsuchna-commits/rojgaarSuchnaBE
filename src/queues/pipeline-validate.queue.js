import { Queue } from "bullmq";
import connection from "../utils/redisClient.js";

const pipelineValidateQueue = new Queue("pipeline-validate", { connection });

export default pipelineValidateQueue;
