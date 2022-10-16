#!/usr/bin/env node
import extendsFs from "./extendsFs";
import path from "node:path";
import Yargs from "yargs";
import os from "node:os";
import fs from "node:fs/promises";
import yaml from "yaml";

async function getSocketPath() {
  if (await extendsFs.exists("/var/run/initjs.sock")) return "/var/run/initjs.sock";
  return path.join(os.tmpdir(), "initjs.sock");
}

let got: (typeof import("got"))["default"];
const gotCjs = async () => got||(await (eval('import("got")') as Promise<typeof import("got")>)).default;
gotCjs().then(res => got = res);

const yargs = Yargs(process.argv.slice(2)).help().version(false).alias("h", "help").wrap(Yargs.terminalWidth());
yargs.command("start", "Start process", yargs => yargs, async options => {
  const [, ...files] = options._.filter(ff => typeof ff === "string") as string[];
  if (files.length === 0) throw new Error("No files to send to initjs");
  const socketPath = await getSocketPath();
  for (const configFile of files) {
    const filePath = path.resolve(process.cwd(), configFile);
    if (!await extendsFs.exists(filePath)) continue;
    await (await gotCjs())(`http://unix:${socketPath}:/`, {
      enableUnixSockets: true,
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: filePath.endsWith(".json")?await fs.readFile(filePath, "utf8"):JSON.stringify(yaml.parse(await fs.readFile(filePath, "utf8"))),
    }).then(res => {
      return console.log(res.body);
    }).catch((err) => {
      const jsonData = JSON.parse(err?.response?.body);
      console.error(`${filePath}:`, err.message, jsonData?.error||jsonData?.err||jsonData?.message||jsonData?.stack||jsonData);
    });
  }
}).command("restart", "Restart process", yargs => yargs, async options => {
  const [, ...files] = options._.filter(ff => typeof ff === "string") as string[];
  if (files.length === 0) throw new Error("No files to send to initjs");
  const socketPath = await getSocketPath();
  for (const configFile of files) {
    const filePath = path.resolve(process.cwd(), configFile);
    if (!await extendsFs.exists(filePath)) continue;
    const configData = filePath.endsWith(".json")?JSON.parse(await fs.readFile(filePath, "utf8")):yaml.parse(await fs.readFile(filePath, "utf8"))
    await (await gotCjs())(`http://unix:${socketPath}:/restart`, {
      enableUnixSockets: true,
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(configData),
    }).then(res => console.log(res.body)).catch((err) => {
      let jsonData;
      try {jsonData = JSON.parse(err?.response?.body);} catch {jsonData = err}
      console.error(`${filePath}:`, err.message, jsonData?.error||jsonData?.err||jsonData?.message||jsonData?.stack||jsonData);
    });
  }
});

// Start process
yargs.command({command: "*", handler: () => {Yargs.showHelp();}}).parseAsync().catch((err: Error) => {
  console.error(err);
  process.exit(1);
});