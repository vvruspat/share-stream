import { readFileSync } from "node:fs";
import { createService } from "./service.js";
const secret = process.env.TURN_SECRET_FILE
  ? readFileSync(process.env.TURN_SECRET_FILE, "utf8").trim()
  : process.env.TURN_SECRET;
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.PUBLIC_ORIGIN?.startsWith("https://") || !secret)
)
  throw new Error("Production requires HTTPS origin and TURN secret");
const service = createService({
  origin: process.env.PUBLIC_ORIGIN,
  turnSecret: secret,
  turnHost: process.env.TURN_HOST,
});
service.server.listen(Number(process.env.PORT || 48101), "0.0.0.0", () =>
  console.log("Share Stream collaboration listening"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void service.close().then(() => process.exit(0));
  });
