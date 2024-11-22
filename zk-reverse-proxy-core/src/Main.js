"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var node_http_1 = require("node:http");
var node_net_1 = require("node:net");
var node_url_1 = require("node:url");
// Create an HTTP tunneling proxy
var proxy = (0, node_http_1.createServer)(function (_req, res) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("okay");
});
proxy.on("connect", function (req, clientSocket, head) {
    // Connect to an origin server
    var _a = new node_url_1.URL("http://".concat(req.url)), port = _a.port, hostname = _a.hostname;
    var serverSocket = (0, node_net_1.connect)(Number(port) || 80, hostname, function () {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n" +
            "Proxy-agent: Node.js-Proxy\r\n" +
            "\r\n");
        serverSocket.write(head);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
    });
});
// Now that proxy is running
proxy.listen(1337, "127.0.0.1", function () {
    // Make a request to a tunneling proxy
    var options = {
        port: 1337,
        host: "127.0.0.1",
        method: "CONNECT",
        path: "www.google.com:80",
    };
    var req = (0, node_http_1.request)(options);
    req.end();
    req.on("connect", function (_res, socket, _head) {
        console.log("got connected!");
        socket.write("GET / HTTP/1.1\r\n" +
            "Host: www.google.com:80\r\n" +
            "Connection: close\r\n" +
            "\r\n");
        socket.on("data", function (chunk) {
            console.log(chunk.toString());
        });
        socket.on("end", function () {
            proxy.close();
        });
    });
});
