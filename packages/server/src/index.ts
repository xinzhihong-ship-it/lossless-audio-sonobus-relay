import { createApp, type ServerConfig } from "./app.js";

const config: ServerConfig = {
  jwtSecret: required("JWT_SECRET", process.env.JWT_SECRET),
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "admin123456",
  databaseUrl: process.env.DATABASE_URL,
  maxBytesPerSecondPerClient: Number(process.env.MAX_BYTES_PER_SECOND_PER_CLIENT ?? 50 * 1024 * 1024),
  udpRelayPort: Number(process.env.UDP_RELAY_PORT ?? 9000)
};

const port = Number(process.env.PORT ?? 8080);
const app = await createApp(config);
app.server.listen(port, "0.0.0.0", () => {
  console.log(`lossless audio relay listening on :${port}`);
});

process.on("SIGTERM", () => {
  app.close().finally(() => process.exit(0));
});

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
