// One view owns one terminal cursor. Reads and input are serialized independently.
class WorkspaceTerminal {
  constructor({ key, host, call, onStatus, onError }) {
    Object.assign(this, { key, host, call, onStatus, onError });
    this.alive = true; this.cursor = 0; this.inputQueue = Promise.resolve();
    this.terminal = new Terminal({ cursorBlink: true, fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: { background: '#fbfbfa', foreground: '#242522', cursor: '#386c60', selectionBackground: '#b9cfc6' },
      scrollback: 10000, disableStdin: true });
    this.fitAddon = new FitAddon.FitAddon(); this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(host);
    this.terminal.onData(text => { if (this.running) this.enqueue('terminal_write', { text }); });
    this.observer = new ResizeObserver(() => this.fit()); this.observer.observe(host);
    this.fit();
  }
  enqueue(name, input) {
    this.inputQueue = this.inputQueue.then(() => this.alive ? this.call(name, input) : undefined)
      .catch(error => { if (this.alive) this.onError(error.message); });
  }
  fit() {
    if (!this.alive || this.host.clientWidth < 30 || this.host.clientHeight < 20) return;
    this.fitAddon.fit();
    const cols = Math.max(2, Math.min(500, this.terminal.cols)), rows = Math.max(1, Math.min(300, this.terminal.rows));
    const size = `${cols}:${rows}`;
    if (this.running && size !== this.size) { this.size = size; this.enqueue('terminal_resize', { cols, rows }); }
  }
  async refresh() {
    if (!this.alive) return;
    if (this.reading) { this.reread = true; return; }
    this.reading = true;
    try {
      do {
        this.reread = false;
        const result = await this.call('terminal_read', { cursor: this.cursor });
        if (!this.alive) return;
        this.running = result.status === 'running'; this.terminal.options.disableStdin = !this.running;
        if (result.truncated) { this.terminal.reset(); this.terminal.writeln('[Earlier output is no longer retained]'); }
        await new Promise(resolve => this.terminal.write(result.output, resolve));
        if (!this.alive) return;
        this.cursor = result.cursor; this.onStatus(result); this.fit();
      } while (this.reread);
    } catch (error) { if (this.alive) this.onError(error.message); }
    finally { this.reading = false; }
  }
  dispose() { this.alive = false; this.observer.disconnect(); this.terminal.dispose(); }
}
