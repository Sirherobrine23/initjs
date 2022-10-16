export type { ChildProcess } from "node:child_process";
import child_process from "node:child_process";
import fs, { ObjectEncodingOptions } from "node:fs";
import readline from "node:readline";

export type logFile = {logPath?: {stdout: string, stderr?: string}};
export type optionsSpawnFile = {command: string, args?: string[], options?: fs.ObjectEncodingOptions & child_process.SpawnOptions & logFile};

export type pipeToProcess = {pipeProcess?: string};
export type optionsExec = {command: string, args?: string[], options?: fs.ObjectEncodingOptions & child_process.ExecOptions & logFile & pipeToProcess};
export type optionsExecFile = {command: string, args?: string[], options?: fs.ObjectEncodingOptions & child_process.ExecFileOptions & logFile & pipeToProcess};
export type ExecFileOptions = ObjectEncodingOptions & child_process.ExecFileOptions & pipeToProcess;
export type execAsyncOptions = child_process.ExecOptions & {encoding?: BufferEncoding} & pipeToProcess;

function pipeLog(exec: child_process.ChildProcess, logFiles: logFile["logPath"]) {
  if (logFiles.stderr) exec.stderr.pipe(fs.createWriteStream(logFiles.stderr));
  exec.stdout.pipe(fs.createWriteStream(logFiles.stdout));
}

function pipeToProcess(name: string, exec: child_process.ChildProcess, logFiles?: logFile["logPath"]) {
  const err = readline.createInterface(exec.stderr);
  err.on("error", () => {});
  err.on("line", data => console.log("[Stderr: %s]: %s", name, data));
  const out = readline.createInterface(exec.stdout);
  out.on("error", () => {});
  out.on("line", data => console.log("[Stdout: %s]: %s", name, data));
  exec.on("close", () => {err.close(); out.close()});
  if (logFiles) pipeLog(exec, logFiles);
  return exec;
}

// Default export
export default {spawn, exec, execAsync, execFile, execFileAsync};

export function spawn(processConfig: optionsSpawnFile) {
  if (!processConfig.args) processConfig.args = [];
  if (!processConfig.options) processConfig.options = {};
  processConfig.options.env = {...process.env, ...(processConfig.options.env||{})}
  const exec = child_process.spawn(processConfig.command, processConfig.args, processConfig.options);
  if (processConfig.options.stdio !== "inherit" && processConfig.options.logPath) pipeLog(exec, processConfig.options.logPath);
  return exec;
}

export function exec(processConfig: optionsExec) {
  if (!processConfig.args) processConfig.args = [];
  if (!processConfig.options) processConfig.options = {};
  processConfig.options.env = {...process.env, ...(processConfig.options.env||{})}
  const exec = child_process.exec(processConfig.command, processConfig.options);
  if (processConfig.options.pipeProcess) pipeToProcess(processConfig.options.pipeProcess, exec, processConfig.options.logPath);
  else if (processConfig.options.logPath) pipeLog(exec, processConfig.options.logPath);
  return exec;
}

export function execFile(processConfig: optionsExecFile) {
  if (!processConfig.args) processConfig.args = [];
  if (!processConfig.options) processConfig.options = {};
  processConfig.options.env = {...process.env, ...(processConfig.options.env||{})}
  const exec = child_process.execFile(processConfig.command, processConfig.args, processConfig.options);
  if (processConfig.options.pipeProcess) pipeToProcess(processConfig.options.pipeProcess, exec, processConfig.options.logPath);
  else if (processConfig.options.logPath) pipeLog(exec, processConfig.options.logPath);
  return exec;
}

export function execFileAsync(command: string): Promise<{stdout: string, stderr: string}>;
export function execFileAsync(command: string, args: (string|number)[]): Promise<{stdout: string, stderr: string}>;
export function execFileAsync(command: string, options: ExecFileOptions): Promise<{stdout: string, stderr: string}>;
export function execFileAsync(command: string, args: (string|number)[], options: ExecFileOptions): Promise<{stdout: string, stderr: string}>;
export function execFileAsync(command: string, args?: ExecFileOptions|(string|number)[], options?: ExecFileOptions) {
  let childOptions: ExecFileOptions = {};
  let childArgs: string[] = [];
  if (args instanceof Array) childArgs = args.map(String); else if (args instanceof Object) childOptions = args as ExecFileOptions;
  if (options) childOptions = options;
  childOptions.maxBuffer = Infinity;
  if (childOptions?.env) childOptions.env = {...process.env, ...childOptions.env};
  return new Promise<{stdout: string, stderr: string}>((resolve, rejectExec) => {
    child_process.execFile(command, childArgs.map(String), childOptions, (err, out, err2) => {if (err) return rejectExec(err);resolve({stdout: out, stderr: err2});});
  });
}

export function execAsync(command: string): Promise<{stdout: string, stderr: string}>;
export function execAsync(command: string, options: execAsyncOptions): Promise<{stdout: string, stderr: string}>;
export function execAsync(command: string, options?: execAsyncOptions) {
  let childOptions: execAsyncOptions = {};
  if (options) childOptions = options;
  if (childOptions?.env) childOptions.env = {...process.env, ...childOptions.env};
  return new Promise<{stdout: string, stderr: string}>((resolve, rejectExec) => {
    child_process.exec(command, {...childOptions}, (err, out: string|Buffer, err2: string|Buffer) => {if (err) return rejectExec(err);resolve({stdout: ((out instanceof Buffer) ? out.toString():out), stderr: (err2 instanceof Buffer)?err2.toString():err2});});
  });
}