import { EventEmitter } from "node:events";
// import child_process from "node:child_process";

export declare interface mainProcess {
  // Error emit
  /** if an error occurs, it will be issued here, and if a callback is not added, an error will be thrown to the Nodejs process (`process.on("unhandledRejection")`) */
  on(act: "error", fn: (data: any) => void): this;
  /** if an error occurs, it will be issued here, and if a callback is not added, an error will be thrown to the Nodejs process (`process.once("unhandledRejection")`) */
  once(act: "error", fn: (data: any) => void): this;
  emit(act: "error", data: any): boolean;
};

/**
 * Create process listen socket and http(s) server to maneger remotely process maneger
*/
export class mainProcess extends EventEmitter {
  constructor() {
    super();
  }
}