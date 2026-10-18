// Published list prices, USD per million tokens. Match the service as well as
// the exact model ID; a compatible endpoint may have a different price.
const data=require('./model-prices.json');
const sources={openai:'https://developers.openai.com/api/docs/pricing',anthropic:'https://platform.claude.com/docs/en/about-claude/pricing',abliteration:'https://abliteration.ai/pricing',decuff:'https://decuff.ai/pricing'};
const claude={
 'claude-fable-5-1':[10,50,.25], 'claude-fable-5':[10,50,1],
 'claude-mythos-5-1':[10,50,.25], 'claude-mythos-5':[10,50,1],
 'claude-opus-5-5':[4,20,.2], 'claude-opus-5':[5,25,.5],
 'claude-opus-4-8':[5,25,.5], 'claude-opus-4-7':[5,25,.5], 'claude-opus-4-6':[5,25,.5],
 'claude-sonnet-5-5':[2,10,.1], 'claude-sonnet-5':[2,10,.2], 'claude-sonnet-4-6':[3,15,.3],
 'claude-haiku-5-5':[.1,.5,.01],
};
const decuffRates={
 'decuffed-flash':[0.5,1.5,0.05], 'decuffed-flash-heretic':[0.5,1.5,0.05], 'decuffed-flash-conservative':[0.5,1.5,0.05], 'decuffed-flash-research':[0.5,1.5,0.05],
 'decuff-flash':[0.5,1.5,0.05], 'decuff-flash-heretic':[0.5,1.5,0.05], 'decuff-flash-small':[0.5,1.5,0.05],
 'heretic':[0.5,1.5,0.05], 'huihui':[0.5,1.5,0.05],
 'decuffed-standard':[1.0,3.0,0.1], 'decuff-standard':[1.0,3.0,0.1], 'decuff-legal':[1.0,3.0,0.1], 'decuff-vision':[1.0,3.0,0.1],
 'decuffed-flagship':[3.0,5.0,0.3], 'decuffed-flagship-heretic':[3.0,5.0,0.3], 'decuff-flagship':[3.0,5.0,0.3], 'decuff-flagship-heretic':[3.0,5.0,0.3],
};
function serviceFor(p){
 if(p.authType==='claude-code')return'anthropic';
 if(p.authType==='chatgpt-subscription')return'openai';
 let origin;try{origin=new URL(p.baseUrl).origin;}catch{}
 if(origin&&(/decuff/i.test(origin)||origin.endsWith('.modal.direct')))return'decuff';
 return ({'https://api.openai.com':'openai','https://api.anthropic.com':'anthropic','https://api.abliteration.ai':'abliteration'})[origin];
}
function modelPricing(p,model,billing,mode='standard'){
 if(billing==='local')return{state:'local',note:'Runs locally. No provider token charge.'};
 const service=serviceFor(p),tier=({default:'standard',priority:'fast'})[mode]||mode;
 let price;
 if(service==='openai')price=data.openai[model]?.[tier];
 if(service==='anthropic'&&claude[model]){
  const [input,output,cachedInput]=claude[model];
  const multiplier=tier==='standard'?1:tier==='fast'&&['claude-opus-5-5','claude-opus-5','claude-opus-4-8'].includes(model)?2:null;
  if(multiplier){price={rates:{input:input*multiplier,output:output*multiplier,cachedInput:cachedInput*multiplier,cacheWrite:input*1.25*multiplier,cacheWriteHour:input*2*multiplier}};
   if(model==='claude-haiku-5-5')Object.assign(price,{threshold:100000,longRates:{input:.5,output:2.5,cachedInput:.05,cacheWrite:.625,cacheWriteHour:1}});
  }
 }
 if(service==='abliteration'&&tier==='standard'){
  const rate={'abliterated-model':[1,3,.1],'abliterated-model-large':[3,5,.3],'abliterated-model-large-v2':[3,5,.3]}[model];
  if(rate)price={rates:{input:rate[0],output:rate[1],cachedInput:rate[2],cacheWrite:rate[0]}};
 }
 if(service==='decuff'&&tier==='standard'){
  const rate=decuffRates[model];
  if(rate)price={rates:{input:rate[0],output:rate[1],cachedInput:rate[2]}};
 }
 return {state:price?'published':'unavailable',model,mode:tier,reference:billing==='subscription',service,source:sources[service],verifiedAt:data.verifiedAt,...price,
  note:price?'Published list prices. Tool fees, taxes and account discounts are separate.':'No verified price for this model, provider and speed.'};
}
function enrichPricing(status,p){
 const speed=status.actualSpeed||status.requestedSpeed||'standard';
 const isPlan=status.billing==='subscription'||status.billing==='paused'&&(p.authType==='chatgpt-subscription'||p.authType==='claude-code'&&p.billingMethod!=='console');
 const billing=isPlan?'subscription':status.billing;
 return {...status,...(isPlan?{planProvider:p.id}:{}),pricing:modelPricing(p,status.model,billing,speed),priceBySpeed:Object.fromEntries(['standard','fast','ultrafast'].map(mode=>[mode,modelPricing(p,status.model,billing,mode)]))};
}
module.exports={modelPricing,enrichPricing};
