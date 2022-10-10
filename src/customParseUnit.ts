export default {parse};
export const unit = /^\[([0-9A-Za-z]*)\]$/;
export const commend = /^#.*/;
export const keys = /^([0-9A-Za-z_\-\s]+)=(.*)/;
export type unitSchema = {
  Unit?: {
    Description?: string|string[],
    Documentation?: string|string[],
    Name?: string,
    Requires?: string
  },
  Service?: {
    ExecStart?: string,
    ExecReload?: string,
    User?: string,
    Restart?: "on-failure"|"always"|"on-abort"|"no",
    RestartSec?: string,
    Environment?: string|string[],
    EnvironmentFile?: string,
    WorkingDirectory?: string,
    RuntimeDirectory?: string,
    RuntimeDirectoryMode?: string
  },
  Socket?: {
    ListenStream?: string,
    SocketMode?: string,
    SocketUser?: string,
    SocketGroup?: string
  },
  [key: string]: {
    [key: string]: string|string[]
  }
};

export function parse(content: string): unitSchema {
  const fileJson: unitSchema = {};
  let currentUnit: string;
  for (const line of content.replace(/\\(|\s+|\t+)\r?\n/g, "").trim().split(/\r?\n/)) {
    if (!line.trim()||commend.test(line.trim())) continue;
    if (unit.test(line)) {
      const [, unitName] = line.match(unit);
      currentUnit = unitName.trim();
      if (!fileJson[currentUnit]) fileJson[currentUnit] = {};
      continue;
    } else if (keys.test(line)) {
      const [, key, value] = line.match(keys);
      if (!fileJson[currentUnit]) {
        currentUnit = "Unit";
        fileJson[currentUnit] = {}
      }
      if (!fileJson[currentUnit][key]) fileJson[currentUnit][key] = value.trim();
      else if (typeof fileJson[currentUnit][key] === "string") fileJson[currentUnit][key] = [fileJson[currentUnit][key] as string, value];
      else (fileJson[currentUnit][key] as string[]).push(value);
      continue;
    }
  }
  return fileJson;
}