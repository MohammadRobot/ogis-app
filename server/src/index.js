import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { createDatabase } from "./db.js";

const db = createDatabase(config);
const app = createApp(db, config);

function loadTlsFile(label, filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    throw new Error(`Failed to read ${label} file at "${filePath}": ${error.message}`);
  }
}

function createHttpServer(appInstance, cfg) {
  const hasCert = Boolean(cfg.tlsCertFile);
  const hasKey = Boolean(cfg.tlsKeyFile);

  if (hasCert !== hasKey) {
    throw new Error("Both OGIS_TLS_CERT_FILE and OGIS_TLS_KEY_FILE must be set together.");
  }

  if (!hasCert) {
    return {
      protocol: "http",
      server: http.createServer(appInstance),
    };
  }

  const options = {
    cert: loadTlsFile("TLS certificate", cfg.tlsCertFile),
    key: loadTlsFile("TLS private key", cfg.tlsKeyFile),
  };

  if (cfg.tlsCaFile) {
    options.ca = loadTlsFile("TLS CA", cfg.tlsCaFile);
  }

  if (cfg.tlsPassphrase) {
    options.passphrase = cfg.tlsPassphrase;
  }

  return {
    protocol: "https",
    server: https.createServer(options, appInstance),
  };
}

const { server, protocol } = createHttpServer(app, config);

server.listen(config.port, config.host, () => {
  console.log(`OGIS local server running on ${protocol}://${config.host}:${config.port}`);
  console.log(`SQLite file: ${config.dbFile}`);
  if (protocol === "https") {
    console.log(`TLS cert: ${config.tlsCertFile}`);
    console.log(`TLS key: ${config.tlsKeyFile}`);
  }
});

function shutdown(signal) {
  console.log(`Received ${signal}. Closing server...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
