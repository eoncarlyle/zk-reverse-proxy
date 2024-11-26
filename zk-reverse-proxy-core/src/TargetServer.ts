import ZooKeeper from "zookeeper";
import {createServer, IncomingMessage, ServerResponse} from "node:http";
import * as process from "node:process";

import {
  zkConfig,
  createZkClient,
  getMaybeZnode,
  getSocketFromPort,
  createZnodeIfAbsent,
  TARGETS_ZNODE_PATH
} from "./Main.js";
import * as R from "ramda";


type AppResponse = {
  statusCode: number;
  message: string;
};

const appResponse = (statusCode: number, message: string): AppResponse => {
  return { statusCode: statusCode, message: message };
};

const getAppResponse = (port: number, m: IncomingMessage) =>
  R.cond([
    [
      (m) => R.and(m.method === "GET", m.url === "/"),
      R.always(appResponse(200, `Served on port ${port}`)),
    ],
    [
      (m) => m.method !== "GET",
      R.always(appResponse(405, "Method not supported")),
    ],
    [
      (m) => m.method !== "GET",
      R.always(appResponse(405, "Method not supported")),
    ],
    [(m) => m.url !== "/", R.always(appResponse(404, "Path not found"))],
    [R.T, R.always(appResponse(500, "Internal Error"))],
  ])(m);

const targetServer = async (zkClient: ZooKeeper, port: number) => {
  const maybeZnode = await getMaybeZnode(zkClient, getSocketFromPort(port));

  maybeZnode.map(
    async (zkStat: stat) =>
      await zkClient.delete_(getSocketFromPort(port), zkStat.version),
  );

  await zkClient.create(
    getSocketFromPort(port),
    "0",
    ZooKeeper.constants.ZOO_EPHEMERAL,
  );

  createServer((req: IncomingMessage, res: ServerResponse) => {
    const { statusCode, message } = getAppResponse(port, req);
    res.writeHead(statusCode);
    res.end(message);
  }).listen(port);
};

const targetServerZk = createZkClient(zkConfig);

createZnodeIfAbsent(targetServerZk, TARGETS_ZNODE_PATH)


if (process.argv.length !== 3) {
  console.log("node targetServer [portNumber]")
  process.exit(1)
} else {
  const port = Number(process.argv[2])
  await targetServer(targetServerZk, port)
}


