'use client';
import {createContext,useCallback,useContext,useEffect,useMemo,useState} from 'react';
import {Globe,Loader2} from 'lucide-react';
import {BRAND,languages,translate,type Language} from '@/lib/i18n';
type LanguageContextValue = {language:Language;t:(key:string,params?:Record<string,string|number>)=>string;setLanguage:(language:Language)=>Promise<void>;pending:boolean};
const LanguageContext=createContext<LanguageContextValue|null>(null);
export function LanguageProvider({initialLanguage,children}:{initialLanguage:Language;children:React.ReactNode}) {
  const [language,updateLanguage]=useState(initialLanguage);
  const [pending,setPending]=useState(false);
  const t=useCallback((key:string,params?:Record<string,string|number>)=>translate(language,key,params),[language]);
  const setLanguage=useCallback(async(next:Language)=>{
    if(next===language)return;
    setPending(true);
    try {
      const response=await fetch('/api/language',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({language:next})});
      if(!response.ok)throw new Error(t('Не вдалося змінити мову.'));
      updateLanguage(next);
    } finally {setPending(false);}
  },[language,t]);
  useEffect(()=>{document.documentElement.lang=language;document.title=`${BRAND} — ${t('Завдання та знання')}`;},[language,t]);
  const value=useMemo(()=>({language,t,setLanguage,pending}),[language,t,setLanguage,pending]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export function useI18n(){const context=useContext(LanguageContext);if(!context)throw new Error('LanguageProvider is required');return context;}
export function LanguageSelector(){
  const {language,t,setLanguage,pending}=useI18n();
  const [error,setError]=useState('');
  return <div className="language-control"><label className="language-select"><Globe size={16}/><span className="sr-only">{t('Мова інтерфейсу')}</span>
    <select value={language} disabled={pending} onChange={event=>{setError('');void setLanguage(event.target.value as Language).catch(()=>setError('Не вдалося змінити мову.'));}}>
      {Object.entries(languages).map(([value,label])=><option key={value} value={value} lang={value}>{label}</option>)}
    </select>{pending&&<Loader2 size={14} className="spin"/>}
  </label>{error&&<span className="language-error" role="alert">{t(error)}</span>}</div>;
}
