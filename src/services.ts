import { createWriteStream, WriteStream } from "node:fs";
import customProcess, {ChildProcess, optionsExecFile} from "./process";
import extendsFs, { exists } from "./extendsFs";
import path from "node:path";
import fs from "node:fs/promises";
import { uid } from "userid";

const servicesStorages = {default: path.join(process.cwd(), "dinit"), fist: "/etc/dinit", second: "/var/lib/dinit"};
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
  preProcess?: processConfig,
  process: processConfig<{restart?: "always"|"no"|"on-error", restartCount?: number}>,
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

    if (this.config.preProcess) {
      if (this.config.preProcess.args) await customProcess.execFileAsync(this.config.preProcess.command, this.config.preProcess.args, {cwd: this.config.preProcess.cwd, env: this.config.preProcess.env});
      else await customProcess.execFileAsync(this.config.preProcess.command, {cwd: this.config.preProcess.cwd, env: this.config.preProcess.env});
    }

    // Update env
    if (this.config.process.env) for (const key of Object.keys(this.config.process.env)) this.config.process.env[key] = replaceEnvCommand(this.config.process.env[key], this.config.process.env);
    if (this.config.process.args) this.config.process.command = replaceEnvCommand(this.config.process.command, this.config.process.env);
    if (this.config.process.args) for (const key in this.config.process.args) this.config.process.args[key] = replaceEnvCommand(this.config.process.args[key], this.config.process.env);

    this.processConfig = {
      command: this.config.process.command,
      args: this.config.process.args,
      options: {
        cwd: this.config.process.cwd||"/",
        env: this.config.process.env,
        maxBuffer: Infinity,
        uid: this.config.process.user?(typeof this.config.process.user === "string"?uid(this.config.process.user):this.config.process.user):0,
      }
    };
    this.process = customProcess.execFile(this.processConfig);

    // Write data to Log
    this.process.stdout.on("data", data => this.logStdout.write(data));
    this.process.stderr.on("data", data => this.logStderr.write(data));

    this.process.on("close", async code => {
      if (this.config.process.more?.restartCount === 0|| this.countRestart++ < ((this.config.process.more?.restartCount||50))) {
        if (this.config.process.more?.restart === "always"||(this.config.process.more?.restart === "on-error" && code !== 0)) {
          await this.restartProcess();
          return this.startProcess();
        }
      }
      delete processSessions[this.config.name];
      console.log("Process '%s' no restart", this.config.name);
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
  return Promise.all((await extendsFs.readdirrecursive(scripts)).filter(file => file.endsWith(".json")).map(async fileConfig => new serviceUnit(JSON.parse(await fs.readFile(fileConfig, "utf8")))));
}