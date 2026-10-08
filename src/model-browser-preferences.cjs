const path = require('node:path');
const {readJson,atomicJson} = require('./library-identity.cjs');
class ModelBrowserPreferences {
  constructor(dir) { this.file=path.join(dir,'model-browser-preferences.json'); }
  read() { return {showLegacy:readJson(this.file,{})?.showLegacy === true}; }
  save(value) {
    if (!value || typeof value.showLegacy !== 'boolean') throw Error('Show legacy models must be true or false.');
    const next={showLegacy:value.showLegacy}; atomicJson(this.file,next); return next;
  }
}
module.exports={ModelBrowserPreferences};
