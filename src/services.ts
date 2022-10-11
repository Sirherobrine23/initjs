import { createWriteStream, WriteStream } from "node:fs";
import customProcess, {ChildProcess, optionsExecFile} from "./process";
import extendsFs, { exists } from "./extendsFs";
import path from "node:path";
import fs from "node:fs/promises";
import { gid, uid } from "userid";
export type logType = "verbose"|"quiet";
export const SHOW_PROCESS_LOG: logType = (["verbose", "quiet"] as logType[]).find(type => type === process.env.INITD_LOG)||"quiet";
export const processSessions: {[keyName: string]: serviceUnit} = {};
export const regexValid = /\.((c|m|)js|json)$/;
export const varLog = "/var/log";

process.once("exit", () => Object.keys(processSessions).forEach(key => processSessions[key].stopExit()));
if ((["on", "1", "true"]).includes(process.env.INITD_NO_EXIT)) {
  const verifyInterval = setInterval(() => {
    if (Object.keys(processSessions).length > 0) return;
    return console.info("No process to run");
  }, 1000);
  process.once("exit", () => clearInterval(verifyInterval));
}

export const replaceEnv = /\$(|\{)([\W\S]+)(\}|)/;
export function replaceEnvCommand(command: string, env: processConfig["env"]): string {
  while (replaceEnv.test(command)) command = command.replace(replaceEnv, (_0, _1, arg) => env[arg?.replace("$", "")||""]||process.env[arg?.replace("$", "")||""]||"");
  return command;
}

export type processConfig<moreOptions = any> = {
  command: string,
  args?: string[],
  user?: string|number,
  group?: string|number,
  env?: NodeJS.ProcessEnv,
  cwd?: string,
  dirs?: string[],
  waitSeconds?: number,
} & moreOptions;

export type servicesV1 = {
  name: string,
  preProcess?: processConfig|processConfig[],
  process: processConfig<{restart?: "always"|"no"|"on-error", restartCount?: number}>,
  postStartProcess?: processConfig<{catchError?: boolean}>|processConfig<{catchError?: boolean}>[],
  restartProcess?: processConfig,
  onRestart?: processConfig,
  dependecies?: servicesV1[]
};

export class serviceUnit {
  config: servicesV1;
  logStdout: WriteStream;
  logStderr: WriteStream;
  process: ChildProcess;
  processConfig: optionsExecFile;
  countRestart = 0;
  subProcess: serviceUnit[] = [];

  async restartProcess() {
    if (this.config.onRestart) {
      if (this.config.onRestart.args) await customProcess.execFileAsync(this.config.onRestart.command, this.config.onRestart.args, {cwd: this.config.onRestart.cwd, env: this.config.onRestart.env});
      else await customProcess.execFileAsync(this.config.onRestart.command, {cwd: this.config.onRestart.cwd, env: this.config.onRestart.env});
    }
  }

  async stopExit() {
    return new Promise<number>((done, reject) => {
      this.process.once("error", reject);
      const timeout = setTimeout(() => this.process.kill("SIGKILL"), 5000);
      this.process.once("close", code => {
        done(code);
        clearTimeout(timeout);
      });
    });
  }

