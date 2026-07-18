// Публикация постов на страницу Facebook через Graph API.
//
// Берёт из marketing/fb-posts.json первый пост со status: "approved",
// публикует его на страницу и помечает как "posted" (workflow коммитит файл).
// Если постов в очереди нет — просто выходит без ошибки.
//
// Нужны переменные окружения:
//   FB_PAGE_ID    — ID страницы Facebook
//   FB_PAGE_TOKEN — Page Access Token с правом pages_manage_posts
//
// Запуск: npm run fb:post

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SITE = 'https://autoshop-market.vercel.app';
const GRAPH = 'https://graph.facebook.com/v23.0';

const PAGE_ID = process.env.FB_PAGE_ID;
const TOKEN = process.env.FB_PAGE_TOKEN;

if (!PAGE_ID || !TOKEN) {
  console.error('Не заданы FB_PAGE_ID и/или FB_PAGE_TOKEN (секреты репозитория).');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUEUE_FILE = resolve(__dirname, '../marketing/fb-posts.json');

const queue = JSON.parse(readFileSync(QUEUE_FILE, 'utf8'));

// Сначала удаляем посты из списка deleteIds (например, опубликованные,
// пока приложение было в режиме разработки — их никто не видит).
if (queue.deleteIds?.length) {
  for (const id of queue.deleteIds) {
    const res = await fetch(`${GRAPH}/${id}?access_token=${encodeURIComponent(TOKEN)}`, { method: 'DELETE' });
    const data = await res.json();
    console.log(`Удаление старого поста ${id}: ${res.ok && !data.error ? 'ок' : JSON.stringify(data.error ?? data)}`);
  }
  queue.deleteIds = [];
  writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2) + '\n', 'utf8');
}

const post = queue.posts.find((p) => p.status === 'approved');

if (!post) {
  console.log('В очереди нет одобренных постов — публиковать нечего.');
  process.exit(0);
}

console.log(`Публикую пост "${post.id}"...`);

// Пост с картинкой идёт в /photos (картинку Facebook скачивает с сайта сам),
// без картинки — обычный текстовый пост в /feed.
const endpoint = post.image ? `${GRAPH}/${PAGE_ID}/photos` : `${GRAPH}/${PAGE_ID}/feed`;
const body = new URLSearchParams({ access_token: TOKEN });
if (post.image) {
  body.set('url', SITE + post.image);
  body.set('caption', post.text);
} else {
  body.set('message', post.text);
}

const res = await fetch(endpoint, { method: 'POST', body });
const data = await res.json();

if (!res.ok || data.error) {
  console.error('Facebook вернул ошибку:', JSON.stringify(data.error ?? data, null, 2));
  process.exit(1);
}

post.status = 'posted';
post.postedAt = new Date().toISOString();
post.fbPostId = data.post_id ?? data.id ?? null;

writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2) + '\n', 'utf8');
console.log(`Готово! ID поста в Facebook: ${post.fbPostId}`);
console.log(`Осталось в очереди: ${queue.posts.filter((p) => p.status === 'approved').length}`);
