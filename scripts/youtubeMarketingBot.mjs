import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(rootDir, 'marketing/youtube-bot.config.json');
const outDir = resolve(rootDir, 'marketing/out');

loadDotEnv(resolve(rootDir, '.env'));

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));

if (!command || command === '--help' || command === 'help' || args.help) {
  printHelp();
  process.exit(0);
}

try {
  if (command === 'ideas') {
    await runIdeas();
  } else if (command === 'metadata') {
    await runMetadata();
  } else if (command === 'video') {
    await runVideoStudio();
  } else if (command === 'render') {
    await runRenderVideo();
  } else if (command === 'auth-url') {
    runAuthUrl();
  } else if (command === 'token') {
    await runTokenExchange();
  } else if (command === 'auth-check') {
    await runAuthCheck();
  } else if (command === 'upload') {
    await runUpload();
  } else {
    fail(`Unknown command: ${command}`);
  }
} catch (error) {
  fail(error.message);
}

async function runIdeas() {
  const product = findProduct(getProductName());
  const query = args.query || buildSearchQuery(product);
  const limit = Number(args.limit || 8);
  const results = await searchYouTube(query, limit);
  const ideas = buildIdeas(product, results);
  const payload = {
    product,
    query,
    generatedAt: new Date().toISOString(),
    ideas,
    sourceVideos: results.map((item) => ({
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`
    }))
  };

  printJson(payload);
  saveIfRequested('ideas', product.name, payload);
}

async function runMetadata() {
  const product = findProduct(getProductName());
  const metadata = buildMetadata(product, args);
  printJson(metadata);
  saveIfRequested('metadata', product.name, metadata);
}

async function runVideoStudio() {
  const product = findProduct(getProductName());
  const metadata = buildMetadata(product, args);
  const imageDataUrl = args.image ? readImageAsDataUrl(resolve(args.image)) : '';
  const payload = {
    storeName: config.storeName,
    storeUrl: config.storeUrl,
    contactPhone: config.contactPhone,
    product,
    metadata,
    imageDataUrl,
    durationSeconds: Number(args.duration || 28)
  };

  mkdirSync(outDir, { recursive: true });
  const safeName = product.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const path = resolve(outDir, `video-maker-${safeName}.html`);
  const latestPath = resolve(outDir, 'video-maker.html');
  const html = buildVideoStudioHtml(payload);
  writeFileSync(path, html, 'utf8');
  writeFileSync(latestPath, html, 'utf8');

  printJson({
    status: 'created',
    studioFile: latestPath,
    productStudioFile: path,
    outputFormat: 'webm',
    nextStep: 'Open this file in Chrome and press the create video button.'
  });
}

async function runRenderVideo() {
  const product = findProduct(getProductName());
  const metadata = buildMetadata(product, args);
  const ffmpeg = findFfmpeg();
  const renderDir = resolve(outDir, 'render-current');
  mkdirSync(renderDir, { recursive: true });

  const avatarPath = resolve(renderDir, 'avatar.svg');
  const voicePath = resolve(renderDir, 'voice.wav');
  const outputPath = resolve(outDir, 'autoshop-video.mp4');
  const voiceText = buildVoiceText(product);
  const duration = Number(args.duration || 28);

  createAvatarPng(avatarPath);
  createVoiceWav(voiceText, voicePath);
  renderMp4({
    ffmpeg,
    avatarPath,
    voicePath,
    outputPath,
    product,
    duration
  });

  printJson({
    status: 'rendered',
    videoFile: outputPath,
    title: metadata.title,
    nextStep: `Upload it with: node scripts\\youtubeMarketingBot.mjs upload --file "${outputPath}" --product "${product.name}" --privacy private`
  });
}

async function runUpload() {
  const file = args.file ? resolve(args.file) : '';
  if (!file || !existsSync(file)) {
    fail('Video file not found. Use --file "C:\\Videos\\your-video.mp4".');
  }

  const product = findProduct(getProductName());
  const metadata = buildMetadata(product, args);
  const privacyStatus = args.privacy || config.defaultPrivacy || 'private';
  const accessToken = await getAccessToken();
  const video = await uploadVideo({
    accessToken,
    file,
    metadata,
    privacyStatus
  });

  printJson({
    status: 'uploaded',
    privacyStatus,
    videoId: video.id,
    url: `https://www.youtube.com/watch?v=${video.id}`,
    title: metadata.title
  });
}

function runAuthUrl() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) {
    fail('YOUTUBE_CLIENT_ID is missing. Add it to .env.');
  }

  const redirectUri = process.env.YOUTUBE_REDIRECT_URI || 'http://127.0.0.1:53682/oauth2callback';
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/youtube.upload');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');

  console.log(`Open this URL, allow access, then copy the "code" value from the redirected address:\n\n${url.toString()}\n`);
}

