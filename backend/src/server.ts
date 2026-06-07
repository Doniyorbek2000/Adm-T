import { app } from "./app";
import { env } from "./utils/env";
import { startAiEngine } from "./services/aiEngine";

app.listen(env.port, () => {
  console.log(`ADM Trading API http://localhost:${env.port} portida ishga tushdi`);
  // AI tahlil/savdo dvigateli serverga ulanishi bilan fonda mustaqil ishga tushadi
  startAiEngine(60_000);
});
