import { createServer, IncomingMessage, ServerResponse } from "node:http";

import * as R from "ramda";
import http from "node:http";
import ZooKeeper from "zookeeper";

type AppResponse = {
  statusCode: number;
  message: string;
};

const appResponse = (statusCode: number, message: string): AppResponse => {
  return { statusCode: statusCode, message: message };
};

const zkConfig = {
  connect: "127.0.0.1:2181",
  timeout: 5000,
  debug_level: ZooKeeper.constants.ZOO_LOG_LEVEL_WARN,
  host_order_deterministic: false,
};

const createZkClient = (config = zkConfig) => {
  return new ZooKeeper(config);
};

const targetServer = async (port: number) => {
  const client = createZkClient();
  client.init(zkConfig);

  await client.create(
    `/hosts/127.0.0.1:${port}`,
    "0",
    ZooKeeper.constants.ZOO_EPHEMERAL,
  );

  createServer((req: IncomingMessage, res: ServerResponse) => {
    const getAppResponse = R.cond([
      [
        (m: IncomingMessage) => R.and(m.method === "GET", m.url === "/"),
        R.always(appResponse(200, `Served on port ${port}`)),
      ],
      [
        (m: IncomingMessage) => m.method !== "GET",
        R.always(appResponse(405, "Method not supported")),
      ],
      [
        (m: IncomingMessage) => m.method !== "GET",
        R.always(appResponse(405, "Method not supported")),
      ],
      [
        (m: IncomingMessage) => m.url !== "/",
        R.always(appResponse(404, "Path not found")),
      ],
      [R.T, R.always(appResponse(500, "Internal Error"))],
    ]);

    const { statusCode, message } = getAppResponse(req);
    res.writeHead(statusCode);
    res.end(message);
  }).listen(port);
};

const client = createZkClient();
client.init(zkConfig);

const hostsStat = await client.get("/hosts", false);
if (!hostsStat) {
  await client.create("/hosts", "", ZooKeeper.constants.ZOO_PERSISTENT);
}

await targetServer(4001);
await targetServer(4002);

let a = true;

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const hosts = await client.get_children("/hosts", false);
  const hostsWithCounts = hosts.map(async (host) => {
    const [_, data] = await client.get(`/hosts/${host}`, false);
    return [host, data];
  });
  //console.log(hostsWithCounts);
  console.log(
    hostsWithCounts.forEach(async (a) => console.log((await a).toString())),
  );

  const options = {
    hostname: "127.0.0.1",
    port: a ? 4001 : 4002,
    method: "GET",
    path: req.url,
  };
  a = !a;
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
  });
  req.pipe(proxyReq);
}).listen(4000);