async function runTokenExchange() {
  const code = args.code || args._.join('');
  if (!code) {
    fail('Authorization code is missing. Run: node scripts\\youtubeMarketingBot.mjs token --code "PASTE_CODE_HERE"');
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI || 'http://127.0.0.1:53682/oauth2callback';
  if (!clientId || !clientSecret) {
    fail('YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET is missing. Add both to .env.');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });
  const data = await response.json();
  if (!response.ok) {
    fail(`OAuth code exchange failed: ${data.error_description || data.error || response.statusText}`);
  }

  console.log('Add this line to .env:');
  console.log(`YOUTUBE_REFRESH_TOKEN=${data.refresh_token || ''}`);
  if (!data.refresh_token) {
    console.log('\nNo refresh token was returned. Re-run auth-url and make sure prompt=consent is present.');
  }
}

async function runAuthCheck() {
  const accessToken = await getAccessToken();
  const tokenInfoUrl = new URL('https://oauth2.googleapis.com/tokeninfo');
  tokenInfoUrl.searchParams.set('access_token', accessToken);
  const response = await fetch(tokenInfoUrl);
  const data = await response.json();
  if (!response.ok) {
    fail(`YouTube auth check failed: ${data.error_description || data.error || response.statusText}`);
  }
  const scopes = String(data.scope || '').split(' ').filter(Boolean);
  console.log(JSON.stringify({
    status: 'ok',
    youtubeUploadAllowed: scopes.includes('https://www.googleapis.com/auth/youtube.upload'),
    scopes
  }, null, 2));
}


function buildSearchQuery(product) {
  const keywords = product.keywords?.slice(0, 4).join(' ') || product.category;
  return `${keywords} огляд авто аксесуари`;
}

async function searchYouTube(query, limit) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    fail('YOUTUBE_API_KEY is missing. Add it to .env to search YouTube ideas.');
  }

  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('order', 'relevance');
  url.searchParams.set('safeSearch', 'strict');
  url.searchParams.set('videoEmbeddable', 'true');
  url.searchParams.set('maxResults', String(Math.min(Math.max(limit, 1), 25)));
  url.searchParams.set('regionCode', args.region || config.defaultCountry || 'UA');
  url.searchParams.set('relevanceLanguage', args.language || config.defaultLanguage || 'uk');
  url.searchParams.set('q', query);
  url.searchParams.set('key', apiKey);

  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    fail(`YouTube search network error: ${error.cause?.message || error.message}`);
  }
  const data = await response.json();
  if (!response.ok) {
    fail(`YouTube search failed: ${data.error?.message || response.statusText}`);
  }
  return data.items || [];
}

function buildIdeas(product, results) {
  const base = [
    `Чи потрібен ${product.name} у щоденній поїздці?`,
    `3 ситуації, коли ${product.category.toLowerCase()} реально виручає`,
    `${product.name}: короткий огляд за 30 секунд`,
    `Як вибрати ${product.category.toLowerCase()} і не переплатити`,
    `Топова дрібниця для авто: ${product.name}`
  ];

  const fromVideos = results.slice(0, 5).map((item) => {
    const cleanTitle = stripHtml(item.snippet.title);
    return `Зняти свою відповідь на тему: "${cleanTitle}"`;
  });

  return [...base, ...fromVideos].map((title, index) => ({
    title,
    format: index < 5 ? 'Shorts 20-40 секунд' : 'Shorts або короткий огляд',
    angle: index % 2 === 0 ? 'практична користь' : 'порівняння/вибір',
    callToAction: `Дивись товар у ${config.storeName}: ${config.storeUrl}`
  }));
}

