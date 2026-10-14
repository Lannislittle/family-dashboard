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
    await page.goto('https://familydashboard-delta.vercel.app', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    console.log("Waiting 5 seconds for dashboard elements to settle...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log("Taking screenshot...");
    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 90 });
    await browser.close();

    console.log("Authenticating with Google Photos...");
    const clientId = process.env.GPHOTOS_CLIENT_ID;
    const clientSecret = process.env.GPHOTOS_CLIENT_SECRET;
    const refreshToken = process.env.GPHOTOS_REFRESH_TOKEN;
    const albumId = process.env.GPHOTOS_ALBUM_ID;

    if (!albumId) {
        throw new Error("Missing GPHOTOS_ALBUM_ID secret in GitHub!");
    }

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

    console.log("Locked onto Permanent Album ID:", albumId);

    // 1. Check for old photos inside this exact album so we can remove them
    const searchRes = await fetch('https://photoslibrary.googleapis.com/v1/mediaItems:search', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ albumId: albumId, pageSize: 50 })
    });
    const searchData = await searchRes.json();
    const oldMediaItemIds = (searchData.mediaItems || []).map(item => item.id);
    console.log(`Found ${oldMediaItemIds.length} old photo(s) in this album.`);

    // 2. Upload the brand-new screenshot bytes
    console.log("Uploading new image bytes...");
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

    // 3. Add the new screenshot into this exact album
    console.log("Adding new image to album...");
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
                    description: `Family Dashboard Snapshot - ${new Date().toISOString()}`,
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

    // 4. Remove the old screenshot(s) from this exact album so only 1 fresh photo stays
    if (oldMediaItemIds.length > 0) {
        console.log("Removing old snapshot(s) from album...");
        const removeUrl = `https://photoslibrary.googleapis.com/v1/albums/${albumId}:batchRemoveMediaItems`;
        const removeRes = await fetch(removeUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                mediaItemIds: oldMediaItemIds
            })
        });
        if (!removeRes.ok) {
            const errText = await removeRes.text();
            console.warn("Could not remove old items:", errText);
        } else {
            console.log("Old snapshot(s) removed cleanly!");
        }
    }

    console.log("Success! Single album updated without creating duplicates.");
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
