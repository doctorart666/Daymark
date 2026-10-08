import type { Metadata } from 'next';
import './globals.css';
import {requestLanguage} from '@/lib/server';
import {BRAND,translate} from '@/lib/i18n';
import {LanguageProvider} from './language-provider';
export async function generateMetadata():Promise<Metadata>{const language=await requestLanguage();return {title:`${BRAND} — ${translate(language,'Завдання та знання')}`,description:translate(language,'Особистий простір для завдань, нотаток і навчальних тем.'),icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'}};}
export default async function RootLayout({children}:{children:React.ReactNode}){const language=await requestLanguage();return <html lang={language}><body><LanguageProvider initialLanguage={language}>{children}</LanguageProvider></body></html>;}