function buildMetadata(product, options = {}) {
  const title = clamp(
    options.title || `${product.name} для авто | короткий огляд AutoShop Market`,
    100
  );
  const priceLine = product.price ? `Ціна на сайті: від ${product.price} грн.` : '';
  const tags = unique([
    product.category,
    product.name,
    ...(product.keywords || []),
    'автотовари',
    'автоаксесуари',
    'AutoShop Market',
    'авто Україна'
  ]).slice(0, 18);

  const description = [
    `${product.name} - короткий огляд для тих, хто підбирає корисні аксесуари для авто.`,
    product.category ? `Категорія: ${product.category}.` : '',
    priceLine,
    '',
    `Купити або подивитися інші автотовари: ${config.storeUrl}`,
    config.contactPhone ? `Телефон: ${config.contactPhone}` : '',
    '',
    'Відео має бути створене з власних матеріалів AutoShop Market або матеріалів, на які є дозвіл.',
    '',
    config.hashtags.join(' ')
  ].filter(Boolean).join('\n');

  const script = [
    `0-3с: показати проблему: "У дорозі часто бракує зручного рішення для авто."`,
    `3-12с: показати ${product.name} крупним планом і 1-2 ключові переваги.`,
    `12-22с: показати, як товар використовується в авто.`,
    `22-30с: фінальний кадр: "${config.storeName} - автотовари з доставкою по Україні" і посилання на сайт.`
  ];

  return {
    title,
    description,
    tags,
    categoryId: '2',
    madeForKids: false,
    script
  };
}

