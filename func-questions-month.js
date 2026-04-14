/**
 * Вопросы по функционалу за последний месяц
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Паттерны вопросов по функционалу (не ошибки)
const FUNC_PATTERNS = [
  { name: 'Как создать/сделать', pattern: /как\s+(создать|сделать|оформить|настроить|получить|передать|указать)/i },
  { name: 'Можно ли', pattern: /можно\s+ли|возможно\s+ли|есть\s+ли\s+возможность/i },
  { name: 'Подскажите как', pattern: /подскаж(и|ите).*как|уточните.*как/i },
  { name: 'Какой/какие', pattern: /какой\s+(метод|параметр|формат|статус)|какие\s+(поля|параметры)/i },
  { name: 'Где найти/взять', pattern: /где\s+(найти|взять|посмотреть|скачать)/i },
  { name: 'Почему не отображается', pattern: /почему\s+не\s+(работает|приходит|отображается|подтягивается|выводится)/i },
  { name: 'Нужна документация', pattern: /документаци|инструкци|пример\s+запроса/i },
  { name: 'Как работает', pattern: /как\s+работает|как\s+устроен|принцип\s+работы/i },
];

// Исключаем явные ошибки инфраструктуры
const ERROR_PATTERNS = /ошибка\s+500|error\s+500|502|503|504|timeout|failed|критическ|упал|падает/i;

async function main() {
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

  const { data: tickets } = await supabase
    .from('support_tickets')
    .select('ticket_id, subject, first_message_text, created_at, status')
    .gte('created_at', oneMonthAgo.toISOString())
    .order('created_at', { ascending: false });

  console.log('═'.repeat(100));
  console.log('ВОПРОСЫ ПО ФУНКЦИОНАЛУ ЗА ПОСЛЕДНИЙ МЕСЯЦ');
  console.log('═'.repeat(100));
  console.log(`Период: ${oneMonthAgo.toISOString().split('T')[0]} — ${new Date().toISOString().split('T')[0]}`);
  console.log(`Всего тикетов за месяц: ${tickets.length}`);
  console.log('');

  const funcQuestions = [];

  for (const t of tickets) {
    const text = (t.subject || '') + ' ' + (t.first_message_text || '');

    // Пропускаем явные ошибки инфраструктуры
    if (ERROR_PATTERNS.test(text)) continue;

    for (const { name, pattern } of FUNC_PATTERNS) {
      if (pattern.test(text)) {
        funcQuestions.push({
          id: t.ticket_id,
          date: t.created_at.split('T')[0],
          type: name,
          subject: (t.subject || '').substring(0, 80),
          question: (t.first_message_text || '').substring(0, 200).replace(/\n/g, ' ').replace(/\s+/g, ' ')
        });
        break;
      }
    }
  }

  console.log(`Найдено вопросов по функционалу: ${funcQuestions.length}`);
  console.log('');

  // Группируем по типу
  const byType = {};
  for (const q of funcQuestions) {
    if (!byType[q.type]) byType[q.type] = [];
    byType[q.type].push(q);
  }

  for (const [type, items] of Object.entries(byType).sort((a,b) => b[1].length - a[1].length)) {
    console.log('─'.repeat(100));
    console.log(`${type.toUpperCase()} (${items.length} вопросов)`);
    console.log('─'.repeat(100));

    for (const q of items) {
      console.log(`[${q.date}] #${q.id}`);
      console.log(`  ${q.question.substring(0, 150)}...`);
      console.log('');
    }
  }

  // Статистика по неделям
  console.log('═'.repeat(100));
  console.log('СТАТИСТИКА ПО НЕДЕЛЯМ');
  console.log('═'.repeat(100));

  const weeks = {};
  for (const q of funcQuestions) {
    const date = new Date(q.date);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay() + 1); // Monday
    const weekKey = weekStart.toISOString().split('T')[0];
    if (!weeks[weekKey]) weeks[weekKey] = 0;
    weeks[weekKey]++;
  }

  for (const [week, count] of Object.entries(weeks).sort()) {
    const bar = '█'.repeat(Math.min(count, 40));
    console.log(`${week}: ${count.toString().padStart(3)} ${bar}`);
  }

  console.log('');
  console.log('═'.repeat(100));
}

main().catch(console.error);
