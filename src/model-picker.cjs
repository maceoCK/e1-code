// Register configured E1 routes with the CLI's supported curated picker.
// The CLI still checks model policy, but no longer sends a five-second inference
// probe through the account CLI adapter just to select an already listed route.
function nativePicker(models, excluded = new Set()) {
  const options = [];
  for (const model of models || []) {
    if (!/^claude-aster-[0-9a-f]{16}$/.test(model.name) || excluded.has(model.name)) continue;
    options.push({ model: model.name, label: model.labelOverride || model.name });
    if (model.supports1m === true) options.push({ model: model.name + '[1m]', label: (model.labelOverride || model.name) + ' (1M context)' });
  }
  return options.length ? { modelPicker: { options, replaceBuiltInOptions: false } } : {};
}
module.exports = { nativePicker };
