import http, {createServer, IncomingMessage, ServerResponse} from "node:http";
import * as R from "ramda";
import ZooKeeper from "zookeeper";
import {createZkClient, zkConfig, CandidateHost, getHostPath} from "./Main.js";
import * as console from "node:console";


const reverseProxyZkClient = createZkClient(zkConfig);
const reverseProxyHostStat = await reverseProxyZkClient.get("/hosts", false);

if (!reverseProxyHostStat) {
  await reverseProxyZkClient.create(
    "/hosts",
    "",
    ZooKeeper.constants.ZOO_PERSISTENT,
  );
}

const getHttpOptions = (candidateHosts: CandidateHost[], reqUrl: string, candidateHostIndex: number) => {
  const selectedTargetHost = candidateHosts[candidateHostIndex];
  const [targetedBaseHostname, targetedPort]: string[] =
    selectedTargetHost.hostname.split(":");

  return {
    hostname: targetedBaseHostname,
    port: parseInt(targetedPort),
    method: "GET",
    path: reqUrl
  }
}

const updateTargetHostCount = async (candidateHosts: CandidateHost[], candidateHostIndex: number) => {
  const selectedTargetHost = candidateHosts[candidateHostIndex];

  await reverseProxyZkClient.set(
    getHostPath(selectedTargetHost.hostname),
    String(selectedTargetHost.count + 1),
    selectedTargetHost.version,
  );
}

const reverseProxyRetry = async (req: IncomingMessage, res: ServerResponse, candidateHostIndex: number, candidateHosts: CandidateHost[]) => {
  if (req.url !== undefined) {
    const options = getHttpOptions(candidateHosts, req.url, 0)

    await updateTargetHostCount(candidateHosts, candidateHostIndex)

    // Need to wrap this?
    const proxyReq = http.request(options, (req) => {
      res.writeHead(req.statusCode || 200, req.headers);
      req.pipe(res)
    });

    // Delete bad znodes?
    // We don't want this to block, why not place these requests on a message queue!

    req.pipe(proxyReq)
      .on("error", () => reverseProxyRetry(req, res, candidateHostIndex + 1, candidateHosts))
  } else {
    res.writeHead(400);
    res.end("Bad Request");
  }
}

createServer(async (req: IncomingMessage, res: ServerResponse) => {

  const hosts = await reverseProxyZkClient.get_children("/hosts", false);

  const candidateHosts = R.sort(
    R.ascend(R.prop("count")),
    await Promise.all(
      hosts.map(async (hostName) => {
        const [znodeStat, data] = (await reverseProxyZkClient.get(
          getHostPath(hostName),
          false,
        )) as [stat, object];
        return {
          hostname: hostName,
          count: parseInt(data.toString()),
          version: znodeStat.version,
        };
      }),
    ),
  );
  console.log("\nCandidate Hosts:");
  console.log(candidateHosts);

  // Need to implement two-pointer to scan through the list of target hosts and return 500 if all have been tried

  if (req.url !== undefined) {
    const options = getHttpOptions(candidateHosts, req.url, 0)
    await updateTargetHostCount(candidateHosts, 0)

    const proxyReq = http.request(options, (req) => {
      res.writeHead(req.statusCode || 200, req.headers);
      req.pipe(res)
    });
    req.pipe(proxyReq)
      .on("error", () => reverseProxyRetry(req, res, 1, candidateHosts));
  } else {
    res.writeHead(400);
    res.end("Bad Request");
  }
}).listen(4000);

