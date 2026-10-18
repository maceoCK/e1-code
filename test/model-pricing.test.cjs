const {test}=require('node:test'),assert=require('node:assert/strict');
const {modelPricing,enrichPricing}=require('../src/model-pricing.cjs');
const openai={baseUrl:'https://api.openai.com/v1'},claude={authType:'claude-code'};
test('pricing matches provider, exact model and speed, including cached and long-context rates',()=>{
 const p=modelPricing(openai,'gpt-6.1-sol','api','ultrafast');assert.equal(p.rates.input,12);assert.equal(p.rates.output,60);assert.equal(p.rates.cachedInput,.6);assert.equal(p.threshold,272000);assert.equal(p.longRates.output,90);
 assert.equal(modelPricing(openai,'gpt-6-luna','api').rates.input,.1);
 const c=modelPricing(claude,'claude-opus-5-5','api','fast');assert.equal(c.rates.output,40);assert.equal(c.rates.cacheWriteHour,16);
 assert.equal(modelPricing(claude,'claude-haiku-5-5','api').longRates.input,.5);
 assert.equal(modelPricing({baseUrl:'https://api.abliteration.ai/v1'},'abliterated-model-large-v2','api').rates.output,5);
});
test('unknown model, version, provider or speed never inherits another price',()=>{
 for(const [p,model,mode] of [[{baseUrl:'https://proxy.test'},'gpt-6.1-sol','standard'],[openai,'gpt-6.2-sol','standard'],[openai,'gpt-6.1-sol-2099-01-01','standard'],[claude,'claude-sonnet-5-5','fast']])assert.equal(modelPricing(p,model,'api',mode).state,'unavailable');
 assert.equal(modelPricing({},'local-model','local').state,'local');
});
test('subscription prices are reference only and delivered tier overrides requested tier',()=>{
 assert.equal(modelPricing({authType:'chatgpt-subscription'},'gpt-6.1-sol','subscription').reference,true);
 const p=enrichPricing({billing:'api',model:'gpt-6.1-sol',requestedSpeed:'ultrafast',actualSpeed:'standard'},openai);assert.equal(p.pricing.rates.input,2);assert.equal(p.priceBySpeed.ultrafast.rates.input,12);
});

test('paused plans retain account usage access and reference pricing',()=>{const p=enrichPricing({billing:'paused',model:'gpt-6.1-sol'},{id:'plan',authType:'chatgpt-subscription'});assert.equal(p.planProvider,'plan');assert.equal(p.pricing.reference,true);});
