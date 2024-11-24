import http, {createServer, IncomingMessage, ServerResponse} from "node:http";
import * as R from "ramda";
import ZooKeeper from "zookeeper";
import {createZkClient, zkConfig, CandidateHost, getHostPath, getMaybeZnode} from "./Main.js";
import * as console from "node:console";
import * as NodeCache from "node-cache";


const reverseProxyZk = createZkClient(zkConfig);
const maybeHostsZnode = await getMaybeZnode(reverseProxyZk, "/hosts")

if (!maybeHostsZnode.isSome()) {
  await reverseProxyZk.create(
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

  // Noticed load testing failing with '-103 bad version', didn't understand why

  try {
    await reverseProxyZk.set(
      getHostPath(selectedTargetHost.hostname),
      String(selectedTargetHost.count + 1),
      selectedTargetHost.version,
    );
  } catch (e: any) {
    console.log("Error with update attempt: ")
    console.log(selectedTargetHost)
    throw e;
  }
}

const reverseProxyRetry = async (req: IncomingMessage, res: ServerResponse, candidateHostIndex: number, candidateHosts: CandidateHost[]) => {
  if (candidateHostIndex >= candidateHosts.length) {
    res.writeHead(500)
    res.end("Internal Error");
  } else if (req.url !== undefined) {
    const options = getHttpOptions(candidateHosts, req.url, 0)

    await updateTargetHostCount(candidateHosts, candidateHostIndex)


    const proxyReq = http.request(options, (req) => {
      res.writeHead(req.statusCode || 200, req.headers);
      req.pipe(res)
    });

    /*
     Delete bad znodes? We don't want these to block, what if we placed them on a message queue!
     This is probably a terrible idea, but would be funny to try
     */

    req.pipe(proxyReq)
      .on("error", () => reverseProxyRetry(req, res, candidateHostIndex + 1, candidateHosts))
  } else {
    res.writeHead(400);
    res.end("Bad Request");
  }
}

createServer(async (req: IncomingMessage, res: ServerResponse) => {

  const hosts = await reverseProxyZk.get_children("/hosts", false);

  const candidateHosts = R.sort(
    R.ascend(R.prop("count")),
    await Promise.all(
      hosts.map(async (hostName) => {
        const [znodeStat, data] = (await reverseProxyZk.get(
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


  // Implement fast-aging cache

  if (req.url !== undefined) {
    const options = getHttpOptions(candidateHosts, req.url, 0)
    try {
      await updateTargetHostCount(candidateHosts, 0)
    } catch (e: any) {
      await reverseProxyRetry(req, res, 1, candidateHosts)
    }


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

