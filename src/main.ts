import "./styles/main.css";
import { App } from "./ui/app";

async function main() {
  // In dev mode, install fake MIDI controllers (keyboard → MIDI)
  if (import.meta.env.DEV) {
    const { installFakeControllers } = await import("./dev/fake-controllers");
    installFakeControllers();
  }

  const container = document.getElementById("app")!;
  const app = new App(container);
  await app.boot();
}

main();
