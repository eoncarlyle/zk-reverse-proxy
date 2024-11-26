import ZooKeeper from "zookeeper";

import Option from "./Option.js";

type ZkConfig = {
  connect: string; //ZK server connection string
  timeout: number;
  debug_level: number;
  host_order_deterministic: boolean;
};

// Reffering to 'hostnames' as including ports while 'baseHostname' does not have the port
export type Target = {
  endpoint: string;
  count: number;
  version: number
}

export const TARGETS_ZNODE_PATH = "/targets"

export enum HttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  DELETE = "DELETE",
  PATCH = "PATCH",
  HEAD = "HEAD",
  OPTIONS = "OPTIONS"
}

// Only used in target server
export const getSocketFromPort = (port: number, hostname = "127.0.0.1") =>
  `${TARGETS_ZNODE_PATH}/${hostname}:${port}`;

export const getSocket = (hostname: string) => `${TARGETS_ZNODE_PATH}/${hostname}`


export const zkConfig = {
  connect: "127.0.0.1:2181",
  timeout: 5000,
  debug_level: ZooKeeper.constants.ZOO_LOG_LEVEL_WARN,
  host_order_deterministic: false,
};

export const createZkClient = (config: ZkConfig) => {
  const client = new ZooKeeper(config);
  client.init(config);
  return client;
};

export const getMaybeZnode = async (client: ZooKeeper, path: string) => {
  return (await client.pathExists(path, false))
    ? Option.some(await client.exists(path, false)) //! This makes the assumption that the znode wasn't deleted between this line and the previous
    : Option.none<stat>();
};

export const createZnodeIfAbsent = async (client: ZooKeeper, path: string, flags?: number) => {
  if ((await getMaybeZnode(client, path)).isNone()) {
    await client.create(path, "", flags || ZooKeeper.constants.ZOO_PERSISTENT)
  }
}
