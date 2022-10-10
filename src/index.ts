#!/usr/bin/env ts-node
import customChild from "./process";
import os from "node:os";
import path from "node:path";
import extendsFs from "./extendsFs";
process.title = "Initd nodejs";

const startScripts = "/startScripts";
const varLog = "/var/log";
const servicesStorages = {
  default: "./dinit",
  fist: "/etc/dinit",
  second: "/var/lib/dinit"
};

(async function rootScript(){
  if (await extendsFs.exists(startScripts)) {
    (await extendsFs.readdirrecursive(startScripts)).forEach(scriptName => {
      customChild.execFile({
        command: scriptName,
        options: {
          cwd: os.homedir(),
          logPath: {
            stdout: path.join(varLog, `${path.basename(scriptName)}_stdout.log`),
            stderr: path.join(varLog, `${path.basename(scriptName)}_stderr.log`)
          }
        }
      });
    });
  }
})();

(async function startServices(){
  const scripts = [];
  if (await extendsFs.exists(servicesStorages.default)) scripts.push(servicesStorages.default);
  if (await extendsFs.exists(servicesStorages.fist)) scripts.push(servicesStorages.fist);
  if (await extendsFs.exists(servicesStorages.second)) scripts.push(servicesStorages.second);

  const files = (await extendsFs.readdirrecursive(scripts)).filter(file => /\.((c|m|)js|json)$/.test(file));
  console.log(files);
})();

// Start user command
const userArgs = process.argv.slice(2);
if (userArgs.length > 0) {
  const [command, ...commandArgs] = userArgs;
  customChild.spawn({
    command, args: commandArgs,
    options: {
      cwd: os.homedir(),
      stdio: "inherit"
    }
  }).on("close", process.exit);
};
