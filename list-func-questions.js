/**
 * Полный список вопросов по функционалу за месяц
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const FUNC_PATTERNS = [
  /как\s+(создать|сделать|оформить|настроить|получить|передать|указать|редактировать|изменить|отправить|загрузить)/i,
  /можно\s+ли|возможно\s+ли|есть\s+ли\s+возможность/i,
  /подскаж(и|ите)|уточните/i,
  /какой\s+(метод|параметр|формат|статус|тариф)|какие\s+(поля|параметры|тарифы)/i,
  /где\s+(найти|взять|посмотреть|скачать)/i,
  /почему\s+не\s+(работает|приходит|отображается|подтягивается|выводится|возвращается|создается)/i,
  /документаци|инструкци|пример\s+запроса/i,
  /как\s+работает|нужно\s+понять|хочу\s+понять/i,
  /есть\s+ли\s+у\s+(нас|вас)|поддерживается\s+ли/i,
  /что\s+(означает|значит|подразумевается)/i,
  /в\s+каком\s+(методе|поле|параметре)/i,
];

const ERROR_PATTERNS = /ошибка\s+500|error\s+500|502|503|504|timeout\s+error|критическ|упал\s+сервис|сервер\s+недоступен/i;

async function main() {
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

  const { data: tickets } = await supabase
    .from('support_tickets')
    .select('ticket_id, subject, first_message_text, created_at')
    .gte('created_at', oneMonthAgo.toISOString())
    .order('created_at', { ascending: false });

  console.log('═'.repeat(100));
  console.log('ПОЛНЫЙ СПИСОК ВОПРОСОВ ПО ФУНКЦИОНАЛУ ЗА МЕСЯЦ');
  console.log(`Период: ${oneMonthAgo.toISOString().split('T')[0]} — ${new Date().toISOString().split('T')[0]}`);
  console.log('═'.repeat(100));
  console.log('');

  let count = 0;

  for (const t of tickets) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');

    // Пропускаем явные ошибки инфраструктуры
    if (ERROR_PATTERNS.test(text)) continue;

    // Проверяем паттерны функциональных вопросов
    const isFunc = FUNC_PATTERNS.some(p => p.test(text));
    if (!isFunc) continue;

    count++;
    const date = t.created_at.split('T')[0];
    const question = (t.first_message_text || '')
      .replace(/<[^>]*>/g, '')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .substring(0, 400)
      .trim();

    console.log('─'.repeat(100));
    console.log(`${count}. [${date}] Тикет #${t.ticket_id}`);
    console.log('');
    console.log(`   ${question}`);
    console.log('');
  }

  console.log('═'.repeat(100));
  console.log(`ВСЕГО ВОПРОСОВ ПО ФУНКЦИОНАЛУ: ${count}`);
  console.log('═'.repeat(100));
}

main().catch(console.error);
