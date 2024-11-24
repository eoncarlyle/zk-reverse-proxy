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

// Zero reason not to fold this into a recursive `createServer` defintion
const reverseProxyRetry = async (outerReq: IncomingMessage, outerRes: ServerResponse, candidateHostIndex: number, candidateHosts: CandidateHost[]) => {
  if (candidateHostIndex >= candidateHosts.length) {
    outerRes.writeHead(500)
    outerRes.end("Internal Error");
  } else if (outerReq.url !== undefined) {
    try {
      const options = getHttpOptions(candidateHosts, outerReq.url, 0)
      await updateTargetHostCount(candidateHosts, 0)

      const innerReq = http.request(options);
      // Writing JSON, multipart form, etc. in body would need to happen before this point
      // While this isn't needed for current implementation, would be required later on
      innerReq.end();

      innerReq.on("response", innerRes => {
        outerRes.writeHead(innerRes.statusCode || 200, outerReq.headers)

        // I think the fact that incoming message doesn't just have a body - and that is streamed instead -is meaningful

        innerRes.setEncoding("utf-8")
        const body: string[] = [];
        innerRes.on("data", chunk => {
          body.push(chunk)
        })
        innerRes.on("end", () => {
          try {
            outerRes.write(body.join(""))
            outerRes.end()
          } catch (e) {
            outerRes.writeHead(500)
            outerRes.write("Internal Error")
            outerRes.end()
          }
        })
      })
    } catch (e: any) {
      await reverseProxyRetry(outerReq, outerRes, 1, candidateHosts)
    }

  } else {
    outerRes.writeHead(400);
    outerRes.end("Bad Request");
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
    try {
      const options = getHttpOptions(candidateHosts, outerReq.url, 0)
      await updateTargetHostCount(candidateHosts, 0)

      const innerReq = http.request(options);
      // Writing JSON, multipart form, etc. in body would need to happen before this point
      // While this isn't needed for current implementation, would be required later on
      innerReq.end();

      innerReq.on("response", innerRes => {
        outerRes.writeHead(innerRes.statusCode || 200, outerReq.headers)

        // I think the fact that incoming message doesn't just have a body - and that is streamed instead -is meaningful

        innerRes.setEncoding("utf-8")
        const body: string[] = [];
        innerRes.on("data", chunk => {
          body.push(chunk)
        })
        innerRes.on("end", () => {
          try {
            outerRes.write(body.join(""))
            outerRes.end()
          } catch (e) {
            outerRes.writeHead(500)
            outerRes.write("Internal Error")
            outerRes.end()
          }
        })
      })

      innerReq.on("error", async () => { //Try/catch is not enough, need explicit errors!
        await reverseProxyRetry(outerReq, outerRes, 1, candidateHosts)
      })
    } catch (e: any) {
      await reverseProxyRetry(outerReq, outerRes, 1, candidateHosts)
    }

    // TODO 1: error handling/retry
    // TODO 2:
  } else {
    outerRes.writeHead(400)
    outerRes.end("Bad Request")
  }


}).listen(4000);

