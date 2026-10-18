import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("sweep stale collaboration sessions", { seconds: 60 }, internal.maintenance.sweepSessions);
crons.interval("sweep expired rate limit windows", { hours: 1 }, internal.maintenance.sweepRateLimits);

export default crons;
