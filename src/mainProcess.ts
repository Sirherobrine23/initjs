import * as coreUtils from "@the-bds-maneger/core-utils";
import { EventEmitter } from "node:events";
import { createInterface as readlineCreateInterface } from "node:readline";
import https from "node:https";
import path from "node:path";
import fs from "node:fs/promises";
import yaml from "yaml";
import userid from "userid";
import express from "express";
import child_process from "node:child_process";

export type processConfig<moreOptions extends {} = {}> = {
  command: string,
  args?: string[],
  user?: string|number,
  group?: string|number,
  env?: NodeJS.ProcessEnv,
  cwd?: string,
  dirs?: string[],
  waitSeconds?: number,
} & moreOptions;

export type initjs_config_file = {
  name: string,
  description?: string,
  platforms?: NodeJS.Platform[],
  process: processConfig<{restart?: "always"|"no"|"on-error", restartCount?: number, waitKill?: number, if_no_file?: string[]}>,
  preStart?: processConfig|processConfig[],
  postStart?: processConfig|processConfig[],
  preRestart?: processConfig|processConfig[],
  restartProcess?: processConfig,
  dependecies?: (string|initjs_config_file)[],
  childres?: initjs_config_file[],
};

export type initjs_process = {
  status: "running"|"restarting"|"stoped"|"starting",
  name: string,
  config: initjs_config_file,
  restartCount: number,
  childrens?: string[],
  lockToUpdate?: boolean,
  childProcess?: child_process.ChildProcess,
};

export declare interface mainProcess {
  // Error emit
  emit(act: "error", data: any): boolean;
  /** if an error occurs, it will be issued here, and if a callback is not added, an error will be thrown to the Nodejs process (`process.on("unhandledRejection")`) */
  on(act: "error", fn: (data: any) => void): this;
  /** If a process issues an error, it will be passed here */
  on(act: "error", fn: (data: {error: any, name: string}) => void): this;

  // Process log
  emit(act: "log", data: {name: string, data: string, from: "stdout"|"stderr"}): boolean;
  /** All process logs will be issued here ('log'), and an object will be returned with the name of the process and the log in the 'data' tag */
  on(act: "log", fn: (data: {name: string, data: string, from: "stdout"|"stderr"}) => void): this;
  /** All process logs will be issued here ('log'), and an object will be returned with the name of the process and the log in the 'data' tag */
  once(act: "log", fn: (data: {name: string, data: string, from: "stdout"|"stderr"}) => void): this;

  // Process exit
  emit(act: "processExit", data: {name: string, signal?: NodeJS.Signals, code?: number}): boolean;
  on(act: "processExit", fn: (data: {name: string, signal?: NodeJS.Signals, code?: number}) => void): this;
  once(act: "processExit", fn: (data: {name: string, signal?: NodeJS.Signals, code?: number}) => void): this;

  // no restart process
  emit(act: "noRestart", data: {name: string, signal?: NodeJS.Signals, code?: number}): boolean;
  on(act: "noRestart", fn: (data: {name: string, signal?: NodeJS.Signals, code?: number}) => void): this;
  once(act: "noRestart", fn: (data: {name: string, signal?: NodeJS.Signals, code?: number}) => void): this;

  // spawn process
  emit(act: "spawn", data: {name: string}): boolean;
  on(act: "spawn", fn: (data: {name: string}) => void): this;
  once(act: "spawn", fn: (data: {name: string}) => void): this;
};

export type mainProcessOptions = {
  socketPath: string|{path: string, owner?: string, callback?: () => void},
  httpPort?: number|{port: number, callback?: () => void, https?: {cert: string, key: string}},
  initjsFolder?: string[]
}

export type processList = {[name: string]: initjs_process};

export type apiProcessList = {
  [name: string]: initjs_process & {
    childProcess: undefined,
    pid?: number
  }
};

/**
 * Create process listen socket and http(s) server to maneger remotely process maneger
*/
export class mainProcess extends EventEmitter {
  processList: processList = {};
  async deleteProcess(name: string) {
    if (!name) throw new Error("name is blank");
    if (!Object.keys(this.processList).includes(name)) throw new Error("Process not exists");
    if (this.processList[name].status !== "stoped") {
      this.processList[name].childProcess?.kill("SIGKILL");
      await new Promise(done => this.processList[name].childProcess.once("close", done));
    }
    delete this.processList[name];
  }

