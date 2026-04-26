import "./styles/main.css";
import { App } from "./ui/app";

async function main() {
  if (import.meta.env.DEV) {
    // MIDI monitor — always shown in dev to inspect ports and live messages
    const { MidiMonitor } = await import("./dev/midi-monitor");
    new MidiMonitor();
  }

  const container = document.getElementById("app")!;
  const app = new App(container);
  await app.boot();
}

main();