  #delete(status: any) {
    delete processSessions[this.config.name];
    console.log("Process '%s' no restart, exit code/signal/Error: %o", this.config.name, status);
    if (this.logStdout) this.logStdout.close();
    if (this.logStderr) this.logStderr.close();
  }

  depenciesLoaded = false;
  async #loadDepencies() {
    if (this.depenciesLoaded) return;
    if (this.config.dependecies) this.subProcess = await Promise.all(this.config.dependecies.map(async dependecie => new serviceUnit(dependecie)));
    this.depenciesLoaded = true;
  }

  async startProcess(){
    const logRoot = path.join(varLog, "initjs", this.config.name);
    if (!await exists(logRoot)) await fs.mkdir(logRoot, {recursive: true});
    if (!this.logStdout) this.logStdout = createWriteStream(path.join(logRoot, "stdout.log"));
    if (!this.logStderr) this.logStderr = createWriteStream(path.join(logRoot, "stderr.log"));
    this.processConfig = {
      command: this.config.process.command,
      args: this.config.process.args,
      options: {
        cwd: this.config.process.cwd||"/",
        env: this.config.process.env,
        maxBuffer: Infinity,
        uid: this.config.process.user?(typeof this.config.process.user === "string"?uid(this.config.process.user):this.config.process.user):0,
        gid: this.config.process.group?(typeof this.config.process.group === "string"?gid(this.config.process.group):this.config.process.group):0,
        pipeProcess: SHOW_PROCESS_LOG === "verbose",
      }
    };

    // Update env
    if (this.config.process.env) for (const key of Object.keys(this.config.process.env)) this.config.process.env[key] = replaceEnvCommand(this.config.process.env[key], this.config.process.env);
    if (this.config.process.args) this.config.process.command = replaceEnvCommand(this.config.process.command, this.config.process.env);
    if (this.config.process.args) for (const key in this.config.process.args) this.config.process.args[key] = replaceEnvCommand(this.config.process.args[key], this.config.process.env);

    if (this.config.preProcess) {
      if (!Array.isArray(this.config.preProcess)) this.config.preProcess = [this.config.preProcess];
      for (const preProcess of this.config.preProcess) await customProcess.execFileAsync(replaceEnvCommand(preProcess.command, this.config.process.env), (preProcess.args||[]).map(key => replaceEnvCommand(key, this.config.process.env)), {
        ...this.processConfig.options,
        pipeProcess: SHOW_PROCESS_LOG === "verbose",
        uid: 0,
      });
    }

    // Dirs
    if (this.config.process.dirs) {
      await Promise.all(this.config.process.dirs.map(async dirPath => {
        dirPath = path.resolve(dirPath);
        if (!await exists(dirPath)) {
          await fs.mkdir(dirPath, {recursive: true});
          await fs.chown(dirPath, this.processConfig.options.uid, this.processConfig.options.gid);
        }
      }));
    }

    // Main process
    await fs.writeFile(path.join(logRoot, "exec.json"), JSON.stringify(this.processConfig, null, 2));
    this.process = customProcess.execFile(this.processConfig);
    this.process.stdout.on("data", data => this.logStdout.write(data));
    this.process.stderr.on("data", data => this.logStderr.write(data));
    this.process.on("close", async (code, signal) => {
      if (this.config.process.restart === "no") return this.#delete(signal||code);
      else if (this.config.process.restartCount && this.countRestart++ >= this.config.process.restartCount) return this.#delete(signal||code);
      else if (this.config.process.restart === "always") return await this.restartProcess().then(this.startProcess).catch(err => this.#delete(err));
      else if (this.config.process.restart === "on-error" && code !== 0) return await this.restartProcess().then(this.startProcess).catch(err => this.#delete(err));
      return this.#delete(signal||code);
    });

    // Return
    return new Promise<this>((done, reject) => {
      this.process.once("error", reject);
      this.process.once("spawn", async () => {
        console.info("Process '%s' started", this.config.name);
        if (this.config.process.waitSeconds) await new Promise(done => setTimeout(done, this.config.process.waitSeconds * 1000));
        if (this.config.postStartProcess) {
          if (!Array.isArray(this.config.postStartProcess)) this.config.postStartProcess = [this.config.postStartProcess];
          for (const postProcess of this.config.postStartProcess) {
            if (!postProcess.args) postProcess.args = [];
            try {
              await customProcess.execFileAsync(replaceEnvCommand(postProcess.command, this.processConfig.options.env), postProcess.args.map(a => replaceEnvCommand(a, this.processConfig.options.env)), {
                cwd: postProcess.cwd,
                env: postProcess.env,
                uid: postProcess.user?(typeof postProcess.user === "string"?uid(postProcess.user):postProcess.user):0,
                gid: postProcess.group?(typeof postProcess.group === "string"?uid(postProcess.group):postProcess.group):0,
                pipeProcess: SHOW_PROCESS_LOG === "verbose"
              });
            } catch (err) {
              if (postProcess.catchError) {
                console.trace("Post process to '%s' catch error: %o", this.config.name, err);
                continue;
              }
              throw err;
            }
          }
        }
        await this.#loadDepencies();
        return done(this);
      });
    });
  }

  constructor(unit: servicesV1, loadStart = true) {
    if (processSessions[unit.name]) throw new Error(`${unit.name} is already running.`);
    processSessions[unit.name] = this;
    this.config = unit;
    if (loadStart) this.startProcess().catch(err => console.trace(err));
  }
}

// Paths to load scripts
const servicesStorages = {
  default: path.join(__dirname, "../dinit"),
  fist: "/etc/dinit",
  second: "/var/lib/dinit",
  three: path.join(process.cwd(), "dinit")
};

export async function startAllServices(){
  const processUnitsObject: {[name: string]: servicesV1} = {};
  const scripts = [];
  if (await extendsFs.exists(servicesStorages.default)) scripts.push(servicesStorages.default);
  if (await extendsFs.exists(servicesStorages.fist)) scripts.push(servicesStorages.fist);
  if (await extendsFs.exists(servicesStorages.second)) scripts.push(servicesStorages.second);
  if (await extendsFs.exists(servicesStorages.three)) scripts.push(servicesStorages.three);
  await Promise.all((await extendsFs.readdirrecursive(scripts)).filter(file => file.endsWith(".json")).map(async fileConfig => {const data: servicesV1 = JSON.parse(await fs.readFile(fileConfig, "utf8")); processUnitsObject[data.name] = data;}))
  return Promise.all(Object.keys(processUnitsObject).map(key => (new serviceUnit(processUnitsObject[key], false)).startProcess()));
}