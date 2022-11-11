import { EventEmitter } from "node:events";
import express from "express";
import child_process from "node:child_process";

export declare interface mainProcess {
  // Error emit
  /** if an error occurs, it will be issued here, and if a callback is not added, an error will be thrown to the Nodejs process (`process.on("unhandledRejection")`) */
  on(act: "error", fn: (data: any) => void): this;
  /** if an error occurs, it will be issued here, and if a callback is not added, an error will be thrown to the Nodejs process (`process.once("unhandledRejection")`) */
  once(act: "error", fn: (data: any) => void): this;
  emit(act: "error", data: any): boolean;
};

export type initjs_process = ({
  status: "running"|"restarting",
  childProcess: child_process.ChildProcess,
}|{
  status: "stoped"
})&{
  name: string,
  childrens?: string[]
};

/**
 * Create process listen socket and http(s) server to maneger remotely process maneger
*/
export class mainProcess extends EventEmitter {
  processList: {[id: string]: initjs_process} = {};
  constructor() {
    super();
    const app = express();
    app.get("/", ({res}) => res.json(Object.keys(this.processList).reduce((mount, id) => {
      const data = this.processList[id];
      if (data.status === "stoped") mount[id] = {status: "stoped"};
      else {
        mount[id] = {
          status: data.status,
          pid: data.childProcess.pid,
          childrensIDs: data.childrens
        };
      }
      return mount;
    }, {})));
  }
}