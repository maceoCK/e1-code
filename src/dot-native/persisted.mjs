// Early adapter builds stored the server's seconds in the native renderer's
// millisecond fallback. Migrate only those two timestamp records; preserve all
// unrelated profile preferences, drafts and account-local state.
export function migratePersisted(value){
 const state=value&&typeof value==='object'&&!Array.isArray(value)?{...value}:{};
 for(const key of Object.keys(state)){
  const n=state[key];
  if(/^aeon-last-activity(?:-fallback)?-v1:/.test(key)&&typeof n==='number'&&Number.isFinite(n)&&n>0&&n<1e11)state[key]=n*1000;
 }
 return state;
}
