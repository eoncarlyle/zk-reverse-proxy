import ZooKeeper from "zookeeper";

import Option from "./Option.js";

type ZkConfig = {
  connect: string; //ZK server connection string
  timeout: number;
  debug_level: number;
  host_order_deterministic: boolean;
};

// Reffering to 'hostnames' as including ports while 'baseHostname' does not have the port
export type CandidateHost = {
  hostname: string;
  count: number;
  version: number
}

export const getHostPathFromBase = (port: number, baseHostname = "127.0.0.1") =>
  `/hosts/${baseHostname}:${port}`;

export const getHostPath = (hostname: string) => `/hosts/${hostname}`


// Use the Wlaschin typing for hostnames
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
    client.create(path, "", flags || ZooKeeper.constants.ZOO_PERSISTENT)
  }
}
