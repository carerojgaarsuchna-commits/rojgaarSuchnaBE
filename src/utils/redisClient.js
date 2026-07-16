import "dotenv/config";
import IORedis from "ioredis";

const redisHost = process.env.REDIS_HOST;
const redisPort = Number(process.env.REDIS_PORT || 6379);

if (!redisHost) {
    throw new Error("REDIS_HOST is not configured");
}

const connection = new IORedis({
    host: redisHost,
    port: redisPort,
    username: "default",
    password: process.env.REDIS_KEY,
    maxRetriesPerRequest: null,
});
connection.on("error", (err) => {
    console.error(err);
});


export default connection;
// import { createClient } from 'redis';

// const client = createClient({
//     username: 'default',
//     password: password,
//     socket: {
//         host: '',
//         port: 
//     }
// });
// client.on('error', err => console.log('Redis Client Error', err));

// export async function redisClient() {
//     if (!client.isOpen) {
//         await client.connect();
//         console.log("✅ Redis Connected");
//     }
//     return client
// }

