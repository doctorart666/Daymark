'use client';
import {useI18n,LanguageSelector} from '../language-provider';
export default function Instructions(){
 const {t}=useI18n();
  return <main className="setup-page"><LanguageSelector/><a href="/settings" className="text-button">{t('Повернутися до налаштувань')}</a>
    <h1>{t('Підключення Telegram')}</h1><p>{t('Сайт і бот запускаються вручну однією командою з папки проєкту:')}</p>
    <pre><code>npm run dev</code></pre><p>{t('Локальна адреса — {address}. Для зупинки сайту й бота натисніть {shortcut} у терміналі.',{address:'http://localhost:5173',shortcut:'Ctrl+C'})}</p>
    <p>{t('Щоб увійти, відкрийте посилання на Telegram-бота та натисніть «Start». Після підтвердження сайт відкриє ваш простір.')}</p>
    <p>{t('Токен бота зберігається у приватному файлі {tokenFile}, а секрет локального підключення — у {secretFile}. Їх не потрібно вставляти у записи чи надсилати в чат.',{tokenFile:'telegram/.env',secretFile:'.dev.vars'})}</p>
    <p>{t('Нагадування надсилаються лише поки ви тримаєте сайт і бота запущеними.')}</p>
  </main>;
}
