import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AndroidSnapshotStore, isAndroidRuntime } from './storage/androidSnapshotStore';
import { LocalLedgerRepository } from './storage/localLedgerRepository';
import './index.css';

const root=createRoot(document.getElementById('root')!);
async function start(){
  if(import.meta.env.VITE_ANDROID_BUILD==='true'||isAndroidRuntime()){
    if(!isAndroidRuntime())throw new Error('این بسته باید در برنامه اندروید اجرا شود.');
    const repository=new LocalLedgerRepository(new AndroidSnapshotStore());
    await repository.initialize();
    root.render(<App repository={repository}/>);
  }else{
    const {registerSW}=await import('virtual:pwa-register');
    registerSW({immediate:true});
    root.render(<App/>);
  }
}
void start().catch(error=>{
  root.render(<main dir="rtl" className="p-6 text-red-800"><h1 className="font-bold">خطا در راه‌اندازی حساب‌یار</h1><p>{error instanceof Error?error.message:'خطای ناشناخته'}</p><p>اطلاعات موجود پاک نشده‌اند. برنامه را حذف نکنید.</p><button className="mt-4 underline" onClick={()=>location.reload()}>تلاش مجدد</button></main>);
});
