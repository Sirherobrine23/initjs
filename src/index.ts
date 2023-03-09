import EventEmitter from "node:events";
import child_process from "node:child_process";
import yaml from "yaml";

export type unitConfig = {
  id?: string,
  restart?: "onFailure"|"always",
  args: string[],
  cwd?: string,
  env?: {
    [envName: string]: string|number|boolean,
  },
  user?: {
    uid: number,
    gid?: number,
  },
};

export default class createInit extends EventEmitter {
  public on(event: "error", fn: (err: any) => void): this;
  public on(event: "newUnit", fn: (config: unitConfig) => void): this;
  public on(event: string, fn: (...args: any[]) => void) {
    super.on(event, fn);
    return this;
  }

  public once(event: "error", fn: (err: any) => void): this;
  public once(event: "newUnit", fn: (config: unitConfig) => void): this;
  public once(event: string, fn: (...args: any[]) => void) {
    super.once(event, fn);
    return this;
  }

  public childSessions: {
    [configID: string]: {
      config: unitConfig,
      child?: child_process.ChildProcess,
    },
  } = {};

  /**
   * Set default envs in all unit's
   */
  public defaultEnv = new Map<string, number|string|boolean>();

  /**
   * Add new unit to run
   * @param config - YAML config
   */
  public addUnit(config: string) {
    const configs: unitConfig[] = yaml.parseAllDocuments(config).map(f => ({id: Buffer.from(f.toString()).toString("hex"), ...(f.toJSON())}));
    async function run(this: createInit) {
      for (const unit of configs) {
        this.childSessions[unit.id] ??= {config: unit};
        const start = async () => {
          this.childSessions[unit.id].child = child_process.spawn(unit.args.at(0), unit.args.slice(1), {
            cwd: unit.cwd,
            uid: unit.user?.uid,
            gid: unit.user?.gid,
            env: {
              ...process.env,
              ...(Array.from(this.defaultEnv.keys()).reduce((acc, key) => {
                acc[key] = String(this.defaultEnv.get(key));
                return acc;
              }, {})),
              ...(Object.keys(unit.env ?? {}).reduce((acc, keyName) => {
                acc[keyName] = String(unit.env[keyName]);
                return acc;
              }, {}))
            },
          });
          this.childSessions[unit.id].child.on("error", err => this.emit("error", err));
          new Promise((done, reject) => this.childSessions[unit.id].child.once("spawn", done).once("error", reject));
          if (unit.restart) {
            if (unit.restart === "always") this.childSessions[unit.id].child.once("exit", start.apply(this));
            else if (unit.restart === "onFailure") this.childSessions[unit.id].child.once("exit", code => code !== 0 ? start.call(this) : null);
          }
        }
        await start();
        this.emit("newUnit", this.childSessions[unit.id].config);
      }
    }
    return Object.assign(this, Promise.resolve().then(run.call(this)).catch(err => this.emit("error", err)));
  }
}