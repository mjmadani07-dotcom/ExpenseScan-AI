import React,{useLayoutEffect,useRef,useState} from 'react';
import {groupMoneyInput,moneyInputValue,normalizeMoneyInput} from '../utils/moneyInput';
type Props=Omit<React.InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'|'type'|'step'> & {value:number;onValueChange:(n:number)=>void;step?:number|string};
export function MoneyInput({value,onValueChange,min,step:_step,required,...props}:Props){
 const [editing,setEditing]=useState<string|null>(null);
 const node=useRef<HTMLInputElement>(null),caret=useRef<number|null>(null);
 const raw=editing!==null&&moneyInputValue(editing)===value?editing:String(value);
 const shown=groupMoneyInput(raw);
 useLayoutEffect(()=>{
   const el=node.current;if(!el)return;
   el.setCustomValidity((required&&(raw===''||raw==='.'))||(raw!==''&&raw!=='.'&&min!==undefined&&moneyInputValue(raw)<Number(min))?'مبلغ معتبر وارد کنید.':'');
   if(caret.current!==null){let i=0,count=0;while(i<shown.length&&count<caret.current){if(shown[i]!==',')count++;i++;}el.setSelectionRange(i,i);caret.current=null;}
 },[shown,raw,min,required]);
 return <input {...props} ref={node} type="text" inputMode="decimal" dir="ltr" required={required} value={shown}
 onBlur={e=>{setEditing(null);props.onBlur?.(e);}}
 onChange={e=>{const next=normalizeMoneyInput(e.target.value);if(next===null)return;
  const prefix=normalizeMoneyInput(e.target.value.slice(0,e.target.selectionStart??e.target.value.length));
  caret.current=prefix?.length??next.length;setEditing(next);onValueChange(moneyInputValue(next));
 }}/>;
}
