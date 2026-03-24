import "./styles/main.css";
import { App } from "./ui/app";

async function main() {
  if (import.meta.env.DEV) {
    // MIDI monitor — always shown in dev to inspect ports and live messages
    const { MidiMonitor } = await import("./dev/midi-monitor");
    new MidiMonitor();

    // Fake controllers — opt-in via ?fake URL param.
    // Use this when no hardware is connected. Omit when testing real devices.
    if (new URLSearchParams(window.location.search).has("fake")) {
      const { installFakeControllers, seedFakeProfiles } = await import("./dev/fake-controllers");
      installFakeControllers();
      await seedFakeProfiles();
    }
  }

  const container = document.getElementById("app")!;
  const app = new App(container);
  await app.boot();
}

main();