function readImageAsDataUrl(path) {
  if (!existsSync(path)) {
    fail(`Image file not found: ${path}`);
  }
  const ext = extname(path).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg'
    ? 'image/jpeg'
    : ext === '.webp'
      ? 'image/webp'
      : 'image/png';
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

function buildVideoStudioHtml(payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AutoShop Market Video Maker</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #101216;
      color: #f8fafc;
      font-family: Arial, Helvetica, sans-serif;
    }
    main {
      width: min(1100px, calc(100vw - 32px));
      display: grid;
      grid-template-columns: 360px 1fr;
      gap: 24px;
      align-items: start;
      padding: 24px 0;
    }
    section {
      background: #181b22;
      border: 1px solid #2d3340;
      border-radius: 10px;
      padding: 20px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, .35);
    }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { color: #b8c0cc; line-height: 1.5; }
    button {
      width: 100%;
      border: 0;
      border-radius: 8px;
      padding: 14px 16px;
      background: #7c3aed;
      color: white;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
    }
    button:disabled { opacity: .6; cursor: wait; }
    .status {
      min-height: 22px;
      margin-top: 14px;
      color: #a7f3d0;
      font-size: 14px;
    }
    canvas {
      width: min(390px, 100%);
      aspect-ratio: 9 / 16;
      display: block;
      margin: 0 auto;
      background: #111827;
      border-radius: 16px;
      box-shadow: 0 18px 70px rgba(0, 0, 0, .5);
    }
    .small { font-size: 13px; }
    @media (max-width: 850px) {
      main { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>Видео-бот AutoShop</h1>
      <p>Нажми кнопку. Браузер сам создаст вертикальный ролик и скачает файл .webm. Его можно загружать на YouTube.</p>
      <button id="recordButton">Создать видео</button>
      <div id="status" class="status"></div>
      <p class="small">Если браузер спросит разрешение на скачивание файла, разреши. Во время записи не закрывай эту вкладку.</p>
    </section>
    <section>
      <canvas id="stage" width="1080" height="1920"></canvas>
    </section>
  </main>

  <script>
    const DATA = ${json};
    const canvas = document.getElementById('stage');
    const ctx = canvas.getContext('2d');
    const button = document.getElementById('recordButton');
    const statusEl = document.getElementById('status');
    const W = canvas.width;
    const H = canvas.height;
    const FPS = 30;
    const DURATION = Math.max(12, Number(DATA.durationSeconds || 28));
    const TOTAL = DURATION * FPS;
    let productImage = null;

    function loadImage(src) {
      return new Promise((resolve) => {
        if (!src) return resolve(null);
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function fillRoundRect(x, y, w, h, r, fill) {
      ctx.fillStyle = fill;
      roundRect(x, y, w, h, r);
      ctx.fill();
    }

    function wrapText(text, x, y, maxWidth, lineHeight, maxLines) {
      const words = String(text).split(/\\s+/);
      const lines = [];
      let line = '';
      for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      const visible = lines.slice(0, maxLines);
      visible.forEach((item, i) => ctx.fillText(item, x, y + i * lineHeight));
      return visible.length * lineHeight;
    }

    function drawBackground(t) {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#0f172a');
      g.addColorStop(.45, '#312e81');
      g.addColorStop(1, '#111827');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      ctx.globalAlpha = .22;
      for (let i = 0; i < 18; i++) {
        const x = ((i * 173 + t * 80) % (W + 260)) - 130;
        const y = (i * 211) % H;
        ctx.fillStyle = i % 2 ? '#fb923c' : '#22c55e';
        ctx.beginPath();
        ctx.arc(x, y, 70 + (i % 4) * 18, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function drawProductVisual(t) {
      const cardX = 110;
      const cardY = 430 + Math.sin(t * 3) * 12;
      fillRoundRect(cardX, cardY, 860, 620, 44, 'rgba(255,255,255,.95)');
      fillRoundRect(cardX + 34, cardY + 34, 792, 552, 36, '#eef2ff');

      if (productImage) {
        const scale = Math.min(720 / productImage.width, 460 / productImage.height);
        const iw = productImage.width * scale;
        const ih = productImage.height * scale;
        ctx.drawImage(productImage, cardX + 430 - iw / 2, cardY + 300 - ih / 2, iw, ih);
      } else {
        ctx.strokeStyle = '#7c3aed';
        ctx.lineWidth = 18;
        ctx.beginPath();
        ctx.arc(cardX + 430, cardY + 250, 150, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#7c3aed';
        ctx.font = '900 82px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('AUTO', cardX + 430, cardY + 282);
        ctx.fillStyle = '#f97316';
        ctx.font = '900 54px Arial';
        ctx.fillText('SHOP', cardX + 430, cardY + 360);
      }

      ctx.textAlign = 'center';
      ctx.fillStyle = '#111827';
      ctx.font = '900 56px Arial';
      wrapText(DATA.product.name, cardX + 430, cardY + 500, 720, 62, 2);
    }

    function drawScene(frame) {
      const t = frame / FPS;
      drawBackground(t);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 68px Arial';
      ctx.fillText(DATA.storeName, 80, 130);
      ctx.fillStyle = '#fdba74';
      ctx.font = '700 34px Arial';
      ctx.fillText('автотовары с доставкой по Украине', 82, 182);

      drawProductVisual(t);

      const phase = t < 5 ? 0 : t < 13 ? 1 : t < 21 ? 2 : 3;
      const lines = [
        ['Проблема в дороге?', 'Полезное решение всегда под рукой'],
        [DATA.product.name, DATA.product.category + ' для ежедневных поездок'],
        [DATA.product.price ? 'Цена от ' + DATA.product.price + ' грн' : 'Смотри цену на сайте', 'Смотри товар и другие аксессуары'],
        ['Заказать на сайте', DATA.storeUrl.replace(/^https?:\\/\\//, '')]
      ][phase];

      fillRoundRect(70, 1180, 940, 420, 38, 'rgba(15,23,42,.86)');
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 72px Arial';
      ctx.textAlign = 'left';
      wrapText(lines[0], 120, 1300, 840, 78, 2);
      ctx.fillStyle = '#c4b5fd';
      ctx.font = '700 44px Arial';
      wrapText(lines[1], 120, 1460, 820, 54, 2);

      fillRoundRect(120, 1645, 840, 92, 46, '#f97316');
      ctx.fillStyle = '#fff7ed';
      ctx.font = '900 40px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('AutoShop Market', 540, 1704);

      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.font = '700 26px Arial';
      ctx.fillText(Math.min(DURATION, Math.ceil(t)) + ' / ' + DURATION + ' сек', 540, 1826);
    }

    async function recordVideo() {
      button.disabled = true;
      statusEl.textContent = 'Создаю видео...';
      productImage = await loadImage(DATA.imageDataUrl);
      const stream = canvas.captureStream(FPS);
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'autoshop-' + DATA.product.name.toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, '-') + '.webm';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        statusEl.textContent = 'Готово. Файл скачан.';
        button.disabled = false;
      };

      let frame = 0;
      recorder.start();
      const timer = setInterval(() => {
        drawScene(frame);
        frame += 1;
        statusEl.textContent = 'Запись: ' + Math.min(DURATION, Math.floor(frame / FPS)) + ' сек';
        if (frame >= TOTAL) {
          clearInterval(timer);
          drawScene(TOTAL);
          recorder.stop();
        }
      }, 1000 / FPS);
    }

    button.addEventListener('click', recordVideo);
    drawScene(0);
  </script>
</body>
</html>`;
}

function findFfmpeg() {
  const candidates = [
    process.env.FFMPEG_PATH,
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'ffmpeg'
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  fail('ffmpeg was not found. Set FFMPEG_PATH in .env or add C:\\ffmpeg\\bin to PATH.');
}

function buildVoiceText(product) {
  const price = product.price ? `Цена от ${product.price} гривен.` : 'Актуальная цена есть на сайте.';
  return [
    `AutoShop Market представляет: ${product.name}.`,
    `Это полезный автоаксессуар из категории ${product.category}.`,
    price,
    'Смотрите товар и другие автотовары на сайте autoshop-market.vercel.app.'
  ].join(' ');
}

function createVoiceWav(text, outputPath) {
  const psPath = `${outputPath}.ps1`;
  const script = `
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.Rate = 0
$speaker.Volume = 100
$speaker.SetOutputToWaveFile('${psEscape(outputPath)}')
$speaker.Speak('${psEscape(text)}')
$speaker.Dispose()
`;
  writeFileSync(psPath, script, 'utf8');
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath], { stdio: 'pipe' });
}

function createAvatarPng(outputPath) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="900" viewBox="0 0 640 900">
  <rect width="640" height="900" fill="none"/>
  <circle cx="320" cy="205" r="170" fill="#f97316"/>
  <circle cx="320" cy="245" r="145" fill="#ffd0aa"/>
  <circle cx="270" cy="235" r="25" fill="#fff"/>
  <circle cx="370" cy="235" r="25" fill="#fff"/>
  <circle cx="278" cy="242" r="11" fill="#111827"/>
  <circle cx="378" cy="242" r="11" fill="#111827"/>
  <path d="M265 300 Q320 345 385 300" fill="none" stroke="#111827" stroke-width="12" stroke-linecap="round"/>
  <path d="M140 395 Q320 300 500 395 L535 820 H105 Z" fill="#7c3aed"/>
  <rect x="260" y="455" width="120" height="235" rx="30" fill="#f97316"/>
  <circle cx="120" cy="560" r="65" fill="#ffd0aa"/>
  <circle cx="520" cy="560" r="65" fill="#ffd0aa"/>
  <text x="172" y="640" font-family="Arial, sans-serif" font-size="62" font-weight="900" fill="#fff">AUTO</text>
  <text x="172" y="720" font-family="Arial, sans-serif" font-size="62" font-weight="900" fill="#fb923c">SHOP</text>
</svg>`;
  writeFileSync(outputPath, svg, 'utf8');
}

function renderMp4({ ffmpeg, avatarPath, voicePath, outputPath, product, duration }) {
  const priceText = product.price ? `Цена от ${product.price} грн` : 'Цена на сайте';
  const filter = [
    `[0:v]scale=430:-1[avatar]`,
    `color=c=0x101827:s=1080x1920:d=${duration}:r=30[base]`,
    `[base]drawbox=x=0:y=0:w=1080:h=1920:color=0x111827@1:t=fill[v0]`,
    `[v0]drawbox=x=0:y=0:w=1080:h=260:color=0x4c1d95@0.95:t=fill[v1]`,
    `[v1]drawbox=x=70:y=330:w=940:h=650:color=0xffffff@0.10:t=fill[v2]`,
    `[v2][avatar]overlay=x=610:y=430:format=auto[v3]`,
    drawText('AutoShop Market', 70, 105, 64, '0xffffff', 'v3', 'v4'),
    drawText('автотовары с доставкой по Украине', 72, 175, 34, '0xffd7aa', 'v4', 'v5'),
    drawText(product.name, 80, 390, 56, '0xffffff', 'v5', 'v6', 820),
    drawText(product.category, 86, 525, 40, '0xc4b5fd', 'v6', 'v7', 600),
    drawText(priceText, 86, 625, 56, '0xffedd5', 'v7', 'v8'),
    drawText('Почему это удобно?', 80, 1110, 58, '0xffffff', 'v8', 'v9', 860, 'between(t,0,8)'),
    drawText('Коротко показываем товар и пользу для водителя', 80, 1190, 38, '0xcbd5e1', 'v9', 'v10', 880, 'between(t,0,8)'),
    drawText('Подходит для ежедневных поездок', 80, 1110, 58, '0xffffff', 'v10', 'v11', 860, 'between(t,8,17)'),
    drawText('Смотрите характеристики и цену на сайте магазина', 80, 1190, 38, '0xcbd5e1', 'v11', 'v12', 880, 'between(t,8,17)'),
    drawText('Заказать можно онлайн', 80, 1110, 58, '0xffffff', 'v12', 'v13', 860, 'between(t,17,30)'),
    drawText('autoshop-market.vercel.app', 80, 1190, 42, '0xf97316', 'v13', 'v14', 880, 'between(t,17,30)'),
    `[v14]drawbox=x=80:y=1610:w=920:h=110:color=0xf97316@1:t=fill[v15]`,
    drawText('Ссылка на магазин в описании', 155, 1680, 44, '0xffffff', 'v15', 'outv')
  ].join(';');

  execFileSync(ffmpeg, [
    '-y',
    '-loop', '1',
    '-i', avatarPath,
    '-i', voicePath,
    '-filter_complex', filter,
    '-map', '[outv]',
    '-map', '1:a',
    '-t', String(duration),
    '-r', '30',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-shortest',
    outputPath
  ], { stdio: 'pipe' });
}

function drawText(text, x, y, size, color, input, output, boxWidth = 900, enable = '') {
  const font = 'C\\:/Windows/Fonts/arial.ttf';
  const options = [
    `fontfile='${font}'`,
    `text='${escapeDrawText(text)}'`,
    `x=${x}`,
    `y=${y}`,
    `fontsize=${size}`,
    `fontcolor=${color}`,
    `line_spacing=12`,
    `box=0`,
    `fix_bounds=1`
  ];
  if (boxWidth) options.push(`text_shaping=1`);
  if (enable) options.push(`enable='${enable}'`);
  return `[${input}]drawtext=${options.join(':')}[${output}]`;
}

function escapeDrawText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,');
}

function psEscape(value) {
  return String(value).replace(/'/g, "''");
}

async function getAccessToken() {
  if (process.env.YOUTUBE_ACCESS_TOKEN) {
    return process.env.YOUTUBE_ACCESS_TOKEN;
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    fail('OAuth data is missing. Add YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN to .env.');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const data = await response.json();
  if (!response.ok) {
    fail(`OAuth token refresh failed: ${data.error_description || data.error || response.statusText}`);
  }
  return data.access_token;
}

async function uploadVideo({ accessToken, file, metadata, privacyStatus }) {
  const videoBytes = readFileSync(file);
  const initUrl = new URL('https://www.googleapis.com/upload/youtube/v3/videos');
  initUrl.searchParams.set('uploadType', 'resumable');
  initUrl.searchParams.set('part', 'snippet,status');

  const initResponse = await fetch(initUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-length': String(videoBytes.length),
      'x-upload-content-type': guessMimeType(file)
    },
    body: JSON.stringify({
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        categoryId: metadata.categoryId
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: metadata.madeForKids
      }
    })
  });

  if (!initResponse.ok) {
    const text = await initResponse.text();
    fail(`YouTube upload init failed: ${text}`);
  }

  const uploadUrl = initResponse.headers.get('location');
  if (!uploadUrl) {
    fail('YouTube did not return an upload URL.');
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'content-type': guessMimeType(file),
      'content-length': String(videoBytes.length)
    },
    body: videoBytes
  });
  const data = await uploadResponse.json();
  if (!uploadResponse.ok) {
    fail(`YouTube upload failed: ${data.error?.message || uploadResponse.statusText}`);
  }
  return data;
}

function findProduct(productName) {
  if (!productName) {
    return config.products[0];
  }

  const normalized = normalize(productName);
  const product = config.products.find((item) => normalize(item.name).includes(normalized))
    || config.products.find((item) => normalize(item.category).includes(normalized))
    || config.products.find((item) => item.keywords?.some((keyword) => normalize(keyword).includes(normalized)));

  if (!product) {
    return {
      name: productName,
      category: guessCategory(productName),
      price: null,
      keywords: buildFallbackKeywords(productName)
    };
  }
  return product;
}

function guessCategory(productName) {
  const value = normalize(productName);
  if (value.includes('видео') || value.includes('відео') || value.includes('регистратор') || value.includes('реєстратор')) {
    return 'Видеорегистраторы';
  }
  if (value.includes('компрес') || value.includes('compress')) return 'Компрессоры';
  if (value.includes('led') || value.includes('фар')) return 'Автосвет';
  if (value.includes('магнитол') || value.includes('магнітол')) return 'Автомагнитолы';
  if (value.includes('инвертор') || value.includes('інвертор')) return 'Инверторы';
  if (value.includes('заряд')) return 'Автомобильные зарядки';
  if (value.includes('трансмит') || value.includes('трансміт')) return 'FM-трансмиттеры';
  return 'Автоаксессуары';
}

function buildFallbackKeywords(productName) {
  return unique([
    productName,
    guessCategory(productName),
    'автотовары',
    'автоаксессуары',
    'AutoShop Market'
  ]);
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith('--')) {
      parsed._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function getProductName() {
  return args.product || args._.join(' ');
}

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

function saveIfRequested(type, productName, payload) {
  if (!args.save) return;
  mkdirSync(outDir, { recursive: true });
  const safeName = productName.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const path = resolve(outDir, `${type}-${safeName}-${Date.now()}.json`);
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`\nSaved: ${path}`);
}

function printJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function printHelp() {
  console.log(`
YouTube marketing bot

Commands:
  ideas      Search YouTube for related topics and generate content ideas
  metadata   Generate title, description, tags and a short video script
  auth-url   Print a Google OAuth URL for YouTube upload permission
  token      Exchange the copied OAuth code for a refresh token
  auth-check Check saved YouTube OAuth credentials
  upload     Upload your own video file to YouTube

Examples:
  npm run youtube:ideas "Компресор автомобільний 12V"
  npm run youtube:metadata "LED-фари денного світла Philips"
  node scripts/youtubeMarketingBot.mjs auth-url
  node scripts/youtubeMarketingBot.mjs token --code "PASTE_CODE_HERE"
  node scripts/youtubeMarketingBot.mjs upload --file "C:\\Videos\\short.mp4" --product "FM-трансмітер Baseus Bluetooth" --privacy private
`);
}

function normalize(value) {
  return String(value || '').toLowerCase().trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function clamp(value, max) {
  return value.length > max ? `${value.slice(0, max - 1).trim()}…` : value;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function guessMimeType(file) {
  const lower = basename(file).toLowerCase();
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mkv')) return 'video/x-matroska';
  return 'video/mp4';
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}
