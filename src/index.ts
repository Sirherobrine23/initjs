#!/usr/bin/env node
import { mainProcess, apiProcessList } from "./mainProcess";
import * as coreutils from "@the-bds-maneger/core-utils";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import Yargs from "yargs";
import userid from "userid";
process.title = "initjs";
async function findSocket() {
  const tmp = path.join(os.tmpdir(), "initjs.sock"), dottmp = path.join(os.tmpdir(), ".initjs.sock"), home = path.join(os.homedir(), "initjs.sock"), dothome = path.join(os.homedir(), ".initjs.sock");
  if (await coreutils.extendFs.exists(tmp)) return tmp;
  else if (await coreutils.extendFs.exists(dottmp)) return dottmp;
  else if (await coreutils.extendFs.exists(home)) return home;
  else if (await coreutils.extendFs.exists(dothome)) return dothome;
  else if (process.platform === "linux" && await coreutils.extendFs.exists("/var/run/initjs.sock")) return "/var/run/initjs.sock";
  else return home;
}

Yargs(process.argv.slice(2)).wrap(Yargs.terminalWidth()).version(false).help().alias("h", "help").demandCommand().strictCommands().command("start", "run initjs in background to maneger process, listen socket and http server", async yargs => {
  const options = yargs.option("socket-path", {
    type: "string",
    description: "Caminho para criar um socket unix para poder se comunicar com initjs",
    alias: "S",
    default: path.join(os.homedir(), ".initjs.sock")
  }).options("port", {
    type: "number",
    description: "Porta para ouvir as requisições para o servidor do HTTP(s)",
    alias: "P",
    default: 9448
  }).option("httpcert", {
    type: "string",
    description: "Caminho para o certificado caso queira que seja por HTTPs o servidor HTTP",
  }).option("initjs-folder", {
    type: "array",
    string: true,
    description: "Caminho para a pasta que contenha os arquivos para carregar para o initjs",
    default: [path.join(process.cwd(), ".initjs")]
  }).option("log-level", {
    type: "string",
    description: "Log level to Initjs",
    default: "show",
    choices: [
      "none", "NONE", "0",
      "show", "SHOW", "1",
    ]
  }).parseSync();
  const processManeger = new mainProcess({
    initjsFolder: options["initjs-folder"],
    socketPath: {
      callback: () => console.log("[%s CLI]: Socket listen on '%s'", new Date(), options["socket-path"]),
      path: options["socket-path"],
    },
    httpPort: {
      callback: () => console.log("[%s CLI]: HTTP port listen on %f", new Date(), options.port),
      port: options.port,
    },
  });
  processManeger.on("error", err => console.error("[%s ERROR]: %o", new Date(), err));
  processManeger.on("processExit", data => console.log("[%s INITJS]: Program: '%s', Exit code/signal: %o", new Date(), data.name, data.signal||data.code));
  processManeger.on("noRestart", data => console.log("[%s INITJS]: Program: '%s', Exit code/signal: %o and no restart", new Date(), data.name, data.signal||data.code));
  processManeger.on("spawn", ({name}) => console.log("[%s INITJS]: Program started (%s)", new Date(), name));
  // if ((["show", "SHOW", "1"]).includes(options["log-level"])) processManeger.on("log", log => console.log("[%s %s '%s']: %s", new Date(), log.from.toUpperCase(), log.name, log.data));
  const [, command, ...args] = options._.map(String);
  if (command) return coreutils.customChildProcess.execFileAsync(command, args, {stdio: "inherit"});
  return null;
}).command("create-user", "Crie um usuario para o sistema de forma automatico", async yargs => {
  if (process.platform !== "linux") throw new Error("Platform not avaible to this function, only linux!");
  const data = yargs.options("username", {
    type: "string",
    alias: "u",
    description: "Username to User",
    default: process.env.USERNAME||crypto.randomBytes(8).toString("hex")
  }).option("password", {
    type: "string",
    alias: "p",
    description: "User password",
  }).option("shell", {
    type: "string",
    alias: "s",
    description: "User default shell",
    default: "zsh"
  }).option("ohmyzsh", {
    type: "boolean",
    description: "Install the Oh my zsh if shell is zsh",
    default: true
  }).option("uid", {
    type: "string",
    description: "User ID"
  }).option("gid", {
    type: "string",
    description: "User group ID"
  }).option("groups", {
    type: "array",
    string: true,
    description: "User groups",
    default: ["docker", "sudo"]
  }).option("sudonopasswdask", {
    type: "boolean",
    alias: "S",
    description: "Sudo no ask passwd on run sudo ...commands, valid if sudo group id add in group list",
    default: true
  }).parseSync();

  // Check if exists shell
  if (!data.shell) data.shell = "bash";
  if (data.shell.startsWith("/")) {
    if (!await coreutils.extendFs.exists(data.shell)) throw new Error("Shell path not exists");
  } else if (await coreutils.customChildProcess.commendExists(data.shell)) data.shell = (await coreutils.customChildProcess.commendExists(data.shell, false)).trim(); else throw new Error("Shell not exists");
  if (!data.shell.endsWith("zsh")) data.ohmyzsh = false;

  // Check username
  if (await Promise.resolve().then(() => userid.uid(data.username)).then(() => true).catch(() => false)) throw new Error("User aredy exists in system!");
  if (data.uid) {
    if (await Promise.resolve().then(() => userid.username(parseInt(data.uid))).then(() => true).catch(() => false)) throw new Error("User aredy exists in system with a id!");
  }

  // Check if not exists UID and GID
  if (data.gid) data.gid = (await Promise.resolve().then(() => userid.groupname(parseInt(data.gid))).catch(() => coreutils.customChildProcess.execFileAsync("groupadd", ["--gid", parseInt(data.gid).toFixed(0), data.username])).then(() => userid.gid(data.username))).toFixed(0);

  // Register user
  const argAdd = ["--shell", data.shell.trim(), "--create-home"];
  if (data.uid) argAdd.push("--uid", data.uid);
  if (data.gid) argAdd.push("--gid", data.gid);
  if (data.groups?.length > 0) {
    argAdd.push("-G", data.groups.join(","));
    if (data.sudonopasswdask&& data.groups.includes("sudo")) {
      await fs.writeFile(path.join("/etc/sudoers.d", data.username), `${data.username} ALL=(ALL) NOPASSWD:ALL\n`);
      await fs.chmod(path.join("/etc/sudoers.d", data.username), "0440");
    }
  }
  await coreutils.customChildProcess.execFileAsync("useradd", [...argAdd, data.username.trim()]);
  if (data.password) await coreutils.customChildProcess.execAsync(`(echo $PASSWORD; echo $PASSWORD) | passwd ${data.username}`, {env: {PASSWORD: data.password}});
  if (data.ohmyzsh) {
    await coreutils.customChildProcess.execFileAsync("bash", ["-c", `git clone https://github.com/ohmyzsh/ohmyzsh.git /home/${data.username}/.oh-my-zsh && git clone https://github.com/zsh-users/zsh-autosuggestions /home/${data.username}/.oh-my-zsh/custom/plugins/zsh-autosuggestions && cat /home/${data.username}/.oh-my-zsh/templates/zshrc.zsh-template | sed -e 's|ZSH_THEME=".*"|ZSH_THEME="strug"|g' | sed -e 's|plugins=(.*)|plugins=(git docker kubectl zsh-autosuggestions)|g' | tee /home/${data.username}/.zshrc`], {
      uid: userid.uid(data.username),
      gid: userid.gid(data.username),
      cwd: `/home/${data.username}`
    });
  }

  console.log("Success create '%s'\n\tHome dir: '/home/%s'", data.username, data.username);
  return data;
}).command("process", "Maneger process in initjs daemon", async yargs => {
  return yargs.demandCommand().options("socketpath", {
    type: "string",
    description: "Informe a onde o socket está, por padrão ele procura automaticamente",
    default: await findSocket(),
  }).option("host", {
    type: "string",
    description: "url to request if",
    default: "http://localhost:9448"
  }).command("ps", "list process status in initjs", async yargs => {
    const options = yargs.option("process", {
      type: "string",
      description: "Show info to single process",
    }).parseSync();
    const data: apiProcessList = await coreutils.httpRequest.getJSON({socket: {socketPath: options.socketpath}}).catch(() => coreutils.httpRequest.getJSON(options.host));
    function createData(config: apiProcessList[string]) {
      let data = `Name: '${config.name}'\n\tStatus: ${config.status}\n\tRestarts: ${config.restartCount}`;
      if (config.pid) data += `\r\tPID: ${config.pid}`;
      if (config.childrens) data += `\n\tChildrens: ${config.childrens.join(", ")}`
      return data;
    }
    if (options.process) {
      const processData = Object.keys(data).map(name => data[name]).find(process => process.name === options.process);
      if (!processData) throw new Error("Process not exists");
      console.log(createData(processData));
    } else {
      const data2 = Object.keys(data).map(name => data[name]).map(config => createData(config));
      console.log("----------------------\n%s\n----------------------", data2.join("\n----------------------\n"));
    }
    return options;
  }).parseAsync();
}).parseAsync().catch(err => {
  if (err?.response?.body) console.error(Buffer.isBuffer(err.response.body)?err.response.body.toString("utf8"):err.response.body);
  else console.error(err?.message||err);
  process.exit(1);
});