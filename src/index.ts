import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import Yargs from "yargs";
import * as coreutils from "@the-bds-maneger/core-utils";
import userid from "userid";

Yargs(process.argv.slice(2)).wrap(Yargs.terminalWidth()).version(false).help().alias("h", "help").demandCommand().command("process", "Maneger process in initjs daemon", yargs => {
  return yargs.demandCommand().command("ps", "list process status in initjs", yargs => {return yargs.parseSync()}).parseSync();
}).command("start", "run initjs in background to maneger process, listen socket and http server", async yargs => {
  yargs = yargs.options("port", {
    alias: "P",
    description: "Porta para ouvir as requisições",
    type: "number"
  }).option("socket-path", {
    alias: "S",
    description: "Caminho para criar um socket unix para poder se comunicar com initjs",
    default: path.join(os.homedir(), ".initjs.sock")
  })
  return yargs.parseSync();
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
}).parseAsync().catch(err => {
  console.error(err.message||err);
  process.exit(1);
});