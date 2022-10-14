#!/usr/bin/env node
import * as childProcess from "./process";
import { gid, uid } from "userid";
import path from "node:path";
import fs from "node:fs";
import fsPromise from "node:fs/promises";
import extendsFs from "./extendsFs";
import yaml from "yaml";
import express from "express";
import { tmpdir, userInfo } from "node:os";

// type loadLevel = "quiet"|"q"|"off"|"verbose"|"b"|"on"|"1";
export const SHOW_PROCESS_LOG = /verbose|v|on|1/.test(process.env.INITD_LOG)?"verbose":"quiet";

export type processConfig<moreOptions = {}> = {
  command: string,
  args?: string[],
  user?: string|number,
  group?: string|number,
  env?: NodeJS.ProcessEnv,
  cwd?: string,
  dirs?: string[],
  waitSeconds?: number,
} & moreOptions;

export type unitProcessV2<unitName = string> = {
  name: unitName,
  preProcess?: processConfig|processConfig[],
  process: processConfig<{restart?: "always"|"no"|"on-error", restartCount?: number, waitKill?: number, if_no_file?: string[]}>,
  postStartProcess?: processConfig|processConfig[],
  restartProcess?: processConfig,
  onRestart?: processConfig|processConfig[],
  dependecies?: string|unitProcessV2[]
};

export function replaceEnv(command: string, env?: processConfig["env"]): string {
  if (!env) env = {};
  const envTypeTwo = /\$(\{([\S\w]+)\})/;
  while (envTypeTwo.test(command)) command = command.replace(envTypeTwo, (...args) => {
    const envKey = args[2]||args[1];
    if (!envKey) return "";
    if (envKey.includes(":")) {
      const [, keyName, ifBlank] = envKey.match(/^(.*):[-](.*)$/);
      return env[keyName]||process.env[keyName]||ifBlank||"";
    }
    return env[envKey]||process.env[envKey]||"";
  });

  const envTypeOne = /\$([\S\w]+)/;
  while (envTypeOne.test(command)) command = command.replace(envTypeOne, (...args) => {
    if (!args[1]) return "";
    if (args[1].includes(":")) {
      const [, keyName, ifBlank] = args[1].match(/^(.*):(.*)$/);
      return env[keyName]||process.env[keyName]||ifBlank||"";
    }
    return env[args[1]]||process.env[args[1]]||"";
  });
  return command;
}

async function postStart(unit: unitProcessV2, config: processConfig[]) {
  for (const processConfig of config) {
    if (processConfig.env) Object.keys(processConfig.env).forEach(key => processConfig.env[key] = replaceEnv(processConfig.env[key], processConfig.env));
    const user = {uid: processConfig.user?(typeof processConfig.user === "string"?uid(processConfig.user):processConfig.user):0, gid: processConfig.group?(typeof processConfig.group === "string"?gid(processConfig.group):processConfig.group):0};
    processConfig.env = {...(processConfig.env||{}), ...(unit.process.env||{})};
    await childProcess.execFileAsync(replaceEnv(processConfig.command, processConfig.env), (processConfig.args||[]).map(arg => replaceEnv(arg, processConfig.env)), {
      cwd: processConfig.cwd,
      env: processConfig.env,
      uid: user.uid,
      gid: user.gid,
      pipeProcess: SHOW_PROCESS_LOG === "verbose"?"postProcess":undefined
    }).catch(err => console.error("[%s]: Post/Pre scripts, error:\n%o", unit.name, err));
  }
}

// Process sessions
export const globalProcess: {[unitName: string]: {unit: unitProcessV2, process: childProcess.ChildProcess}} = {};

export type processReturn = {
  name: string,
  pid?: number,
  restartProcess: () => Promise<void>,
  stopProcess: () => Promise<void>,
  childs?: processReturn[],
};

