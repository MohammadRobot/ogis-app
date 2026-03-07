import { createApp } from "./app.js";
import { config } from "./config.js";
import { createDatabase } from "./db.js";

const db = createDatabase(config);
const app = createApp(db, config);

const server = app.listen(config.port, config.host, () => {
  console.log(`OGIS local server running on http://${config.host}:${config.port}`);
  console.log(`SQLite file: ${config.dbFile}`);
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
