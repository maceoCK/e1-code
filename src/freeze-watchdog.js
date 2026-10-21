(() => {
  const schedule = window.queueMicrotask, Observer = window.MutationObserver;
  let tasks = 0, focuses = 0;
  setInterval(() => { tasks = 0; focuses = 0; }, 1000);
  window.queueMicrotask = function(callback) {
    if (++tasks === 1000) { console.error('E1_DIAG_MICROTASK ' + new Error().stack); debugger; }
    if (tasks > 1000) return;
    return schedule(callback);
  };
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function(...args) {
    if (++focuses === 100) { console.error('E1_DIAG_FOCUS ' + new Error().stack); debugger; }
    if (focuses > 100) return;
    return focus.apply(this, args);
  };
  window.MutationObserver = class extends Observer {
    constructor(callback) {
      const stack = new Error().stack; let count = 0;
      setInterval(() => count = 0, 1000);
      super((records, observer) => {
        if (++count === 100) { console.error('E1_DIAG_OBSERVER ' + stack + '\n' + callback.toString().slice(0,800)); debugger; }
        if (count > 100) return;
        callback(records, observer);
      });
    }
  };
  console.log('E1_DIAG_INSTALLED');
})();
