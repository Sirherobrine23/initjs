#!/usr/bin/env ts-node
import customChild from "./process";
import extendsFs from "./extendsFs";
import parseUnit from "./customParseUnit";
import * as systemd from "./systemd"
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
process.title = "Initd nodejs";
const startScripts = "/startScripts";
const varLog = "/var/log";

(async function rootScript(){
  if (await extendsFs.exists(startScripts)) {
    (await extendsFs.readdirrecursive(startScripts)).forEach(scriptName => {
      customChild.execFile({
        command: scriptName,
        options: {
          cwd: os.homedir(),
          stdio: systemd.SHOW_PROCESS_LOG === "verbose"?"inherit":"ignore",
          logPath: {
            stdout: path.join(varLog, `${path.basename(scriptName)}_stdout.log`),
            stderr: path.join(varLog, `${path.basename(scriptName)}_stderr.log`)
          }
        }
      });
    });
  }
})();

// Start Systemd Process
(async function startSystemd(): Promise<any> {
  const systemdPaths: string[] = [];
  if (await extendsFs.exists("/etc/systemd")) systemdPaths.push("/etc/systemd");
  if (await extendsFs.exists("/run/systemd")) systemdPaths.push("/run/systemd");
  if (await extendsFs.exists("/usr/lib/systemd")) systemdPaths.push("/usr/lib/systemd");
  if (await extendsFs.exists("/usr/local/lib/systemd")) systemdPaths.push("/usr/local/lib/systemd");

  if (systemdPaths.length === 0) return;
  const processEnable = (await customChild.execAsync("systemctl list-unit-files --state=enabled|tee")).stdout.split(/\r?\n/).map(line => (line.match(/(.*\.service)/)||[])[1]).filter(line => !!line?.trim());
  const systemdFiles = (await extendsFs.readdirrecursive(systemdPaths));
  const systemdProcess = systemdFiles.filter(file => processEnable.some(proc => file.endsWith(proc))).filter(file => /\/system\//.test(file)).sort(a => a.startsWith("/etc/systemd")?-1:1);
  const fles = await Promise.all(systemdProcess.map(async file => ({file, parsed: parseUnit.parse(await fs.readFile(file, "utf8").catch(() => ""))})));
  for (const data of fles) {
    const {parsed: unit, file: adta} = data;
    if (unit.Unit.Requires) {
      await Promise.all(unit.Unit.Requires.split(/\s+/).map(async serviceName => {
        const adta = systemdFiles.find(file => file.endsWith(serviceName));
        if (!adta) return console.log("Droping", serviceName);
        const unit = parseUnit.parse(await fs.readFile(adta, "utf8"))
        if (!unit.Unit) return;
        if (!unit.Unit.Name) unit.Unit.Name = path.parse(adta).name;
        try {
          new systemd.registerUnit(unit);
        } catch (err) {
          if ((err as systemd.systemdError).message === "is already running") err;
          console.error(err);
        }
      }));
    }
    if (!unit.Unit) return;
    if (!unit.Unit.Name) unit.Unit.Name = path.parse(adta).name;
    try {
      new systemd.registerUnit(unit);
    } catch (err) {
      if ((err as systemd.systemdError).message === "is already running") err;
      console.error(err);
    }
  }
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

const checkProcess = setInterval(() => {
  if (Object.keys(systemd.unitsProcess).length === 0) clearInterval(checkProcess);
  // console.log(systemd.unitsProcess);
}, 1500);