export async function startProcess(unit: unitProcessV2, filePath?: string): Promise<processReturn> {
  if (globalProcess[unit.name]) throw new Error("The Process is already running!");
  const logRoot = path.join("/var/log/initjs", unit.name);
  if (!await extendsFs.exists(logRoot)) await fsPromise.mkdir(logRoot, {recursive: true});
  const logStdout = fs.createWriteStream(path.join(logRoot, "stdout.log"));
  const logStderr = fs.createWriteStream(path.join(logRoot, "stderr.log"));
  let unitProcess: childProcess.ChildProcess;

  async function clean(endType?: "any"|"error"|"no-restart"|"restart", err?: any) {
    if (endType === "restart") return console.log("[%s]: Restarting", unit.name);
    else if (endType === "error") console.log("[%s]: Catch error: %o", err);
    else if (endType === "no-restart") console.log("[%s]: No restart, process closed");
    else console.log("[%s]: End %s", unit.name, endType||"");
    delete globalProcess[unit.name];
  }

  async function startMainProcess() {
    if (unit.process.env) Object.keys(unit.process.env).forEach(key => unit.process.env[key] = replaceEnv(unit.process.env[key], unit.process.env));
    const user = {uid: unit.process.user?(typeof unit.process.user === "string"?uid(unit.process.user):unit.process.user):0, gid: unit.process.group?(typeof unit.process.group === "string"?gid(unit.process.group):unit.process.group):0};
    if (unit.process.if_no_file) if ((await Promise.all(unit.process.if_no_file.map(filePath => extendsFs.exists(filePath)))).find(a => a)) clean("error", new Error("File exists"));
    if (unit.preProcess) await postStart(unit, Array.isArray(unit.preProcess)?unit.preProcess:[unit.preProcess]);
    if (unit.process.dirs) await Promise.all(unit.process.dirs.map(async dirPath => {
      if (!(await extendsFs.exists(dirPath))) await fsPromise.mkdir(dirPath, {recursive: true});
      await fsPromise.chmod(dirPath, 7777);
      await fsPromise.chown(dirPath, user.uid, user.gid);
    }))
    return new Promise<void>((done, reject) => {
      unitProcess = childProcess.execFile({
        command: replaceEnv(unit.process.command, unit.process.env),
        args: unit.process.args.map(data => replaceEnv(data, unit.process.env)),
        options: {
          cwd: unit.process.cwd,
          uid: user.uid,
          gid: user.gid,
          env: unit.process.env,
          pipeProcess: SHOW_PROCESS_LOG === "verbose"?unit.name:undefined,
        }
      });
      unitProcess.stdout.on("data", data => logStdout.write(data));
      unitProcess.stderr.on("data", data => logStderr.write(data));
      unitProcess.on("error", err => {clean("error", err); return reject(err);});
      unitProcess.on("close", (code, signal) => {
        if (unit.process.restart === "no") return clean();
        else if (unit.process.restartCount && unit.process.restartCount > restartCount++) return clean();
        else if (unit.process.restart === "always") return restartProcess();
        else if (unit.process.restart === "on-error" && (code !== 0||signal !== null)) return restartProcess();
        return clean("no-restart");
      });
      unitProcess.on("spawn", async () => {
        if (unit.process.waitSeconds) await new Promise(done => setTimeout(done, unit.process.waitSeconds * 1000));
        if (unit.postStartProcess) await postStart(unit, Array.isArray(unit.postStartProcess)?unit.postStartProcess:[unit.postStartProcess]);
        return done();
      });
    });
  };

  async function stopProcess() {
    if (unitProcess.killed && unitProcess.exitCode !== null) unitProcess = undefined;
    else {
      unitProcess.kill("SIGQUIT");
      await new Promise<void>((done, reject) => {
        setTimeout(() => unitProcess.kill("SIGKILL"), unit.process.waitKill||2500);
        unitProcess.once("close", done);
        unitProcess.once("error", reject);
      });
    }
  }

  let restartCount = 0;
  async function restartProcess() {
    await clean("restart");
    if (unitProcess?.killed||unitProcess?.exitCode !== null) unitProcess = undefined;
    else await stopProcess().then(() => unitProcess = undefined);
    if (unit.onRestart) await postStart(unit, Array.isArray(unit.onRestart)?unit.onRestart:[unit.onRestart]);
    return startMainProcess();
  }

  await startMainProcess();
  globalProcess[unit.name] = {process: unitProcess, unit};

  // Childrens process
  let childs: processReturn[] = [];
  if (unit.dependecies) for (const dependecie of unit.dependecies) {
    if (typeof dependecie !== "string") startProcess(dependecie).then(child => childs.push(child)).catch(err => console.log("[%s]: Cannot start '%s' depencie, error:\r%o", unit.name, dependecie.name, err));
    else {
      if (filePath === undefined) {console.log("[%s]: Ignoring load file to '%s'", unit.name, dependecie); continue;};
      const realPath = path.resolve(filePath, dependecie);
      if (!(realPath.endsWith(".json")||realPath.endsWith(".yml")||realPath.endsWith(".yaml"))) {console.log("[%s]: Ignoring load file to '%s'", unit.name, realPath); continue;};
      await Promise.resolve().then(() => fsPromise.readFile(realPath, "utf8")).then(data => {
        const childUnit: unitProcessV2 = realPath.endsWith(".json")?JSON.parse(data):yaml.parse(data);
        return startProcess(childUnit, realPath);
      }).catch(err => console.log("[%s]: Cannot load depencie, error:\n%o", unit.name, err));
    }
  }

  return {
    name: unit.name,
    pid: unitProcess?.pid,
    restartProcess,
    stopProcess,
    childs
  };
}

export const filesToInitjs = /\.((c|m|)js|json|y[a]ml)$/;
async function loadDinits() {
  const folderDinit = [
    path.resolve(__dirname, "../initjs"),
  ];
  if (await extendsFs.exists("/etc/initjs")) folderDinit.push("/etc/initjs");
  if (await extendsFs.exists(path.join(process.cwd(), ".initjs"))) folderDinit.push(path.join(process.cwd(), ".initjs"));
  const files = (await extendsFs.readdirrecursive(folderDinit)).filter(file => filesToInitjs.test(file));
  const procs = {};
  await Promise.all(files.map(async file => {
    if (file.endsWith(".yml")||file.endsWith(".yaml")) {
      const yamlData: unitProcessV2 = yaml.parse(await fsPromise.readFile(file, "utf8"));
      procs[yamlData.name] = yamlData;
    } else if (file.endsWith(".json")) {
      const procConfig: unitProcessV2 = JSON.parse(await fsPromise.readFile(file, "utf8"));
      procs[procConfig.name] = procConfig;
    } else console.info("JS hasn't been implemented yet!");
  }));
  // console.log(procs);
  return Promise.all(Object.keys(procs).map(key => startProcess(procs[key])));
}

// Listen socket
export const socketListen = path.join(userInfo().username !== "root"?tmpdir():"/var/run", "initjs.sock");
export const app = express();
loadDinits().then(() => app.listen(socketListen, () => console.log("[Initjs]: All process started and sock listen on '%s'", socketListen)));
app.use(express.json());
app.use(express.urlencoded({extended: true}));