import React,{createContext,useContext,useLayoutEffect,useMemo,useRef,useState} from 'react';
type Activity={busy:boolean;isBusy:()=>boolean;mark:(key:object,busy:boolean)=>void};
const Context=createContext<Activity|null>(null);
export const useWorkspaceActivity=()=>useContext(Context);
export function useWorkspaceBusy(busy:boolean){
 const activity=useContext(Context),key=useRef({});
 const mark=activity?.mark;
 useLayoutEffect(()=>{mark?.(key.current,busy);return()=>mark?.(key.current,false);},[mark,busy]);
}
export function WorkspaceActivityProvider({children}:{children:React.ReactNode}){
 const active=useRef(new Set<object>()),[busy,setBusy]=useState(false);
 const controls=useMemo(()=>({isBusy:()=>active.current.size>0,mark:(key:object,value:boolean)=>{if(value)active.current.add(key);else active.current.delete(key);setBusy(active.current.size>0);}}),[]);
 const context=useMemo(()=>({...controls,busy}),[controls,busy]);
 return <Context.Provider value={context}>{children}</Context.Provider>;
}
