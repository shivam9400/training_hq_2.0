import { Component, useState, type ReactNode } from "react";
import { useTraining } from "./hooks/useTraining";
import { Dashboard, tabs, type Tab } from "./pages/Dashboard";
import "./styles/app.css";
function TrainingApp() {
  const app = useTraining();
  const [tab, setTab] = useState<Tab>("Today");
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="app">
        <header className="topbar">
          <a
            href="#"
            className="brand"
            aria-label="Training HQ home"
            onClick={() => setTab("Today")}
          >
            <img
              src={`${import.meta.env.BASE_URL}icon.svg`}
              width="40"
              height="40"
              alt=""
            />
            <span>
              Training HQ<small>MAKE ROOM FOR PROGRESS</small>
            </span>
          </a>
          <span className="connection">
            {app.online ? "Online" : "Offline"} ·{" "}
            {app.user ? "Private workspace" : "Demo workspace"}
          </span>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR TRAINING, YOUR PACE</p>
              <h1>{tab}</h1>
            </div>
            <span className="pill">
              {app.mode === "demo"
                ? "MOCK DATA"
                : app.mode === "loading"
                  ? "LOADING"
                  : "PRIVATE DATA"}
            </span>
          </div>
          {app.mode === "demo" && (
            <aside className="banner">
              Synthetic demo · Edits stay in memory and reset on reload. Sign in
              from Settings for an empty private workspace.
            </aside>
          )}
          {!app.online && (
            <aside className="banner" role="status">
              Offline · Static app resources remain available. Private cloud
              reads and writes require a connection. Nothing syncs while this
              browser is closed.
            </aside>
          )}
          {app.error && (
            <aside role="alert" className="banner error">
              {app.error}
              {app.user && (
                <button className="secondary" onClick={app.refresh}>
                  Retry private data
                </button>
              )}
            </aside>
          )}
          {app.busy && <p role="status">Saving / processing…</p>}
          {app.mode === "loading" ? (
            <p role="status">Loading your workspace…</p>
          ) : (
            <Dashboard
              key={`${app.user?.uid ?? "demo"}-${tab}`}
              tab={tab}
              app={app}
            />
          )}
        </main>
        <footer>
          PRIVATE BY DESIGN · No Google Drive access in this milestone
        </footer>
      </div>
      <nav aria-label="Main navigation" className="bottom-nav">
        {tabs.map((name, i) => (
          <button
            key={name}
            aria-current={tab === name ? "page" : undefined}
            className={tab === name ? "active" : ""}
            onClick={() => {
              setTab(name);
              window.scrollTo({ top: 0 });
            }}
          >
            <span aria-hidden="true">{["◉", "▦", "↗", "≋", "♡", "⚙"][i]}</span>
            {name}
          </button>
        ))}
      </nav>
    </>
  );
}
export default class App extends Component<object, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render(): ReactNode {
    if (this.state.failed)
      return (
        <main className="app">
          <h1>Training HQ could not start</h1>
          <p>
            No private data is shown. Check configuration or reload to try
            again.
          </p>
          <button onClick={() => location.reload()}>Reload app</button>
        </main>
      );
    return <TrainingApp />;
  }
}
