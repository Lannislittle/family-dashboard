import puppeteer from 'puppeteer';
import fs from 'fs';

const {
  GPHOTOS_CLIENT_ID,
  GPHOTOS_CLIENT_SECRET,
  GPHOTOS_REFRESH_TOKEN,
  GPHOTOS_ALBUM_ID
} = process.env;

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GPHOTOS_CLIENT_ID,
      client_secret: GPHOTOS_CLIENT_SECRET,
      refresh_token: GPHOTOS_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

async function run() {
  const token = await getAccessToken();

  console.log('Taking 1080p screenshot of dashboard...');
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto('https://familydashboard-delta.vercel.app', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: 'dashboard-latest.png' });
  await browser.close();

  const searchRes = await fetch('https://photoslibrary.googleapis.com/v1/mediaItems:search', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ albumId: GPHOTOS_ALBUM_ID, pageSize: 50 })
  });
  const searchData = await searchRes.json();
  if (searchData.mediaItems && searchData.mediaItems.length > 0) {
    const oldIds = searchData.mediaItems.map(item => item.id);
    await fetch(https://photoslibrary.googleapis.com/v1/albums/:batchRemoveMediaItems, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaItemIds: oldIds })
    });
  }

  const imgBuffer = fs.readFileSync('dashboard-latest.png');
  const uploadRes = await fetch('https://photoslibrary.googleapis.com/v1/uploads', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-type': 'application/octet-stream',
      'X-Goog-Upload-Content-Type': 'image/png',
      'X-Goog-Upload-Protocol': 'raw'
    },
    body: imgBuffer
  });
  const uploadToken = await uploadRes.text();

  const createRes = await fetch('https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      albumId: GPHOTOS_ALBUM_ID,
      newMediaItems: [{
        description: Updated ,
        simpleMediaItem: { fileName: 'dashboard-latest.png', uploadToken }
      }]
    })
  });
  console.log('Upload complete!', await createRes.json());
}

run().catch(err => { console.error(err); process.exit(1); });