  async updateConfig(newConfig: initjs_config_file) {
    if (!this.processList[newConfig.name]) return this.registerProcess(newConfig);
    this.processList[newConfig.name].lockToUpdate = true;
    if (this.processList[newConfig.name].status !== "stoped") {
      this.processList[newConfig.name].childProcess?.kill("SIGKILL");
      await new Promise(done => this.processList[newConfig.name].childProcess.once("close", done));
    }
    this.processList[newConfig.name].config = newConfig;
    this.processList[newConfig.name].lockToUpdate = false;
    return this.registerProcess(newConfig, true);
  }

  async registerProcess(config: initjs_config_file, isRestart = false): Promise<void|initjs_process> {
    if (!config) throw new Error("Invalid config");
    if (this.processList[config.name] && !isRestart) throw new Error(`Process name (${config.name}) exists`);
    if ((config.dependecies && config.dependecies?.length > 0) && !isRestart) {
      if (config.dependecies.filter(dep => typeof dep === "string").some(name => !this.processList[name as string])) throw new Error("Dependecie not running");
      await Promise.all(config.dependecies.map(async (dependecie: initjs_config_file) => {
        if (typeof dependecie === "string") return null;
        return this.registerProcess(dependecie);
      }));
    }

    // Platform
    if (config.platforms) if (!config.platforms.includes(process.platform) && process.platform.length > 0) throw new Error(`Platform no avaible, avaible: '${config.platforms.join(", ")}', current: '${process.platform}'`);

    // Add config list
    if (!this.processList[config.name]) this.processList[config.name] = {name: config.name, status: "starting", restartCount: 0, lockToUpdate: false, childrens: config.dependecies?.map(data => typeof data === "string"?data:data.name), config};
    else {
      this.processList[config.name].status = "restarting";
      this.processList[config.name].restartCount++;
      if (!(config.process.restartCount === 0||config.process.restartCount === null) && (this.processList[config.name].restartCount > (config.process.restartCount||25))) {
        this.processList[config.name].status = "stoped";
        return;
      }
    }
    // Run external process
    async function syncRun(processConfig: processConfig) {
      if (processConfig.dirs) await Promise.all(processConfig.dirs.map(async folderDir => {
        folderDir = path.resolve(processConfig.cwd, folderDir);
        if (!await coreUtils.extendFs.exists(folderDir)) await fs.mkdir(folderDir, {recursive: true});
        await fs.chmod(folderDir, "7777");
        if (processConfig.user && processConfig.group) {
          if (typeof processConfig.user === "string") processConfig.user = userid.uid(processConfig.user);
          if (typeof processConfig.group === "string") processConfig.group = userid.gid(processConfig.group);
          await fs.chown(folderDir, processConfig.user, processConfig.group);
        }
      }));

      if (!processConfig.args) await coreUtils.customChildProcess.execAsync(processConfig.command, {maxBuffer: Infinity, cwd: processConfig.cwd, env: processConfig.env});
      else await coreUtils.customChildProcess.execFileAsync(processConfig.command, processConfig.args, {maxBuffer: Infinity, cwd: processConfig.cwd, env: processConfig.env});
      if (processConfig.waitSeconds) await new Promise(done => setTimeout(done, processConfig.waitSeconds*1000));
    }

    // PRE-process start
    if (config.preStart) {
      if (Array.isArray(config.preStart)) await Promise.all(config.preStart.map(data => syncRun(data)));
      else await syncRun(config.preStart);
    };

    // Start process
    const runProcess = config.process;
    if (runProcess.args) this.processList[config.name].childProcess = child_process.execFile(runProcess.command, runProcess.args, {
      maxBuffer: Infinity,
      cwd: runProcess.cwd,
      env: runProcess.env,
      ...(!runProcess.user?{}:{uid: typeof runProcess.user === "number"?runProcess.user:userid.uid(runProcess.user)}),
      ...(!runProcess.group?{}:{gid: typeof runProcess.group === "number"?runProcess.group:userid.gid(runProcess.group)}),
    }); else this.processList[config.name].childProcess = child_process.exec(runProcess.command, {
      maxBuffer: Infinity,
      cwd: runProcess.cwd,
      env: runProcess.env,
      ...(!runProcess.user?{}:{uid: typeof runProcess.user === "number"?runProcess.user:userid.uid(runProcess.user)}),
      ...(!runProcess.group?{}:{gid: typeof runProcess.group === "number"?runProcess.group:userid.gid(runProcess.group)}),
    });
    const local_ChildProcess = this.processList[config.name].childProcess;
    local_ChildProcess.on("error", err => this.emit("error", {error: err, processName: config.name}));
    const stdoutLine = readlineCreateInterface(local_ChildProcess.stdout).on("line", data => this.emit("log", {from: "stdout", name: config.name, data})).on("error", () => {});
    const stderrLine = readlineCreateInterface(local_ChildProcess.stderr).on("line", data => this.emit("log", {from: "stderr", name: config.name, data})).on("error", () => {});
    local_ChildProcess.on("close", async (code, signal) => {
      this.emit("processExit", {name: config.name, code, signal});
      this.processList[config.name].status = "stoped";
      this.processList[config.name].childProcess = undefined;
      stdoutLine.close();
      stderrLine.close();
      if (!this.processList[config.name].lockToUpdate) {
        if (runProcess.restart === "always"||runProcess.restart === "on-error") {
          if (runProcess.restart === "always") return this.registerProcess(config, true);
          if (code !== 0) return this.registerProcess(config, true).catch(err => this.emit("error", err));
        }
        return this.emit("noRestart", {name: config.name, code, signal});
      }
      return null;
    });
    await new Promise((done, reject) => {local_ChildProcess.once("error", reject); local_ChildProcess.once("spawn", done);});
    this.processList[config.name].status = "running";
    this.emit("spawn", {name: config.name});
    if (runProcess.waitSeconds) await new Promise(done => setTimeout(done, runProcess.waitSeconds*1000));
    if (config.postStart) {
      if (Array.isArray(config.postStart)) await Promise.all(config.postStart.map(data => syncRun(data)));
      else await syncRun(config.postStart);
    }

    // Process after start process
    if (config.childres && !isRestart) await Promise.all(config.childres.map(config => this.registerProcess(config).catch(err => this.emit("error", err))));

    return this.processList[config.name];
  }

