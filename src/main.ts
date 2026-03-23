import "./styles/main.css";

const app = document.getElementById("app")!;

app.innerHTML = `
  <div class="arcturus">
    <header class="header">
      <h1 class="title">ARCTURUS</h1>
      <div class="status">
        <span class="status-item">48kHz</span>
        <span class="status-item">8v</span>
      </div>
    </header>
    <main class="body">
      <p class="placeholder">Connect your controllers to begin.</p>
    </main>
  </div>
`;
