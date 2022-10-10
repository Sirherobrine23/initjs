import { createWriteStream, WriteStream } from "node:fs";
import customProcess, {ChildProcess, optionsExecFile} from "./process";
import extendsFs, { exists } from "./extendsFs";
import path from "node:path";
import fs from "node:fs/promises";
import { uid } from "userid";

const servicesStorages = {default: path.join(process.cwd(), "dinit"), fist: "/etc/dinit", second: "/var/lib/dinit", three: path.join(__dirname, "../dinit")};
export const SHOW_PROCESS_LOG: "verbose"|"quiet" = (["verbose", "quiet"]).find(type => type === process.env.INITD_LOG) as "verbose"|"quiet"||"quiet";
export const processSessions: {[keyName: string]: serviceUnit} = {};
export const regexValid = /\.((c|m|)js|json)$/;
export const varLog = "/var/log";
// const runTest = setInterval(() => {
//   if (Object.keys(processSessions).length === 0) {
//     clearInterval(runTest);
//     console.info("No process sessions");
//   }
// }, 1500);

export type processConfig<moreOptions = any> = {
  command: string,
  args?: string[],
  user?: string|number,
  env?: NodeJS.ProcessEnv,
  cwd?: string,
  more?: moreOptions,
};

export type servicesV1 = {
  name: string,
  process: processConfig<{restart?: "always"|"no"|"on-error", restartCount?: number}>,
  preProcess?: processConfig|processConfig[],
  restartProcess?: processConfig,
  onRestart?: processConfig
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

  async restartProcess() {
    if (this.config.onRestart) {
      if (this.config.onRestart.args) await customProcess.execFileAsync(this.config.onRestart.command, this.config.onRestart.args, {cwd: this.config.onRestart.cwd, env: this.config.onRestart.env});
      else await customProcess.execFileAsync(this.config.onRestart.command, {cwd: this.config.onRestart.cwd, env: this.config.onRestart.env});
    }
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
        stdio: SHOW_PROCESS_LOG === "verbose"?"inherit":"ignore",
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
        stdio: SHOW_PROCESS_LOG === "verbose"?"inherit":"ignore",
        uid: 0,
      });
    }

    // Main process
    this.process = customProcess.execFile(this.processConfig);
    this.process.stdout.on("data", data => this.logStdout.write(data));
    this.process.stderr.on("data", data => this.logStderr.write(data));
    this.process.on("close", async (code, signal) => {
      if (this.config.process.more?.restartCount === 0|| this.countRestart++ < ((this.config.process.more?.restartCount||50))) {
        if (this.config.process.more?.restart === "always"||(this.config.process.more?.restart === "on-error" && code !== 0)) {
          await this.restartProcess();
          return this.startProcess();
        }
      }
      delete processSessions[this.config.name];
      console.log("Process '%s' no restart, exit code/signal %o", this.config.name, signal||code);
      this.logStdout.close();
      this.logStderr.close();
    });
    console.info("Process '%s' started", this.config.name);
    return fs.writeFile(path.join(logRoot, "exec.json"), JSON.stringify(this.processConfig, null, 2));
  }
  constructor(unit: servicesV1) {
    if (processSessions[unit.name]) throw new Error(`${unit.name} is already running.`);
    this.config = unit;
    processSessions[unit.name] = this;
    this.startProcess();
  }
}


export async function startAllServices(){
  const scripts = [];
  if (await extendsFs.exists(servicesStorages.default)) scripts.push(servicesStorages.default);
  if (await extendsFs.exists(servicesStorages.fist)) scripts.push(servicesStorages.fist);
  if (await extendsFs.exists(servicesStorages.second)) scripts.push(servicesStorages.second);
  if (await extendsFs.exists(servicesStorages.three)) scripts.push(servicesStorages.three);
  return Promise.all((await extendsFs.readdirrecursive(scripts)).filter(file => file.endsWith(".json")).map(async fileConfig => new serviceUnit(JSON.parse(await fs.readFile(fileConfig, "utf8")))));
}