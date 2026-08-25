import { writeFile } from "node:fs/promises";
import { SPOTLIGHT_APP_SCHEMA_V1 } from "../dist/schema.js";

await writeFile(
  new URL("../dist/spotlight-app.schema.json", import.meta.url),
  `${JSON.stringify(SPOTLIGHT_APP_SCHEMA_V1, null, 2)}\n`,
  "utf8",
);
