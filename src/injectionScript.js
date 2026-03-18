'use strict';

/**
 * Returns a self-executing JavaScript string that, when injected into a page,
 * overrides fetch, XMLHttpRequest and window.open so that every outbound
 * request is routed back through the web proxy.
 *
 * @param {string} proxyBase  e.g. "https://proxy.example.com"
 */
function getInjectionScript(proxyBase) {
  // proxyBase is server-side data – JSON.stringify handles escaping
  return `(function(){
var PB=${JSON.stringify(proxyBase)};
function wu(u){
  if(!u||/^(data:|javascript:|mailto:|tel:|blob:|#)/i.test(u))return u;
  try{
    var a=new URL(u,location.href).href;
    if(a.startsWith(PB))return a;
    return PB+'/?target='+encodeURIComponent(a);
  }catch(e){return u;}
}
/* ---- fetch ---- */
var oF=window.fetch;
window.fetch=function(input,init){
  if(typeof input==='string')input=wu(input);
  else if(input&&typeof input==='object'&&input.url){
    input=new Request(wu(input.url),input);
  }
  return oF.call(this,input,init);
};
/* ---- XMLHttpRequest ---- */
var OX=window.XMLHttpRequest;
function PX(){
  var x=new OX(),oO=x.open.bind(x);
  x.open=function(m,u,a,us,pw){return oO(m,wu(u),a,us,pw);};
  return x;
}
PX.prototype=OX.prototype;
window.XMLHttpRequest=PX;
/* ---- window.open ---- */
var oWO=window.open;
window.open=function(u,n,f){return oWO.call(this,wu(u),n,f);};
/* ---- form submit ---- */
document.addEventListener('submit',function(e){
  var f=e.target;
  if(f&&f.action&&!f.action.startsWith(PB)){
    e.preventDefault();
    f.action=wu(f.action);
    f.submit();
  }
},true);
/* ---- WebSocket: pass through unchanged (WS/WSS cannot be tunnelled via web proxy) ---- */
})();`;
}

module.exports = { getInjectionScript };
