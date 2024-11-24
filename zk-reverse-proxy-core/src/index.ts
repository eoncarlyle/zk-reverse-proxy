import http, {createServer, IncomingMessage, ServerResponse} from "node:http";
import * as R from "ramda";
import ZooKeeper from "zookeeper";
import {CandidateHost, createZkClient, getHostPath, getMaybeZnode, HttpMethod, zkConfig} from "./Main.js";
import * as console from "node:console";


const reverseProxyZk = createZkClient(zkConfig);
const maybeHostsZnode = await getMaybeZnode(reverseProxyZk, "/hosts")

if (!maybeHostsZnode.isSome()) {
  await reverseProxyZk.create(
    "/hosts",
    "",
    ZooKeeper.constants.ZOO_PERSISTENT,
  );
}
const getHttpOptions = (candidateHosts: CandidateHost[], reqUrl: string, candidateHostIndex: number, method: HttpMethod = HttpMethod.GET) => {
  const selectedTargetHost = candidateHosts[candidateHostIndex];
  const [targetedBaseHostname, targetedPort]: string[] =
    selectedTargetHost.hostname.split(":");

  return {
    hostname: targetedBaseHostname,
    port: parseInt(targetedPort),
    method: method,
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

createServer(async (outerReq: IncomingMessage, outerRes: ServerResponse) => {

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


  /*
  Implement fast-aging cache: because pipes are not discrete requests for a discrete endpoint, they won't play well
  with chaching
   */

  if (outerReq.url !== undefined) {
    const options = getHttpOptions(candidateHosts, outerReq.url, 0)
    try {
      await updateTargetHostCount(candidateHosts, 0)
    } catch (e: any) {
      await reverseProxyRetry(outerReq, outerRes, 1, candidateHosts)
    }

    //const proxyReq = http.request(options, (outerReq) => {
    //  outerRes.writeHead(outerReq.statusCode || 200, outerReq.headers);
    //  outerReq.pipe(outerRes)
    //});

    const innerReq = http.request(options);
    // Writing JSON, multipart form, etc. in body would need to happen before this point, not sure best way
    innerReq.end();
    console.log("here119")

    innerReq.on("response", innerRes => {
      // 'From "Definitive JavaScript":
      // We don't care about the response body in this case, but
      // we don't want it to stick around in a buffer somewhere, so
      // we put the stream into flowing mode without registering
      // a "data" handler so that the body is discarded.'
      console.log("here127")
      outerRes.writeHead(innerRes.statusCode || 200, outerReq.headers)

      // I think the fact that incoming message doesn't just have a body - and that is streamed instead -is meaningful

      innerRes.setEncoding("utf-8")
      let body ="";
      innerRes.on("data", chunk => {body += chunk; console.log(chunk) })
      innerRes.on("end", () => {
        try {
          outerRes.write(body)
        } catch(e) {
          outerRes.writeHead(500)
          outerRes.write("Internal Error")
        }
      })
    })



    // TODO 1: error handling/retry
    // TODO 2:
//
//    outerReq.pipe(proxyReq)
//      .on("error", () => reverseProxyRetry(outerReq, outerRes, 1, candidateHosts));
//  } else {
//    outerRes.writeHead(400);
//    outerRes.end("Bad Request");
//  }
}}).listen(4000);

