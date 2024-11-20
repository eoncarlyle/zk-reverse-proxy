import { createServer, IncomingMessage, ServerResponse } from "node:http";

import * as R from "ramda";
import http from "node:http";
import ZooKeeper from "zookeeper";

import Option from "./Option.js";

type AppResponse = {
  statusCode: number;
  message: string;
};

type ZkConfig = {
  connect: string; //ZK server connection string
  timeout: number;
  debug_level: number;
  host_order_deterministic: boolean;
};

const appResponse = (statusCode: number, message: string): AppResponse => {
  return { statusCode: statusCode, message: message };
};

const getHostPath = (port: number, hostname = "127.0.0.1") =>
  `/hosts/${hostname}:${port}`;

// Use the Wlaschin typing for hostnames
const zkConfig = {
  connect: "127.0.0.1:2181",
  timeout: 5000,
  debug_level: ZooKeeper.constants.ZOO_LOG_LEVEL_WARN,
  host_order_deterministic: false,
};

const createZkClient = (config: ZkConfig) => {
  const client = new ZooKeeper(config);
  client.init(config);
  return client;
};

const getAppResponse = R.curry((port: number, m: IncomingMessage) =>
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
  ])(m),
);

const getMaybeZnode = async (client: ZooKeeper, path: string) => {
  return (await client.pathExists(path, false))
    ? Option.some(await client.exists(path, false)) //! This makes the assumption that the znode wasn't deleted between this line and the previous
    : Option.none<stat>();
  /* previously had:
  const pathExists = await client.pathExists(path, false);

  const getOption = R.ifElse(
    R.always(await client.pathExists(path, false)),
    R.always(Option.some<stat>(await client.exists(path, false))),
    R.always(Option.none<stat>()),
  );

  return getOption(pathExists);
  */
};

const targetServer = async (port: number) => {
  const targetServerClient = createZkClient(zkConfig);
  const maybeZnode = await getMaybeZnode(targetServerClient, getHostPath(port));

  maybeZnode.map(
    async (zkStat: stat) =>
      await targetServerClient.delete_(getHostPath(port), zkStat.version),
  );

  await targetServerClient.create(
    getHostPath(port),
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

await targetServer(4001);
await targetServer(4002);

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Not done yet, but monadify this
  const hosts = await reverseProxyClient.get_children("/hosts", false);

  // Bypassing issues with `.toSorted` with Node 18!
  const candidateHosts = R.sort(
    R.ascend(R.prop("count")),
    await Promise.all(
      hosts.map(async (host) => {
        const [znodeStat, data] = (await reverseProxyClient.get(
          `/hosts/${host}`,
          false,
        )) as [stat, object];
        return {
          hostWithPort: host,
          count: parseInt(data.toString()),
          version: znodeStat.version,
        };
      }),
    ),
  );
  console.log("\nCandidate Hosts:");
  console.log(candidateHosts);
  const selectedTargetHost = candidateHosts[0];

  const [targetedHostname, targetedPort]: string[] =
    selectedTargetHost.hostWithPort.split(":");

  await reverseProxyClient.set(
    getHostPath(parseInt(targetedPort), targetedHostname),
    String(selectedTargetHost.count + 1),
    selectedTargetHost.version,
  );

  const options = {
    hostname: targetedHostname,
    port: parseInt(targetedPort),
    method: "GET",
    path: req.url,
  };
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
  });
  req.pipe(proxyReq);
}).listen(4000);
