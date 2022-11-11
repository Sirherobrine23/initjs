import path from "node:path";
import os from "node:os";
import { mainProcess } from "./mainProcess";
const processManeger = new mainProcess(process.platform === "linux"?"/var/run/initjs.sock":path.join(os.homedir(), "initjs.sock"));
processManeger.on("error", err => console.error("[%s ERROR]: %o", new Date(), err));
processManeger.on("processExit", data => console.log("[%s INITJS]: Program: '%s', Exit code/signal: %o", new Date(), data.name, data.code||data.signal));