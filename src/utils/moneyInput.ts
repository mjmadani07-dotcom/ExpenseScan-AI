import {toEnglishDigits} from './jalali';
export function normalizeMoneyInput(text:string):string|null{
 const s=toEnglishDigits(text).replace(/[,٬\s]/g,'').replace(/٫/g,'.');
 if(!/^\d*(?:\.\d*)?$/.test(s)||s.length>40||!Number.isFinite(Number(s||'0')))return s==='.'?s:null;
 return s;
}
export function groupMoneyInput(raw:string):string{
 const [whole,fraction]=raw.split('.');
 const grouped=whole.replace(/\B(?=(\d{3})+(?!\d))/g,',');
 return fraction===undefined?grouped:grouped+'.'+fraction;
}
export function moneyInputValue(raw:string):number{
 const n=Number(raw);return Number.isFinite(n)?n:0;
}
