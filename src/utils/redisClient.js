import IORedis from "ioredis";


const connection = new IORedis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
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

