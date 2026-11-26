// OpenCode v2 prompts run in a separate server process: the parent owns its PID and does not delegate authorization to the CLI or descendants.
import { randomBytes } from "node:crypto";
import { prepareCommand, spawnPrepared } from "./spawn.mjs";

export function privateClientArgs(args, url) {
	if (args.some(value => value === "--server" || value.startsWith("--server="))) throw new Error("This launch uses a private server; remove --server");
	return ["--server", url, ...args.filter(value => value !== "--standalone")];
}
export async function startPrivateServer(command, { env, cwd, lease, timeout = 20000 }) {
	const password = randomBytes(32).toString("base64url");
	// Client and server share a random credential; do not read the user’s existing server password.
	env.OPENCODE_PASSWORD = password;
	delete env.OPENCODE_SERVER_PASSWORD;
	const descriptor = prepareCommand(command, ["serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0"], { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
	if (!descriptor.hostDirect) throw new Error("Private server requires a verifiable native entry point");
	const startedAt = Date.now(), child = spawnPrepared(descriptor);
	child.on("error", () => {});
	child.stdin.on("error", () => {});
	let closed = false, errors = "";
	const close = () => {
		if (closed) return;
		closed = true;
		child.stdin.end();
		if (child.exitCode === null) child.kill();
	};
	const exited = new Promise(resolve => child.once("close", code => resolve(code)));
	child.stderr.on("data", chunk => { errors = (errors + chunk.toString()).slice(-2000); });
	try {
		if (child.pid) lease?.publish(child.pid, startedAt);
		const url = await new Promise((resolve, reject) => {
			let pending = "", settled = false;
			const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
			const timer = setTimeout(() => finish(new Error("Private server startup timed out")), timeout);
			child.once("error", error => finish(error));
			child.once("exit", code => finish(new Error(`Private server exited early (${code})${errors ? ": " + errors.replaceAll(password, "[redacted]") : ""}`)));
			child.stdout.on("data", chunk => {
				if (settled) return;
				pending += chunk.toString();
				if (pending.length > 32768) { finish(new Error("Private server readiness exceeded the limit")); return; }
				let end;
				while ((end = pending.indexOf("\n")) !== -1) {
					const line = pending.slice(0, end).trim(); pending = pending.slice(end + 1);
					if (!line) continue;
					try {
						const data = JSON.parse(line), ready = new URL(data.url);
						if (ready.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(ready.hostname) || !ready.port || ready.username || ready.password || ready.pathname !== "/" || ready.search || ready.hash) throw new Error("Readiness URL is not a local private server");
						finish(null, ready.origin); return;
					} catch (error) { finish(new Error(`Invalid private server readiness: ${error.message}`)); return; }
				}
			});
		});
		return { pid: child.pid, url, exited, close, clientArgs: args => privateClientArgs(args, url) };
	} catch (error) { lease?.close(); close(); await exited; throw error; }
}
