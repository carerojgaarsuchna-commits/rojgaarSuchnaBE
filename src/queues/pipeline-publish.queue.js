import { Queue } from "bullmq";
import connection from "../utils/redisClient.js";

const pipelinePublishQueue = new Queue("pipeline-publish", { connection });

export default pipelinePublishQueue;
