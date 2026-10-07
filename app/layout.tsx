import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Фокус — завдання та знання',description:'Особистий простір для завдань, нотаток і навчальних тем.',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="uk"><body>{children}</body></html>;}
