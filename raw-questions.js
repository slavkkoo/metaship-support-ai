/**
 * Только текст вопросов клиентов
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

const ERROR_PATTERNS = /ошибка\s+500|error\s+500|502|503|504|timeout\s+error|критическ|упал\s+сервис|сервер\с+недоступен/i;

async function main() {
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

  const { data: tickets } = await supabase
    .from('support_tickets')
    .select('first_message_text')
    .gte('created_at', oneMonthAgo.toISOString())
    .order('created_at', { ascending: false });

  let count = 0;
  for (const t of tickets) {
    const text = t.first_message_text || '';
    if (ERROR_PATTERNS.test(text)) continue;
    if (!FUNC_PATTERNS.some(p => p.test(text))) continue;

    count++;
    // Убираем только HTML теги и ссылки, оставляем текст как есть
    const clean = text
      .replace(/<[^>]*>/g, '')
      .replace(/https?:\/\/[^\s]+/g, '[ссылка]')
      .replace(/@\w+_?\w*/g, '')
      .trim();

    console.log('---');
    console.log(clean);
    console.log('');
  }
}

main().catch(console.error);
