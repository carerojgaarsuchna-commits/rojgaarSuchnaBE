import { Queue } from "bullmq";
import connection from "../utils/redisClient.js";

const webhookQueue = new Queue("webhook", {
    connection,
});

export default webhookQueue;