  constructor(options: mainProcessOptions) {
    const { socketPath, httpPort } = options;
    super(); const app = express();
    app.use(express.json(), express.urlencoded({extended: true}));
    app.post("/", (req, res) => this.registerProcess(req.body).then(data => res.json({...data, childProcess: undefined,})).catch(err => res.status(400).json({err: err?.message||err})));
    app.put("/", (req, res) => this.updateConfig(req.body).then(data => res.json({...data, childProcess: undefined,})).catch(err => res.status(400).json({err: err?.message||err})));
    app.delete("/", (req, res) => this.deleteProcess(req.body?.name).then(() => res.json({ok: true})).catch(err => res.status(400).json({err: err?.message||err})));
    app.get("/", ({res}) => res.json(Object.keys(this.processList).reduce((mount, id) => {
      const data = this.processList[id];
      mount[id] = {
        ...data,
        childProcess: undefined,
        pid: data?.childProcess?.pid
      };
      return mount;
    }, {} as apiProcessList)));

    coreUtils.extendFs.exists(typeof socketPath === "string"?socketPath:socketPath.path).then(async exist => {
      if (exist) await fs.rm(typeof socketPath === "string"?socketPath:socketPath.path);
      app.listen(typeof socketPath === "string"?socketPath:socketPath.path, async () => {
        if (typeof socketPath === "string") return;
        if (socketPath.callback) socketPath.callback();
      });
    });
    if (httpPort) {
      if (typeof httpPort === "number") app.listen(httpPort);
      else {
        if (httpPort.port === undefined) httpPort.port = 0;
        const httpCallback = () => {if (httpPort.callback) httpPort.callback();};
        if (!httpPort.https) app.listen(httpPort.port, httpCallback)
        else https.createServer({cert: httpPort.https.cert, key: httpPort.https.key}, app).listen(httpPort.port, httpCallback);
      }
    };

    // Load init files
    if (options.initjsFolder?.length > 0) {
      Promise.all(options.initjsFolder.map(async folderPath => {
        const initfolder = path.join(process.cwd(), folderPath);
        if (!await coreUtils.extendFs.exists(initfolder)) return null;
        const files = (await coreUtils.extendFs.readdirrecursive(initfolder)).filter(file => /\.(json|y[a]ml)$/.test(file as string)) as string[];
        return Promise.all(files.map(async file => fs.readFile(file, "utf8").then(data => file.endsWith(".json")?JSON.parse(data):yaml.parse(data)).then(config => this.registerProcess(config)))).catch(err => this.emit("error", err));
      })).catch(err => this.emit("error", err));;
    }
  }
}