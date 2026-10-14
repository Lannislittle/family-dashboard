import puppeteer from 'puppeteer';
import fetch from 'node-fetch';

async function run() {
    console.log("Launching browser...");
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    console.log("Navigating to Vercel dashboard...");
    await page.goto('https://familydashboard-delta.vercel.app', { waitUntil: 'networkidle0', timeout: 60000 });

    console.log("Taking screenshot...");
    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 90 });
    await browser.close();

    console.log("Authenticating with Google Photos...");
    const clientId = process.env.GPHOTOS_CLIENT_ID;
    const clientSecret = process.env.GPHOTOS_CLIENT_SECRET;
    const refreshToken = process.env.GPHOTOS_REFRESH_TOKEN;
    const albumId = process.env.GPHOTOS_ALBUM_ID;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        })
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
        throw new Error("Failed to obtain access token: " + JSON.stringify(tokenData));
    }
    const accessToken = tokenData.access_token;

    console.log("Listing albums to find correct ID...");
    const albumsRes = await fetch('https://photoslibrary.googleapis.com/v1/albums', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const albumsData = await albumsRes.json();
    console.log("Albums list:", JSON.stringify(albumsData.albums || [], null, 2));

    console.log("Uploading image bytes...");
    const uploadRes = await fetch('https://photoslibrary.googleapis.com/v1/uploads', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-type': 'application/octet-stream',
            'X-Goog-Upload-Content-Type': 'image/jpeg',
            'X-Goog-Upload-Protocol': 'raw'
        },
        body: screenshotBuffer
    });

    const uploadToken = await uploadRes.text();
    if (!uploadRes.ok) {
        throw new Error("Failed to upload image bytes: " + uploadToken);
    }

    console.log("Adding image to album ID:", albumId);
    const batchRes = await fetch('https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            albumId: albumId,
            newMediaItems: [
                {
                    description: "Family Dashboard Auto Snapshot",
                    simpleMediaItem: {
                        uploadToken: uploadToken
                    }
                }
            ]
        })
    });

    const batchData = await batchRes.json();
    if (!batchRes.ok) {
        throw new Error("Failed to add media item to album: " + JSON.stringify(batchData));
    }

    console.log("Success! Response:", JSON.stringify(batchData));
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
