// `npm run dev`: the Next.js app and the realtime (WebSocket) server together.
// Ctrl+C stops both. If the realtime server dies the app keeps running (boards fall back to HTTP polling).
import { spawn } from "node:child_process";

const colors = { web: "\x1b[36m", realtime: "\x1b[35m" };
const children = [];

function run(name, command, args) {
  const child = spawn(command, args, { shell: true, stdio: ["inherit", "pipe", "pipe"], env: process.env });
  const prefix = `${colors[name]}[${name}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    let buffered = "";
    stream.on("data", (chunk) => {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) process.stdout.write(prefix + line + "\n");
    });
  }
  children.push(child);
  return child;
}

const web = run("web", "npx", ["next", "dev"]);
const realtime = run("realtime", "npx", ["tsx", "--env-file-if-exists=.env.local", "scripts/realtime.ts"]);

realtime.on("exit", (code) => {
  if (code) console.log(`${colors.realtime}[realtime]\x1b[0m exited with code ${code}; the app keeps running on HTTP polling. Fix the error above and restart \`npm run dev\`.`);
});

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill();
  setTimeout(() => process.exit(0), 300);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
web.on("exit", (code) => {
  stop();
  process.exitCode = code ?? 0;
});
