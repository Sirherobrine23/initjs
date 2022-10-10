import child_process from "node:child_process";
import fs, { ObjectEncodingOptions } from "node:fs";
export default {spawn, exec, execAsync, execFile, execFileAsync};
export type logFile = {
  logPath?: {
    stdout: string,
    stderr?: string
  },
};

export type optionsSpawnFile = {command: string, args?: string[], options?: fs.ObjectEncodingOptions & child_process.SpawnOptions & logFile};
export function spawn(processConfig: optionsSpawnFile) {
  if (!processConfig.args) processConfig.args = [];
  if (!processConfig.options) processConfig.options = {};
  processConfig.options.env = {...process.env, ...(processConfig.options.env||{})}
  const exec = child_process.spawn(processConfig.command, processConfig.args, processConfig.options);
  if (processConfig.options.stdio !== "inherit") {
    if (processConfig.options.logPath) {
      exec.stdout.pipe(fs.createWriteStream(processConfig.options.logPath.stdout));
      if (processConfig.options.logPath.stderr) exec.stderr.pipe(fs.createWriteStream(processConfig.options.logPath.stderr));
    }
  }
  return exec;
}

export type optionsExec = {command: string, args?: string[], options?: fs.ObjectEncodingOptions & child_process.ExecOptions & logFile & {stdio?: "ignore"|"inherit"}};
export function exec(processConfig: optionsExec) {
  if (!processConfig.args) processConfig.args = [];
  if (!processConfig.options) processConfig.options = {};
  processConfig.options.env = {...process.env, ...(processConfig.options.env||{})}
  const exec = child_process.exec(processConfig.command, processConfig.options);
  if (processConfig.options.stdio !== "inherit") {
    exec.stdout.on("data", data => process.stdout.write(data));
    exec.stderr.on("data", data => process.stderr.write(data));
  } else {
    if (processConfig.options.logPath) {
      exec.stdout.pipe(fs.createWriteStream(processConfig.options.logPath.stdout));
      if (processConfig.options.logPath.stderr) exec.stderr.pipe(fs.createWriteStream(processConfig.options.logPath.stderr));
    }
  }
  return exec;
}

export type optionsExecFile = {command: string, args?: string[], options?: fs.ObjectEncodingOptions & child_process.ExecFileOptions & logFile & {stdio?: "ignore"|"inherit"}};
export function execFile(processConfig: optionsExecFile) {
  if (!processConfig.args) processConfig.args = [];
  if (!processConfig.options) processConfig.options = {};
  processConfig.options.env = {...process.env, ...(processConfig.options.env||{})}
  const exec = child_process.spawn(processConfig.command, processConfig.args, processConfig.options);
  if (processConfig.options.logPath) {
    if (processConfig.options.logPath.stderr) exec.stderr.pipe(fs.createWriteStream(processConfig.options.logPath.stderr));
    exec.stdout.pipe(fs.createWriteStream(processConfig.options.logPath.stdout));
  }
  if (processConfig.options.stdio === "inherit") {
    exec.stdout.on("data", data => process.stdout.write(data));
    exec.stderr.on("data", data => process.stderr.write(data));
    process.stdin.pipe(exec.stdin);
    process.stdin.setMaxListeners(0);
    exec.on("close", () => process.stdin.unpipe(exec.stdin));
  }
  return exec;
}

export type ExecFileOptions = ObjectEncodingOptions & child_process.ExecFileOptions & {stdio?: "ignore"|"inherit"};
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
    const child = child_process.execFile(command, childArgs.map(String), childOptions, (err, out, err2) => {if (err) return rejectExec(err);resolve({stdout: out, stderr: err2});});
    if (options?.stdio === "inherit") {
      child.stdout.on("data", data => process.stdout.write(data));
      child.stderr.on("data", data => process.stderr.write(data));
    }
  });
}

export type execAsyncOptions = child_process.ExecOptions & {encoding?: BufferEncoding} & {stdio?: "ignore"|"inherit"};
export function execAsync(command: string): Promise<{stdout: string, stderr: string}>;
export function execAsync(command: string, options: execAsyncOptions): Promise<{stdout: string, stderr: string}>;
export function execAsync(command: string, options?: execAsyncOptions) {
  let childOptions: execAsyncOptions = {};
  if (options) childOptions = options;
  if (childOptions?.env) childOptions.env = {...process.env, ...childOptions.env};
  return new Promise<{stdout: string, stderr: string}>((resolve, rejectExec) => {
    const child = child_process.exec(command, {...childOptions}, (err, out: string|Buffer, err2: string|Buffer) => {if (err) return rejectExec(err);resolve({stdout: ((out instanceof Buffer) ? out.toString():out), stderr: (err2 instanceof Buffer)?err2.toString():err2});});
    if (options?.stdio === "inherit") {
      child.stdout.on("data", data => process.stdout.write(data));
      child.stderr.on("data", data => process.stderr.write(data));
    }
  });
}