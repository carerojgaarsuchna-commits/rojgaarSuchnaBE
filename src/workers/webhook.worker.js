import { Worker } from 'bullmq';
import connection from '../utils/redisClient.js';
import { processJob } from '../service/webhook.service.js'
new Worker(
    'webhook',
    async (job) => {
        console.log("Worker startes for Job ID:", job.id);
        await processJob(job.data);
        console.log("Worked done Job Id:", job.id)
    },
    {
        connection
    }

)

console.log("Worker Started");