const prefix = process.env.FETCHER_PREFIX;
if (prefix === undefined) {
    throw Error("FETCHER_PREFIX environment variable undefined");
}
import { connectToDb } from "./db";
import { DB_URL } from "./db/credentials";
import { runScheduler } from "./hmc-api/fetcher/scheduler";
import { runRatingsScheduler } from "./rmp-api/scheduler";

await connectToDb(DB_URL);
await runScheduler(prefix);
// started after the course scheduler, which makes sure there are sections in the
// database to match ratings to
void runRatingsScheduler();
