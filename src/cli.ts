#!/usr/bin/env node
import Yargs from "yargs";
import yaml from "yaml";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { exists } from "./extendsFs";

async function getSocketPath() {
  if (await exists("/var/run/initjs.sock")) return "/var/run/initjs.sock";
  return path.join(os.tmpdir(), "initjs.sock");
}

const yargs = Yargs(process.argv.slice(2)).help().version(false).alias("h", "help").wrap(Yargs.terminalWidth());
yargs.command("start", "Start process", yargs => yargs, async options => {
  const [, ...files] = options._.filter(ff => typeof ff === "string") as string[];
  if (files.length === 0) throw new Error("No files to send to initjs");
  for (const configFile of files) {
    const filePath = path.resolve(process.cwd(), configFile);
    if (await exists(filePath)) {
      const request = http.request({
        socketPath: await getSocketPath(),
        path: "/",
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      }, async (res) => {
        res.on("data", data => process.stdout.write(data));
        if (res.statusCode !== 200) return console.error(new Error(`${res.statusCode}`));
        return;
      });
      request.on("error", console.error);
      if (filePath.endsWith(".json")) fs.createReadStream(filePath).pipe(request);
      else request.write(JSON.stringify(yaml.parse(await fs.promises.readFile(filePath, "utf8"))));
    }
  }
});

// Start process
yargs.command({command: "*", handler: () => {Yargs.showHelp();}}).parseAsync().catch((err: Error) => {
  console.error(err?.message||err);
  process.exit(1);
});