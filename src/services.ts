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

export type processConfig<moreOptions = any> = {
  command: string,
  args?: string[],
  user?: string|number,
  group?: string|number,
  env?: NodeJS.ProcessEnv,
  cwd?: string,
  more?: moreOptions,
};

export type servicesV1 = {
  name: string,
  process: processConfig<{restart?: "always"|"no"|"on-error", restartCount?: number}>,
  preProcess?: processConfig|processConfig[],
  restartProcess?: processConfig,
  onRestart?: processConfig,
  dependecies?: servicesV1[]
};

export const replaceEnv = /\$(|\{)([0-9A-Za-z_\-\+]+)(\}|)/;
export function replaceEnvCommand(command: string, env: processConfig["env"]): string {
  while (replaceEnv.test(command)) command = command.replace(replaceEnv, (_0, _1, arg) => env[arg?.replace("$", "")||""]||process.env[arg?.replace("$", "")||""]||"");
  return command;
}

export class serviceUnit {
  config: servicesV1;
  logStdout: WriteStream;
  logStderr: WriteStream;
  process: ChildProcess;
  processConfig: optionsExecFile;
  countRestart = 0;
  subProcess: serviceUnit[] = []

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

  async startProcess(){
    const logRoot = path.join(varLog, "initd", this.config.name);
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

    // Main process
    this.process = customProcess.execFile(this.processConfig);
    this.process.stdout.on("data", data => this.logStdout.write(data));
    this.process.stderr.on("data", data => this.logStderr.write(data));
    this.process.on("close", async (code, signal) => {
      if (this.config.process.more?.restart === "always"||(this.config.process.more?.restart === "on-error" && code !== 0)) {
        if (this.config.process.more?.restartCount) {
          if (this.countRestart++ < (this.config.process.more?.restartCount)) return this.#delete(signal||code);
        }
        await this.restartProcess().catch(err => this.#delete(err));
        return this.startProcess().catch(err => this.#delete(err));
      }
      return this.#delete(signal||code);
    });
    console.info("Process '%s' started", this.config.name);
    return fs.writeFile(path.join(logRoot, "exec.json"), JSON.stringify(this.processConfig, null, 2));
  }
  constructor(unit: servicesV1) {
    if (processSessions[unit.name]) throw new Error(`${unit.name} is already running.`);
    this.config = unit;
    processSessions[unit.name] = this;
    if (unit.dependecies) for (const dependecie of unit.dependecies) this.subProcess.push(new serviceUnit(dependecie));
    this.startProcess().catch(err => this.#delete(err));
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
  const scripts = [];
  if (await extendsFs.exists(servicesStorages.default)) scripts.push(servicesStorages.default);
  if (await extendsFs.exists(servicesStorages.fist)) scripts.push(servicesStorages.fist);
  if (await extendsFs.exists(servicesStorages.second)) scripts.push(servicesStorages.second);
  if (await extendsFs.exists(servicesStorages.three)) scripts.push(servicesStorages.three);
  return Promise.all((await extendsFs.readdirrecursive(scripts)).filter(file => file.endsWith(".json")).map(async fileConfig => {
    try {
      return new serviceUnit(JSON.parse(await fs.readFile(fileConfig, "utf8")))
    } catch (err) {
      return console.error(err);
    }
  }).filter(a => !!a));
}