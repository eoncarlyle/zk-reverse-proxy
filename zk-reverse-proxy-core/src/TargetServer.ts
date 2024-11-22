import ZooKeeper from "zookeeper";
import {createServer, IncomingMessage, ServerResponse} from "node:http";
import * as process from "node:process";

import {zkConfig, createZkClient, getMaybeZnode, getHostPathFromBase} from "./Main.js";
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

const targetServer = async (port: number) => {
  const targetServerClient = createZkClient(zkConfig);
  const maybeZnode = await getMaybeZnode(targetServerClient, getHostPathFromBase(port));

  maybeZnode.map(
    async (zkStat: stat) =>
      await targetServerClient.delete_(getHostPathFromBase(port), zkStat.version),
  );

  await targetServerClient.create(
    getHostPathFromBase(port),
    "0",
    ZooKeeper.constants.ZOO_EPHEMERAL,
  );

  createServer((req: IncomingMessage, res: ServerResponse) => {
    const { statusCode, message } = getAppResponse(port, req);
    res.writeHead(statusCode);
    res.end(message);
  }).listen(port);
};

const reverseProxyClient = createZkClient(zkConfig);
const hostsStat = await reverseProxyClient.get("/hosts", false);

if (!hostsStat) {
  await reverseProxyClient.create(
    "/hosts",
    "",
    ZooKeeper.constants.ZOO_PERSISTENT,
  );
}

if (process.argv.length !== 3) {
  console.log("node targetServer [portNumber]")
  process.exit(1)
} else {
  const port = Number(process.argv[2])
  await targetServer(port)
}


