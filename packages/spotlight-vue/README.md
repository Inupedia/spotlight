# @inupedia/spotlight-vue

Spotlight 的 Vue UI 与运行时适配器。Vue 项目提供扁平配置即可，不需要 Host、Capability Registry 或项目适配器。

```ts
import {
  defineSpotlightConfig,
  readSpotlightEnv,
} from "@inupedia/spotlight-vue";
import { tools } from "./spotlight-tools";

export default defineSpotlightConfig({
  ...readSpotlightEnv(import.meta.env, { projectId: "my-project" }),
  frontendBuildId: import.meta.env.VITE_BUILD_SHA,
  tools,
});
```

```ts
import { SpotlightVue } from "@inupedia/spotlight-vue";
import spotlightConfig from "./spotlight.config";

app.use(SpotlightVue, spotlightConfig);
```

完整示例见 [Client Tool 接入指南](../../docs/client-tools.md)。
