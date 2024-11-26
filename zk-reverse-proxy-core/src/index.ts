import http, {createServer, IncomingMessage, ServerResponse} from "node:http";
import * as R from "ramda";
import {
  Target,
  createZkClient,
  getSocket,
  HttpMethod,
  zkConfig,
  TARGETS_ZNODE_PATH, createZnodeIfAbsent
} from "./Main.js";
//import * as console from "node:console";
import NodeCache from "node-cache";

const reverseProxyZk = createZkClient(zkConfig);
await createZnodeIfAbsent(reverseProxyZk, TARGETS_ZNODE_PATH)

// TODO fix typing
const getKey = (reqUrl: string, method: string | undefined) => {
  return JSON.stringify({
    method: method,
    path: reqUrl
  })
}

const getHttpOptions = (targets: Target[], reqUrl: string, index: number, method: HttpMethod = HttpMethod.GET) => {
  const target = targets[index];
  const [hostname, port]: string[] =
    target.endpoint.split(":");

  return {
    hostname: hostname,
    port: parseInt(port),
    method: method,
    path: reqUrl
  }
}

const updateTargetHostCount = async (candidateSockets: Target[], candidateIndex: number) => {
  const selectedTargetHost = candidateSockets[candidateIndex];

  // Noticed load testing failing with '-103 bad version', didn't understand why

  try {
    await reverseProxyZk.set(
      getSocket(selectedTargetHost.endpoint),
      String(selectedTargetHost.count + 1),
      selectedTargetHost.version, // Non `-1` version reference didn't work on artillery tests until started caching
    );
  } catch (e: any) {
    console.error(`Error with update attempt: ${JSON.stringify(selectedTargetHost)}`)
    throw e;
  }
}

const getTargets = async (incomingTargets: Target[]) => {
  const sockets = await reverseProxyZk.get_children(TARGETS_ZNODE_PATH, false);
  return incomingTargets.length === 0 ? R.sort(
    R.ascend(R.prop("count")),
    await Promise.all(
      sockets.map(async (socket) => {
        const [znodeStat, data] = (await reverseProxyZk.get(
          getSocket(socket),
          false,
        )) as [stat, object];
        return {
          endpoint: socket,
          count: data ? parseInt(data.toString()) : 0,
          version: znodeStat.version,
        };
      }),
    ),
  ) : incomingTargets
}


// Without caching couldn't really pass the Artillery test
const httpCache = new NodeCache({stdTTL: 100, checkperiod: 120});

const requestListener = async (outerReq: IncomingMessage, outerRes: ServerResponse, incomingTargets: Target[] = [], candidateHostIndex: number = 0) => {
  if (outerReq.url !== undefined) {
    const targets = await getTargets(incomingTargets)
    try {
      //const key = JSON.stringify(options) //Why did `options.path` not work?
      const key = getKey(outerReq.url, outerReq.method)
      if ((outerReq.method !== HttpMethod.GET) || !httpCache.get(key)) {

        // Should only have to make ZK writes in event of cache miss
        const options = getHttpOptions(targets, outerReq.url, candidateHostIndex)
        await updateTargetHostCount(targets, candidateHostIndex) // Replacing with shuffle didn't meaningfully improve: search commits
        const innerReq = http.request(options); // Writing JSON, multipart form, etc. in body would need to happen before this point
        // While this isn't needed for current implementation, would be required later on
        innerReq.end();
        innerReq.on("response", innerRes => { // I think the fact that incoming message doesn't just have a body - and that is streamed instead -is meaningful
          outerRes.writeHead(innerRes.statusCode || 200, outerReq.headers)

          innerRes.setEncoding("utf-8")
          const chunks: string[] = [];
          innerRes.on("data", chunk => {
            chunks.push(chunk)
          })
          innerRes.on("end", () => {
            try {
              const body = chunks.join("")
              outerRes.write(body)
              outerRes.end()
              httpCache.set<string>(key, body, 100)
            } catch (e) {
              outerRes.writeHead(500)
              outerRes.write("Internal Error")
              outerRes.end()
            }
          })
        })


        innerReq.on("error", async () => { // Try/catch is not enough, need explicit error event listener
          await requestListener(outerReq, outerRes, targets, candidateHostIndex + 1)
        })
      } else if (httpCache.get(key)) {
        const body = httpCache.get<string>(key)
        outerRes.writeHead(200, outerReq.headers)
        outerRes.end(body)
      }
    } catch (e: any) {
      await requestListener(outerReq, outerRes, targets, candidateHostIndex + 1)
    }
  } else {
    outerRes.writeHead(400)
    outerRes.end("Bad Request")
  }
}

createServer(requestListener).listen(4000);

