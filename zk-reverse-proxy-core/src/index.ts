import { createServer, IncomingMessage, ServerResponse } from "node:http";

//import * as R from "ramda";
import http from "node:http";

const targetServer = (port: number) => {
  createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200);
      res.end(`Served on port ${port}`);
    } else if (req.method !== "GET") {
      res.writeHead(405);
      res.end("Method Not Supported");
    } else if (req.url !== "/") {
      res.writeHead(404);
      res.end("Path not found");
    } else {
      res.writeHead(500);
      res.end("Internal Error");
    }
  }).listen(port);
};

targetServer(4001);
targetServer(4002);

let a = true;

createServer((req: IncomingMessage, res: ServerResponse) => {
  const options = {
    hostname: "127.0.0.1",
    port: a ? 4001 : 4002,
    method: "GET",
    path: req.url,
  };
  a = !a;
  const proxyReq = http.request(options, (proxyRes) => {
    proxyRes.on("data", (chunk) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(chunk);
    });
    proxyRes.on("end", () => {
      proxyReq.end();
      res.end();
    });
  });

  proxyReq.on("error", (e) => {
    res.writeHead(500);
    res.end(e);
  });
}).listen(4000);
