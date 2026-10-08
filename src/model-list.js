(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.E1ModelList = api;
})(globalThis, function () {
  const normalize = value => String(value || '').normalize('NFKD').toLowerCase().replace(/\p{M}+/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const compare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  function info(row) {
    const name = String(row.name || row.display_name || row.id || 'Unknown model');
    const parts = name.split(' · ');
    const model = row.model || (parts.length > 1 ? parts.slice(1).join(' · ') : name);
    const key = model.toLowerCase();
    const snapshot = key.match(/[- ](20\d{2})[- ]?(\d{2})[- ]?(\d{2})$/);
    const base = snapshot ? key.slice(0, snapshot.index) : key;
    const custom = /^ft:/.test(key) || row.providerKind === 'ollama' || /abliterat|ollama|local/i.test(row.providerName || parts[0]);
    const vendor = row.vendor || (custom ? row.providerName || parts[0] : /^claude\b/i.test(key) ? 'Claude' : /^(gpt[- ]|o[134](?:-|$)|chatgpt-)/i.test(key) ? 'OpenAI' : row.providerName || (parts.length > 1 ? parts[0] : 'Other models'));
    const gpt = !custom && base.match(/^gpt[- ](\d+)(?:[.-](\d+))?/);
    const tierFirst = base.match(/^claude[- ](opus|sonnet|haiku|fable)[- ](\d+)(?:[. -](\d+))?/);
    const versionFirst = base.match(/^claude[- ](\d+)(?:[. -](\d+))?[- ](opus|sonnet|haiku|fable)/);
    const claude = !custom && (tierFirst || (versionFirst && [versionFirst[0],versionFirst[3],versionFirst[1],versionFirst[2]]));
    const family = gpt ? 'OpenAI GPT' : claude ? 'Claude ' + claude[1] : null;
    const version = gpt ? [Number(gpt[1]), Number(gpt[2] || 0)] : claude ? [Number(claude[2]), Number(claude[3] || 0)] : [0, 0];

    const connection = row.connection ?? row.providerName ?? (parts.length > 1 ? parts[0] : '');
    const title = parts.length > 1 ? parts.slice(1).join(' · ') : name;
    return { ...row, name, model, vendor, family, version, snapshot:!!snapshot, base, custom, connection, title };
  }
  function classify(rows, universe = rows) {
    const all = universe.map(info), newest = new Map();
    const bases = new Set(all.filter(r => !r.snapshot).map(r => r.vendor + ':' + r.model.toLowerCase()));
    for (const r of all) {
      if (!r.family) continue;
      const old = newest.get(r.family);
      if (!old || r.version[0] > old[0] || (r.version[0] === old[0] && r.version[1] > old[1])) newest.set(r.family, r.version);
    }
    return rows.map(info).map(r => {
      const latest = newest.get(r.family);
      // GPT variants within the current generation stay visible (e.g. 6.1 Sol
      // alongside 6 Astra/Luna). Claude versions are compared within each tier.
      const older = latest && (r.version[0] < latest[0] || (r.family.startsWith('Claude ') && r.version[0] === latest[0] && r.version[1] < latest[1]));
      const oldOpenAI = !r.custom && r.vendor === 'OpenAI' && !r.family && /^(o[134](?:-|$)|chatgpt-)/i.test(r.model) && newest.has('OpenAI GPT');
      const duplicate = !r.custom && r.snapshot && bases.has(r.vendor + ':' + r.base);
      const legacy = !!(r.legacy || r.meta?.legacy || r.meta?.deprecated || older || oldOpenAI || duplicate);
      return { ...r, legacy, searchText:normalize([r.name, r.model, r.vendor, r.connection, ...(r.searchAliases || [])].join(' ')) };
    });
  }
  function matches(row, query) {
    const text = row.searchText || normalize([row.label, row.name, row.model, row.vendor, row.connection].join(' '));
    const compact=text.replaceAll(' ', '');
    // Keep version components adjacent: 6.1 must not match a 6 snapshot whose
    // date happens to contain 1. Other punctuation remains optional.
    const versions=String(query).match(/\d+(?:[.-]\d+)+/g)||[];
    if (!versions.every(version=>(' '+text+' ').includes(' '+normalize(version)+' '))) return false;
    return normalize(query).split(' ').filter(Boolean).every(word => text.includes(word) || compact.includes(word));
  }
  function arrange(rows, {showLegacy=false, selected, query='', universe=rows} = {}) {
    const tier = row => ({'Claude opus':0,'Claude sonnet':1,'Claude haiku':2}[row.family] ?? 3);
    const rank = vendor => vendor === 'Claude' ? 0 : vendor === 'OpenAI' ? 1 : 2;
    return classify(rows, universe).filter(r => (showLegacy || !r.legacy || r.id === selected) && matches(r, query)).sort((a,b) =>
      rank(a.vendor)-rank(b.vendor) || compare(a.vendor,b.vendor) || Number(a.legacy)-Number(b.legacy) ||
      b.version[0]-a.version[0] || b.version[1]-a.version[1] || tier(a)-tier(b) || compare(a.title,b.title) || compare(a.connection,b.connection) || compare(a.id,b.id));
  }
  function items(rows, options) {
    let previous;
    return arrange(rows, options).map(r => {
      const group = r.vendor;
      const item = { value:r.id, label:r.name, searchText:r.searchText,
        ...(group !== previous ? {groupLabelBefore:group} : {}),
        ...(r.legacy ? {description:'Legacy model' + (r.id === options?.selected ? ' · current selection' : '')} : {}),
      };
      previous = group; return item;
    });
  }
  return { normalize, classify, matches, arrange, items };
});
