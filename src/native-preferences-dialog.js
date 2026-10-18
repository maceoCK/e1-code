(() => {
  if (window.e1PreferenceDialog) return;
  let modules, request = 0, active;
  function load() {
    // Use the same recovered components as the app, including their focus,
    // portal, dropdown, animation, and reduced-motion handling.
    return modules ||= Promise.all([
      import('/assets/v1/vendor-frame-Bk3oL3Qp.js'),
      import('/assets/v1/shared-frame-mKeNK6Hi.js'),
    ]).catch(error => { modules = null; throw error; });
  }
  window.e1PreferenceDialog = {
    async open(options) {
      const ticket = ++request;
      const [data, [react, cds]] = await Promise.all([options.read(), load()]);
      if (ticket !== request || !options.isCurrent()) return;
      active?.close();
      const config = options.configure(data);
      const { sa: createRoot, aa: h } = react;
      const { Ho: Dialog, Qs: Button, Lr: Combobox, zc: Provider } = cds;
      const host = document.createElement('div');
      host.dataset.e1PreferencesHost = '';
      document.body.append(host);
      const root = createRoot(host);
      const popup = { current: null };
      const theme = options.trigger.closest('.cds-root') || document.documentElement;
      let values = { ...config.values }, opened = true, busy = false, error = '', disposed = false;
      const current = { close };
      active = current;
      function dispose() {
        if (disposed) return;
        disposed = true;
        themeObserver.disconnect();
        root.unmount();
        host.remove();
      }
      function close() {
        if (!opened) return;
        opened = false;
        if (active === current) active = null;
        render();
      }
      async function save(reset = false) {
        if (busy || !opened || (!reset && config.canSave && !config.canSave(values))) return;
        busy = true; error = ''; render();
        try {
          const updated = await config.save({ ...values }, reset);
          options.onSaved(updated);
          if (opened) close();
        } catch (failure) {
          if (!opened) return;
          error = failure.message || String(failure);
          busy = false; render();
        }
      }
      function render() {
        if (disposed) return;
        const fields = config.fields(values).filter(field => !field.hidden);
        const note = config.note?.(values);
        root.render(h(Provider, {
          mode: theme.getAttribute('data-mode') || document.documentElement.getAttribute('data-mode') || 'system',
          density: theme.getAttribute('data-density') || undefined,
          children: h(Dialog.Root, {
            open: opened,
            onOpenChange: (next, details) => {
              // A fast Escape can arrive before the dropdown's portal receives
              // focus. Let the dropdown handle it before dismissing its parent.
              const expanded = popup.current?.querySelector('[role=combobox][aria-expanded=true]');
              if (!next && details.reason === 'escape-key' && expanded) {
                details.cancel(); expanded.click(); return;
              }
              if (!next) close();
            },
            onOpenChangeComplete: next => { if (!next) queueMicrotask(dispose); },
            children: h(Dialog.Popup, {
              ref: popup, size: 'md', 'data-e1-preferences': config.id,
              finalFocus: () => active && active !== current ? false : (options.trigger.isConnected ? options.trigger : false),
              children: h('form', {
                onSubmit: event => { event.preventDefault(); void save(); },
                children: [
                  h(Dialog.Header, { description: config.description, children: config.title }, 'header'),
                  h('div', { className: 'flex flex-col gap-4', children: fields.map(field => {
                    const change=value=>{values={...values,[field.name]:value??''};values=config.normalize?.(values)||values;error='';render();};
                    if(field.presentation==='choices')return h('fieldset',{disabled:busy||field.disabled,className:'flex flex-col gap-2',children:[
                      h('legend',{className:'mb-2 text-body font-medium',children:field.label},'label'),
                      h('div',{role:'radiogroup','aria-label':field.label,className:'flex flex-wrap gap-2',children:field.items.map(item=>h(Button,{
                        type:'button',role:'radio','aria-checked':values[field.name]===item.value,disabled:busy||field.disabled,
                        tabIndex:values[field.name]===item.value||(!field.items.some(i=>i.value===values[field.name])&&item===field.items[0])?0:-1,
                        onKeyDown:event=>{
                          const keys=['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'];if(!keys.includes(event.key))return;event.preventDefault();
                          const buttons=[...event.currentTarget.parentElement.querySelectorAll('[role=radio]:not(:disabled)')],index=buttons.indexOf(event.currentTarget);
                          const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+buttons.length)%buttons.length;
                          buttons[next]?.focus();buttons[next]?.click();
                        },
                        variant:values[field.name]===item.value?'secondary':'ghost',
                        className:field.rows?'w-full justify-start text-left h-auto py-3':'',
                        onClick:()=>change(item.value),children:h('span',{children:[h('span',{className:'block',children:(values[field.name]===item.value?'✓ ':'')+item.label},'name'),item.description&&h('span',{className:'block text-secondary text-caption',children:item.description},'description')]})
                      },item.value))},'choices')
                    ]},field.name);
                    return h(Combobox,{name:field.name,label:field.label,items:field.items,filter:field.filter,value:values[field.name],disabled:busy||field.disabled,onChange:change},field.name);
                  }) }, 'fields'),
                  note && h('p', { className: 'mt-4 text-body text-secondary', 'data-warning': config.id === 'speed' ? '' : undefined, children: note }, 'note'),
                  error && h('p', { role: 'alert', className: 'mt-4 text-body text-danger', children: error }, 'error'),
                  h(Dialog.Footer, { children: [
                    config.reset && h(Button, { type: 'button', variant: 'ghost', className: 'sm:mr-auto', disabled: busy, onClick: () => void save(true), children: 'Reset' }, 'reset'),
                    h(Button, { type: 'button', onClick: close, children: 'Cancel' }, 'cancel'),
                    h(Button, { type: 'submit', variant: 'primary', busy, busyLabel: 'Saving…', disabled: busy || (config.canSave ? !config.canSave(values) : false), children: config.saveLabel?.(values) || 'Save changes' }, 'save'),
                  ] }, 'footer'),
                ],
              }),
            }),
          }),
        }));
      }
      const themeObserver = new MutationObserver(render);
      themeObserver.observe(theme, { attributes: true, attributeFilter: ['data-mode', 'data-density'] });
      if (theme !== document.documentElement) themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
      render();
    },
  };
})();
