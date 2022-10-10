import * as customParseUnit from "./customParseUnit";
import { ChildProcess } from "node:child_process";
import customChild, { optionsExec } from "./process";
import path from "node:path";
import fs from "node:fs/promises";
import extendsFs, { exists } from "./extendsFs";
import userid from "userid";
export const unitsProcess = {};
export const SHOW_PROCESS_LOG: "verbose"|"quiet" = (["verbose", "quiet"]).find(type => type === process.env.INITD_LOG) as "verbose"|"quiet"||"quiet";

export class systemdError extends Error {
  unit: customParseUnit.unitSchema;
  constructor(err: string, unit: customParseUnit.unitSchema) {
    super(err);
    this.unit = unit;
  }
}

export const denyList = [
  "unbound",
  "unbound-resolvconf",
  "systemd-pstore",
  "networkd-dispatcher",
  "systemd-resolved"
]

export class registerUnit {
  process: ChildProcess;
  unit: customParseUnit.unitSchema;
  restartCount = 0;
  async restartProcess() {
    if (this.unit.Service.RestartSec) await new Promise(done => setTimeout(done, parseInt(this.unit.Service.RestartSec)*(1000*60)));
    if (this.unit.Service.ExecReload) {
      if (typeof this.unit.Service.ExecReload !== "string") this.unit.Service.ExecReload = this.unit.Service.ExecReload[0];
      const config: optionsExec = {
        command: this.unit.Service.ExecReload.replace(/^(-|\+|!!)/, ""),
        options: {
          // stdio: SHOW_PROCESS_LOG === "quiet" ? "ignore" : "inherit",
          cwd: this.unit.Service?.WorkingDirectory||"/",
          uid: userid.uid("root"),
          env: {
            MAINPID: this.process.pid?.toString()
          }
        }
      }
      await customChild.execAsync(config.command, config.options).catch(() => null);
    }
    return this.startProcess();
  }

  async startProcess() {
    const logPath = path.join("/var/log/initd_systemd", this.unit.Unit.Name);
    if (!await extendsFs.exists(logPath)) await fs.mkdir(logPath, {recursive: true});
    if (typeof this.unit.Service.ExecStart !== "string") this.unit.Service.ExecStart = this.unit.Service.ExecStart[this.unit.Service.ExecStart["length"] - 1];
    if (this.unit.Service.RuntimeDirectory) {
      const folderPath = path.join("/run", this.unit.Service.RuntimeDirectory);
      if (!await exists(folderPath)) await fs.mkdir(folderPath, {recursive: true});
      if (this.unit.Service.RuntimeDirectoryMode) await fs.chmod(folderPath, this.unit.Service.RuntimeDirectoryMode);
      if (this.unit.Service.User) await fs.chown(folderPath, userid.uid(this.unit.Service.User), userid.gid(this.unit.Service.User||"root"));
    }
    // const envs: NodeJS.ProcessEnv = {};
    if (this.unit.Service.Environment) {
      if (typeof this.unit.Service.Environment === "string") this.unit.Service.Environment = [this.unit.Service.Environment as string];
    }
    const config: optionsExec = {
      command: (((this.unit.Service.Environment as string[]||[]).join("; "))+(this.unit.Service.EnvironmentFile?await fs.readFile(this.unit.Service.EnvironmentFile, "utf8")+"; ":"")+" "+this.unit.Service.ExecStart.replace(/^(-|\+|!!)/, "")).trim(),
      options: {
        stdio: SHOW_PROCESS_LOG === "quiet" ? "ignore" : "inherit",
        cwd: this.unit.Service?.WorkingDirectory||"/",
        uid: userid.uid(this.unit.Service.User||"root"),
        logPath: {
          stdout: path.join(logPath, "stdout.log"),
          stderr: path.join(logPath, "stderr.log")
        },
      }
    }
    await fs.writeFile(path.join(logPath, "exec.json"), JSON.stringify(config, null, 2));
    this.process = customChild.exec(config);
    this.process.once("close", (code, signal): any => {
      this.restartCount++;
      if (this.restartCount < 200) {
        const Restart = this.unit.Service.Restart||"no";
        if (Restart === "on-failure" && code !== 0) return this.restartProcess();
        else if (Restart === "always") return this.restartProcess();
        else if (Restart === "on-abort" && signal === "SIGABRT") return this.restartProcess();
      };
      console.log("Process %s end and no restart", this.unit.Unit.Name);
      delete unitsProcess[this.unit.Unit.Name];
    });
  }

  constructor(unit: customParseUnit.unitSchema) {
    this.unit = unit;
    if (!this.unit.Unit.Name) throw new systemdError("Unregister name", unit);
    if (!this.unit.Service.ExecStart) throw new systemdError("ExecStart not defined", unit);
    if (unitsProcess[this.unit.Unit.Name]) throw new systemdError("is already running", unit);
    if (denyList.includes(this.unit.Unit.Name)) throw new systemdError(`deny, ${this.unit.Unit.Name}`, unit);
    this.startProcess().catch(() => {
      delete unitsProcess[this.unit.Unit.Name];
    });
    unitsProcess[this.unit.Unit.Name] = this;
  }
}