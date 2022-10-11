#!/usr/bin/env node
import child_process from "node:child_process";
import { startAllServices } from "./services";
import { gid, uid } from "userid";

startAllServices().then(() => {
  // Start user command
  const userArgs = process.argv.slice(2);
  if (userArgs.length > 0) {
    const [command, ...commandArgs] = userArgs;
    const uidProcess = uid(process.env.SUDO_USER||"root"), gidProcess = gid(process.env.SUDO_USER||"root")
    let processUser: child_process.ChildProcess;
    if (commandArgs.length === 0) processUser = child_process.spawn(command, {uid: uidProcess, gid: gidProcess, stdio: "inherit"});
    else processUser = child_process.spawn(command, commandArgs, {uid: uidProcess, gid: gidProcess, stdio: "inherit"});
    processUser.on("error", () => {});
    processUser.on("exit", code => {
      if ((["on", "1", "true"]).includes(process.env.INITD_NO_EXIT)) return process.exit(code);
      return console.info("User command exit %o", code);
    });
  };
});
